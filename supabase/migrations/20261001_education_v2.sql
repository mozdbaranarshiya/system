-- سامانه آموزش و پرورش اصفهان - نسخه ۲
-- امکانات: تنظیم اعتراض، انضباط، تکالیف و فایل، گروه‌ها و ارزیابی سرگروه
-- این فایل را یک‌بار در Supabase SQL Editor اجرا کنید.

set role postgres;

-- تنظیمات عمومی سامانه
create table if not exists public.school_settings (
  id boolean primary key default true check (id = true),
  objections_open boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.school_settings(id, objections_open)
values (true, false)
on conflict (id) do nothing;

-- تشخیص نماینده کلاس
create or replace function public.is_class_representative(p_class uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1
    from public.class_representatives cr
    where cr.class_id=p_class and cr.student_id=auth.uid()
  )
$$;

-- نمره انضباط: ۱ عالی تا ۵ نیاز به تلاش
create table if not exists public.discipline_scores (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  note text,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(class_id, student_id)
);

-- گروه‌های کلاسی
create table if not exists public.student_groups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null,
  leader_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(teacher_id,class_id,subject_id,name)
);

create table if not exists public.student_group_members (
  group_id uuid not null references public.student_groups(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(group_id,student_id)
);

-- تکالیف؛ اگر group_id خالی باشد برای کل کلاس است.
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  group_id uuid references public.student_groups(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  original_name text not null,
  status text not null default 'pending'
    check(status in ('pending','graded','needs_revision')),
  score numeric(5,2) check(score between 0 and 20),
  feedback text,
  attempt int not null default 1 check(attempt > 0),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique(assignment_id,student_id)
);

-- فیلدهای امتیازدهی که معلم برای سرگروه تعریف می‌کند.
create table if not exists public.group_score_fields (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.student_groups(id) on delete cascade,
  title text not null,
  max_score numeric(5,2) not null default 20 check(max_score > 0),
  sort_order int not null default 0
);

create table if not exists public.group_score_entries (
  field_id uuid not null references public.group_score_fields(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(5,2) not null check(score >= 0),
  submitted_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(field_id,student_id)
);

create index if not exists idx_groups_teacher on public.student_groups(teacher_id);
create index if not exists idx_group_members_student on public.student_group_members(student_id);
create index if not exists idx_assignments_teacher on public.assignments(teacher_id);
create index if not exists idx_assignments_class on public.assignments(class_id);
create index if not exists idx_submissions_assignment on public.assignment_submissions(assignment_id);
create index if not exists idx_submissions_student on public.assignment_submissions(student_id);
create index if not exists idx_group_fields_group on public.group_score_fields(group_id);

-- آیا دانش‌آموز تکلیف را می‌بیند؟
create or replace function public.student_can_access_assignment(p_assignment uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1
    from public.assignments a
    where a.id=p_assignment
      and (
        (a.group_id is null and public.student_in_class(a.class_id))
        or
        (a.group_id is not null and exists(
          select 1 from public.student_group_members gm
          where gm.group_id=a.group_id and gm.student_id=auth.uid()
        ))
      )
  )
$$;

-- ثبت/ارسال مجدد فایل تکلیف توسط دانش‌آموز
create or replace function public.submit_assignment(
  p_assignment uuid,
  p_file_path text,
  p_original_name text
) returns public.assignment_submissions
language plpgsql security definer set search_path=public
as $$
declare
  a public.assignments;
  s public.assignment_submissions;
begin
  if split_part(p_file_path,'/',1) is distinct from auth.uid()::text then
    raise exception 'INVALID_FILE_PATH';
  end if;

  select * into a from public.assignments where id=p_assignment;
  if not found or not public.student_can_access_assignment(p_assignment) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into s
  from public.assignment_submissions
  where assignment_id=p_assignment and student_id=auth.uid()
  for update;

  if not found then
    if now() > a.due_at then raise exception 'DEADLINE_PASSED'; end if;

    insert into public.assignment_submissions(
      assignment_id,student_id,file_path,original_name,status,attempt,submitted_at
    ) values(
      p_assignment,auth.uid(),p_file_path,p_original_name,'pending',1,now()
    ) returning * into s;
  else
    if s.status='graded' then raise exception 'ALREADY_GRADED'; end if;
    if s.status='pending' and now() > a.due_at then raise exception 'DEADLINE_PASSED'; end if;

    update public.assignment_submissions set
      file_path=p_file_path,
      original_name=p_original_name,
      status='pending',
      score=null,
      feedback=null,
      attempt=s.attempt+1,
      submitted_at=now(),
      reviewed_at=null,
      reviewed_by=null
    where id=s.id
    returning * into s;
  end if;

  return s;
end
$$;

-- بررسی تکلیف توسط دبیر
create or replace function public.review_assignment_submission(
  p_submission uuid,
  p_status text,
  p_score numeric default null,
  p_feedback text default null
) returns public.assignment_submissions
language plpgsql security definer set search_path=public
as $$
declare
  s public.assignment_submissions;
  a public.assignments;
begin
  if p_status not in ('graded','needs_revision') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into s from public.assignment_submissions where id=p_submission for update;
  if not found then raise exception 'SUBMISSION_NOT_FOUND'; end if;

  select * into a from public.assignments where id=s.assignment_id;
  if not (public.is_manager() or a.teacher_id=auth.uid()) then
    raise exception 'ACCESS_DENIED';
  end if;

  if p_status='graded' and (p_score is null or p_score<0 or p_score>20) then
    raise exception 'INVALID_SCORE';
  end if;
  if p_status='needs_revision' and coalesce(trim(p_feedback),'')='' then
    raise exception 'FEEDBACK_REQUIRED';
  end if;

  update public.assignment_submissions set
    status=p_status,
    score=case when p_status='graded' then p_score else null end,
    feedback=p_feedback,
    reviewed_at=now(),
    reviewed_by=auth.uid()
  where id=p_submission
  returning * into s;

  return s;
end
$$;

alter table public.school_settings enable row level security;
alter table public.discipline_scores enable row level security;
alter table public.student_groups enable row level security;
alter table public.student_group_members enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.group_score_fields enable row level security;
alter table public.group_score_entries enable row level security;

drop policy if exists school_settings_read on public.school_settings;
create policy school_settings_read on public.school_settings
for select to authenticated using(true);

drop policy if exists school_settings_manager on public.school_settings;
create policy school_settings_manager on public.school_settings
for update to authenticated
using(public.is_manager())
with check(public.is_manager());

drop policy if exists discipline_read on public.discipline_scores;
create policy discipline_read on public.discipline_scores
for select to authenticated using(
  public.is_manager()
  or student_id=auth.uid()
  or public.is_class_representative(class_id)
  or exists(
    select 1 from public.teacher_assignments ta
    where ta.teacher_id=auth.uid() and ta.class_id=discipline_scores.class_id
  )
);

drop policy if exists discipline_write on public.discipline_scores;
create policy discipline_write on public.discipline_scores
for insert to authenticated with check(
  updated_by=auth.uid()
  and (public.is_manager() or public.is_class_representative(class_id))
);
drop policy if exists discipline_update on public.discipline_scores;
create policy discipline_update on public.discipline_scores
for update to authenticated using(
  public.is_manager() or public.is_class_representative(class_id)
) with check(
  updated_by=auth.uid()
  and (public.is_manager() or public.is_class_representative(class_id))
);

drop policy if exists groups_read on public.student_groups;
create policy groups_read on public.student_groups
for select to authenticated using(
  public.is_manager()
  or teacher_id=auth.uid()
  or leader_id=auth.uid()
  or exists(
    select 1 from public.student_group_members gm
    where gm.group_id=student_groups.id and gm.student_id=auth.uid()
  )
);

drop policy if exists groups_teacher_write on public.student_groups;
create policy groups_teacher_write on public.student_groups
for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(
  public.is_manager()
  or (
    teacher_id=auth.uid()
    and public.teacher_has_access(class_id,subject_id)
  )
);

drop policy if exists group_members_read on public.student_group_members;
create policy group_members_read on public.student_group_members
for select to authenticated using(
  public.is_manager()
  or student_id=auth.uid()
  or exists(
    select 1 from public.student_groups g
    where g.id=student_group_members.group_id
      and (g.teacher_id=auth.uid() or g.leader_id=auth.uid())
  )
);

drop policy if exists group_members_teacher_write on public.student_group_members;
create policy group_members_teacher_write on public.student_group_members
for all to authenticated
using(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=student_group_members.group_id and g.teacher_id=auth.uid()
  )
)
with check(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=student_group_members.group_id and g.teacher_id=auth.uid()
  )
);

