-- v7 / مرحله ۸: فرم‌ساز داخلی
set role postgres;

create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class')),
  target_role public.user_role,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  active boolean not null default true,
  one_response_per_user boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(closes_at is null or opens_at is null or closes_at>opens_at)
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  field_type text not null check(field_type in ('short_text','long_text','number','date','time','single_choice','multi_choice','yes_no')),
  label text not null,
  placeholder text,
  required boolean not null default false,
  options jsonb,
  sort_order integer not null default 0
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table if not exists public.form_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  field_id uuid not null references public.form_fields(id) on delete cascade,
  value jsonb,
  unique(submission_id,field_id)
);

create index if not exists idx_forms_active_time on public.forms(active,opens_at,closes_at);
create index if not exists idx_form_fields_form on public.form_fields(form_id,sort_order);
create index if not exists idx_form_submissions_form on public.form_submissions(form_id,submitted_at desc);
create index if not exists idx_form_submissions_user on public.form_submissions(user_id,submitted_at desc);

drop trigger if exists trg_forms_updated_at on public.forms;
create trigger trg_forms_updated_at before update on public.forms for each row execute function public.touch_updated_at();

create or replace function public.target_user_ids(
  p_target_type text,
  p_role public.user_role,
  p_grade uuid,
  p_class uuid
) returns table(user_id uuid)
language sql
stable
security definer
set search_path=public
as $$
  select distinct p.id
  from public.profiles p
  where p.active
    and (
      p_target_type='all'
      or (p_target_type='role' and p.role=p_role)
      or (
        p_target_type='class'
        and exists(select 1 from public.class_students cs where cs.class_id=p_class and cs.student_id=p.id)
      )
      or (
        p_target_type='grade'
        and exists(
          select 1 from public.class_students cs join public.classes c on c.id=cs.class_id
          where cs.student_id=p.id and c.grade_id=p_grade
        )
      )
    )
$$;
revoke all on function public.target_user_ids(text,public.user_role,uuid,uuid) from public;

create or replace function public.can_access_form(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.forms f
    where f.id=p_form
      and (
        public.is_manager()
        or auth.uid() in (
          select t.user_id from public.target_user_ids(f.target_type,f.target_role,f.target_grade_id,f.target_class_id) t
        )
      )
  )
$$;
grant execute on function public.can_access_form(uuid) to authenticated;

alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_answers enable row level security;

drop policy if exists forms_read on public.forms;
create policy forms_read on public.forms for select to authenticated
using(public.password_change_complete() and public.can_access_form(id));

drop policy if exists forms_manager on public.forms;
create policy forms_manager on public.forms for all to authenticated
using(public.is_manager()) with check(public.is_manager() and created_by=auth.uid());

drop policy if exists form_fields_read on public.form_fields;
create policy form_fields_read on public.form_fields for select to authenticated
using(public.password_change_complete() and public.can_access_form(form_id));

drop policy if exists form_fields_manager on public.form_fields;
create policy form_fields_manager on public.form_fields for all to authenticated
using(public.is_manager())
with check(public.is_manager());

drop policy if exists form_submissions_read on public.form_submissions;
create policy form_submissions_read on public.form_submissions for select to authenticated
using(user_id=auth.uid() or public.is_manager());

drop policy if exists form_answers_read on public.form_answers;
create policy form_answers_read on public.form_answers for select to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.form_submissions s where s.id=form_answers.submission_id and s.user_id=auth.uid())
);

create or replace function public.submit_form(p_form uuid,p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  f public.forms;
  sid uuid;
  item jsonb;
  fid uuid;
  val jsonb;
  fld public.form_fields;
begin
  select * into f from public.forms where id=p_form;
  if not found or not f.active then raise exception 'FORM_NOT_ACTIVE'; end if;
  if f.opens_at is not null and now()<f.opens_at then raise exception 'FORM_NOT_OPEN'; end if;
  if f.closes_at is not null and now()>f.closes_at then raise exception 'FORM_CLOSED'; end if;
  if not public.can_access_form(f.id) then raise exception 'ACCESS_DENIED'; end if;
  if jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_DATA'; end if;
  if f.one_response_per_user and exists(select 1 from public.form_submissions s where s.form_id=f.id and s.user_id=auth.uid()) then
    raise exception 'FORM_ALREADY_SUBMITTED';
  end if;

  insert into public.form_submissions(form_id,user_id) values(f.id,auth.uid()) returning id into sid;

  for item in select value from jsonb_array_elements(p_answers)
  loop
    fid:=(item->>'field_id')::uuid;
    val:=item->'value';
    select * into fld from public.form_fields where id=fid and form_id=f.id;
    if not found then raise exception 'INVALID_FORM_FIELD'; end if;
    if fld.required and (val is null or val='null'::jsonb or val='""'::jsonb or val='[]'::jsonb) then
      raise exception 'REQUIRED_FIELD_MISSING';
    end if;
    insert into public.form_answers(submission_id,field_id,value) values(sid,fid,val);
  end loop;

  if exists(
    select 1 from public.form_fields fld
    where fld.form_id=f.id and fld.required
      and not exists(
        select 1 from public.form_answers a where a.submission_id=sid and a.field_id=fld.id
      )
  ) then
    raise exception 'REQUIRED_FIELD_MISSING';
  end if;

  return sid;
exception when others then
  if sid is not null then delete from public.form_submissions where id=sid; end if;
  raise;
end
$$;

grant select,insert,update,delete on public.forms,public.form_fields to authenticated;
grant select on public.form_submissions,public.form_answers to authenticated;
grant execute on function public.submit_form(uuid,jsonb) to authenticated;

select public.attach_audit_trigger('public.forms'::regclass);

create or replace function public.notify_form_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select t.user_id,'form','فرم جدید',new.title,'forms','form',new.id,'form:new:'||new.id::text
    from public.target_user_ids(new.target_type,new.target_role,new.target_grade_id,new.target_class_id) t
    where t.user_id<>new.created_by
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_form_created on public.forms;
create trigger trg_notify_form_created after insert on public.forms for each row execute function public.notify_form_created();
