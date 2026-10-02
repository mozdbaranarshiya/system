-- سامانه آموزش و پرورش استان اصفهان
-- v7 / مرحله ۱: امنیت حساب، اجبار تغییر رمز و Audit Log
-- هیچ داده موجودی حذف نمی‌شود.

set role postgres;

-- 1) وضعیت امنیت حساب
alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz,
  add column if not exists password_required_at timestamptz;

create index if not exists idx_profiles_must_change_password
  on public.profiles(must_change_password)
  where must_change_password = true;

-- Bootstrap نسخه ۶.۱ حفظ می‌شود و فقط فیلدهای امنیت حساب به پروفایل افزوده می‌شوند.
create or replace function public.get_app_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'national_id',p.national_id,
        'full_name',p.full_name,
        'role',p.role,
        'active',p.active,
        'created_at',p.created_at,
        'must_change_password',p.must_change_password,
        'password_changed_at',p.password_changed_at
      ) order by p.full_name)
      from public.profiles p
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',g.id,'title',g.title,'sort_order',g.sort_order
      ) order by g.sort_order,g.title)
      from public.grade_levels g
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'grade_id',c.grade_id,'title',c.title,'academic_year',c.academic_year
      ) order by c.title)
      from public.classes c
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'grade_id',s.grade_id,'title',s.title
      ) order by s.title)
      from public.subjects s
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ta.id,'teacher_id',ta.teacher_id,'class_id',ta.class_id,'subject_id',ta.subject_id
      ) order by ta.id)
      from public.teacher_assignments ta
    ), '[]'::jsonb),
    'classStudents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class_id',cs.class_id,'student_id',cs.student_id
      ) order by cs.class_id,cs.student_id)
      from public.class_students cs
    ), '[]'::jsonb),
    'representatives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class_id',cr.class_id,'student_id',cr.student_id
      ) order by cr.class_id)
      from public.class_representatives cr
    ), '[]'::jsonb)
  )
$$;

grant execute on function public.get_app_bootstrap() to authenticated;

-- کاربران فعلی مختل نمی‌شوند؛ فقط کاربران جدید/رمزهای بازنشانی‌شده اجبار خواهند داشت.
update public.profiles
set must_change_password=false
where must_change_password is null;

create or replace function public.password_change_complete()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    (select not must_change_password from public.profiles where id=auth.uid()),
    false
  )
$$;

grant execute on function public.password_change_complete() to authenticated;

-- پس از تغییر رمز در Supabase Auth، این RPC با بررسی رکورد auth.users
-- اجبار تغییر رمز را خاتمه می‌دهد. رمز فعلی نباید همان کد ملی باشد.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.complete_password_change()
returns timestamptz
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.profiles;
  auth_updated_at timestamptz;
  encrypted_password text;
  changed_at timestamptz;
begin
  select * into p
  from public.profiles
  where id=auth.uid()
  for update;

  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
  if not p.active then raise exception 'USER_INACTIVE'; end if;

  select u.updated_at,u.encrypted_password
  into auth_updated_at,encrypted_password
  from auth.users u
  where u.id=auth.uid();

  if encrypted_password is null then raise exception 'AUTH_USER_NOT_FOUND'; end if;

  if p.password_required_at is not null
     and coalesce(auth_updated_at,'epoch'::timestamptz) <= p.password_required_at then
    raise exception 'PASSWORD_NOT_CHANGED';
  end if;

  if extensions.crypt(p.national_id,encrypted_password)=encrypted_password then
    raise exception 'PASSWORD_SAME_AS_NATIONAL_ID';
  end if;

  changed_at:=now();
  update public.profiles
  set must_change_password=false,
      password_changed_at=changed_at
  where id=auth.uid();

  return changed_at;
end
$$;

grant execute on function public.complete_password_change() to authenticated;

-- 2) Audit Log
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null check(action in ('INSERT','UPDATE','DELETE')),
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_user
  on public.audit_logs(user_id,created_at desc);
create index if not exists idx_audit_logs_table
  on public.audit_logs(table_name,created_at desc);
create index if not exists idx_audit_logs_record
  on public.audit_logs(record_id)
  where record_id is not null;

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_manager_read on public.audit_logs;
create policy audit_logs_manager_read
on public.audit_logs
for select
to authenticated
using(public.is_manager());

-- intentionally no INSERT/UPDATE/DELETE policy for authenticated users.
revoke insert,update,delete on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;
grant select,insert on public.audit_logs to service_role;
grant usage,select on sequence public.audit_logs_id_seq to service_role;

create or replace function public.audit_record_id(p_row jsonb)
returns uuid
language plpgsql
immutable
set search_path=public
as $$
declare
  value text;
begin
  value := p_row->>'id';
  if value is null or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return value::uuid;