drop policy if exists assignments_read on public.assignments;
create policy assignments_read on public.assignments
for select to authenticated using(
  public.is_manager()
  or teacher_id=auth.uid()
  or public.student_can_access_assignment(id)
);

drop policy if exists assignments_teacher_write on public.assignments;
create policy assignments_teacher_write on public.assignments
for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(
  public.is_manager()
  or (
    teacher_id=auth.uid()
    and public.teacher_has_access(class_id,subject_id)
    and (
      group_id is null
      or exists(
        select 1 from public.student_groups g
        where g.id=assignments.group_id
          and g.teacher_id=auth.uid()
          and g.class_id=assignments.class_id
          and g.subject_id=assignments.subject_id
      )
    )
  )
);

drop policy if exists submissions_read on public.assignment_submissions;
create policy submissions_read on public.assignment_submissions
for select to authenticated using(
  public.is_manager()
  or student_id=auth.uid()
  or exists(
    select 1 from public.assignments a
    where a.id=assignment_submissions.assignment_id and a.teacher_id=auth.uid()
  )
);

drop policy if exists group_fields_read on public.group_score_fields;
create policy group_fields_read on public.group_score_fields
for select to authenticated using(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=group_score_fields.group_id
      and (
        g.teacher_id=auth.uid()
        or g.leader_id=auth.uid()
        or exists(
          select 1 from public.student_group_members gm
          where gm.group_id=g.id and gm.student_id=auth.uid()
        )
      )
  )
);

drop policy if exists group_fields_teacher_write on public.group_score_fields;
create policy group_fields_teacher_write on public.group_score_fields
for all to authenticated
using(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=group_score_fields.group_id and g.teacher_id=auth.uid()
  )
)
with check(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=group_score_fields.group_id and g.teacher_id=auth.uid()
  )
);

drop policy if exists group_entries_read on public.group_score_entries;
create policy group_entries_read on public.group_score_entries
for select to authenticated using(
  public.is_manager()
  or student_id=auth.uid()
  or exists(
    select 1
    from public.group_score_fields f
    join public.student_groups g on g.id=f.group_id
    where f.id=group_score_entries.field_id
      and (g.teacher_id=auth.uid() or g.leader_id=auth.uid())
  )
);

drop policy if exists group_entries_leader_insert on public.group_score_entries;
create policy group_entries_leader_insert on public.group_score_entries
for insert to authenticated with check(
  submitted_by=auth.uid()
  and exists(
    select 1
    from public.group_score_fields f
    join public.student_groups g on g.id=f.group_id
    join public.student_group_members gm on gm.group_id=g.id
    where f.id=group_score_entries.field_id
      and g.leader_id=auth.uid()
      and gm.student_id=group_score_entries.student_id
      and group_score_entries.score <= f.max_score
  )
);

drop policy if exists group_entries_leader_update on public.group_score_entries;
create policy group_entries_leader_update on public.group_score_entries
for update to authenticated
using(
  public.is_manager()
  or exists(
    select 1
    from public.group_score_fields f
    join public.student_groups g on g.id=f.group_id
    where f.id=group_score_entries.field_id
      and (g.teacher_id=auth.uid() or g.leader_id=auth.uid())
  )
)
with check(
  submitted_by=auth.uid()
  and exists(
    select 1
    from public.group_score_fields f
    join public.student_groups g on g.id=f.group_id
    join public.student_group_members gm on gm.group_id=g.id
    where f.id=group_score_entries.field_id
      and (g.teacher_id=auth.uid() or g.leader_id=auth.uid())
      and gm.student_id=group_score_entries.student_id
      and group_score_entries.score <= f.max_score
  )
);

-- اعتراض فقط زمانی قابل ثبت است که مدیر آن را باز کرده باشد.
drop policy if exists obj_student_insert on public.objections;
create policy obj_student_insert on public.objections
for insert to authenticated with check(
  student_id=auth.uid()
  and exists(
    select 1 from public.school_settings ss
    where ss.id=true and ss.objections_open=true
  )
);

-- مخزن خصوصی فایل تکالیف
insert into storage.buckets(id,name,public,file_size_limit)
values ('assignment-files','assignment-files',false,20971520)
on conflict (id) do update
set public=false, file_size_limit=20971520;

drop policy if exists assignment_files_insert on storage.objects;
create policy assignment_files_insert on storage.objects
for insert to authenticated with check(
  bucket_id='assignment-files'
  and (storage.foldername(name))[1]=auth.uid()::text
);

drop policy if exists assignment_files_select on storage.objects;
create policy assignment_files_select on storage.objects
for select to authenticated using(
  bucket_id='assignment-files'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.is_manager()
    or exists(
      select 1
      from public.assignment_submissions s
      join public.assignments a on a.id=s.assignment_id
      where s.file_path=storage.objects.name
        and a.teacher_id=auth.uid()
    )
  )
);

drop policy if exists assignment_files_delete on storage.objects;
create policy assignment_files_delete on storage.objects
for delete to authenticated using(
  bucket_id='assignment-files'
  and (storage.foldername(name))[1]=auth.uid()::text
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.school_settings,
  public.discipline_scores,
  public.student_groups,
  public.student_group_members,
  public.assignments,
  public.assignment_submissions,
  public.group_score_fields,
  public.group_score_entries
to authenticated;

grant execute on function public.is_class_representative(uuid) to authenticated;
grant execute on function public.student_can_access_assignment(uuid) to authenticated;
grant execute on function public.submit_assignment(uuid,text,text) to authenticated;
grant execute on function public.review_assignment_submission(uuid,text,numeric,text) to authenticated;

-- service role برای Edge Functions
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.school_settings,
  public.discipline_scores,
  public.student_groups,
  public.student_group_members,
  public.assignments,
  public.assignment_submissions,
  public.group_score_fields,
  public.group_score_entries
to service_role;