end
$$;

revoke all on function public.audit_record_id(jsonb) from public;

create or replace function public.capture_audit_log()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  old_j jsonb;
  new_j jsonb;
  rec_id uuid;
begin
  -- تغییرات Edge Functionهای service_role به صورت دستی با actor واقعی ثبت می‌شوند.
  if coalesce(auth.role(),'')='service_role' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if tg_op='INSERT' then
    old_j := null;
    new_j := to_jsonb(new);
    rec_id := public.audit_record_id(new_j);
  elsif tg_op='UPDATE' then
    old_j := to_jsonb(old);
    new_j := to_jsonb(new);
    rec_id := coalesce(public.audit_record_id(new_j),public.audit_record_id(old_j));

    -- از ثبت UPDATE بدون تغییر واقعی جلوگیری می‌شود.
    if old_j = new_j then return new; end if;
  else
    old_j := to_jsonb(old);
    new_j := null;
    rec_id := public.audit_record_id(old_j);
  end if;

  insert into public.audit_logs(user_id,action,table_name,record_id,old_data,new_data)
  values(auth.uid(),tg_op,tg_table_name,rec_id,old_j,new_j);

  if tg_op='DELETE' then return old; else return new; end if;
end
$$;

revoke all on function public.capture_audit_log() from public;

-- تابع کمکی برای اتصال امن Triggerها، بدون خطا در اجرای مجدد Migration.
create or replace function public.attach_audit_trigger(p_table regclass)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  trigger_name text;
begin
  trigger_name := 'trg_audit_' || replace(p_table::text,'.','_');
  execute format('drop trigger if exists %I on %s',trigger_name,p_table);
  execute format(
    'create trigger %I after insert or update or delete on %s for each row execute function public.capture_audit_log()',
    trigger_name,p_table
  );
end
$$;

revoke all on function public.attach_audit_trigger(regclass) from public;

select public.attach_audit_trigger('public.profiles'::regclass);
select public.attach_audit_trigger('public.scores'::regclass);
select public.attach_audit_trigger('public.teacher_assignments'::regclass);
select public.attach_audit_trigger('public.class_students'::regclass);
select public.attach_audit_trigger('public.discipline_scores'::regclass);
select public.attach_audit_trigger('public.school_settings'::regclass);
select public.attach_audit_trigger('public.assignments'::regclass);
select public.attach_audit_trigger('public.assignment_submissions'::regclass);
select public.attach_audit_trigger('public.student_groups'::regclass);
select public.attach_audit_trigger('public.student_group_members'::regclass);
select public.attach_audit_trigger('public.group_score_entries'::regclass);
select public.attach_audit_trigger('public.objections'::regclass);
select public.attach_audit_trigger('public.announcements'::regclass);
select public.attach_audit_trigger('public.homework_grades'::regclass);

-- 3) کاربر دارای رمز اولیه تا تغییر رمز، به داده‌های سامانه دسترسی عادی ندارد.
-- پروفایل خودش برای نمایش صفحه تغییر رمز قابل خواندن باقی می‌ماند.
drop policy if exists password_guard_profiles on public.profiles;
create policy password_guard_profiles
on public.profiles
as restrictive
for select
to authenticated
using(id=auth.uid() or public.password_change_complete());

-- برای جدول‌های اصلی موجود، policy محدودکننده اضافه می‌شود.
do $$
declare
  t text;
begin
  foreach t in array array[
    'grade_levels','classes','subjects','class_students','teacher_assignments',
    'class_representatives','scores','announcements','objections','school_settings',
    'discipline_scores','student_groups','student_group_members','assignments',
    'assignment_submissions','group_score_fields','group_score_entries',
    'homework_grades','group_score_archives','audit_logs'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I','password_guard_'||t,t);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using(public.password_change_complete()) with check(public.password_change_complete())',
        'password_guard_'||t,t
      );
    end if;
  end loop;
end
$$;

-- Storage فایل تکلیف نیز تا تغییر رمز بسته می‌شود.
drop policy if exists password_guard_assignment_files on storage.objects;
create policy password_guard_assignment_files
on storage.objects
as restrictive
for all
to authenticated
using(
  bucket_id <> 'assignment-files'
  or public.password_change_complete()
)
with check(
  bucket_id <> 'assignment-files'
  or public.password_change_complete()
);

-- تست سریع
select
  has_table_privilege('authenticated','public.audit_logs','SELECT') as audit_select,
  not has_table_privilege('authenticated','public.audit_logs','INSERT') as audit_insert_blocked,
  has_function_privilege('authenticated','public.password_change_complete()','EXECUTE') as password_guard_exec,
  has_function_privilege('authenticated','public.complete_password_change()','EXECUTE') as password_complete_exec;
