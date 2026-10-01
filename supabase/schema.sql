-- سامانه آموزش و پرورش استان اصفهان
-- اجرا در Supabase SQL Editor
create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('manager','teacher','student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.objection_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.score_component as enum ('continuous','final');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  national_id text not null unique check (national_id ~ '^[0-9]{10}$'),
  full_name text not null,
  role public.user_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.grade_levels (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  sort_order int not null default 0
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grade_levels(id) on delete cascade,
  title text not null,
  academic_year text not null default '1405-1406',
  unique(grade_id,title,academic_year)
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references public.grade_levels(id) on delete cascade,
  title text not null,
  unique(grade_id,title)
);

create table if not exists public.class_students (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  primary key(class_id,student_id)
);

create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  unique(teacher_id,class_id,subject_id)
);

create table if not exists public.class_representatives (
  class_id uuid primary key references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now()
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  period text not null default 'نوبت اول',
  continuous_score numeric(5,2) check (continuous_score between 0 and 20),
  final_score numeric(5,2) check (final_score between 0 and 20),
  lesson_score numeric(5,2) generated always as (
    case when continuous_score is null or final_score is null then null
         else round((continuous_score + final_score) / 2.0, 2) end
  ) stored,
  continuous_locked boolean not null default false,
  final_locked boolean not null default false,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique(student_id,class_id,subject_id,period)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  target_type text not null check(target_type in ('all','role','class','user')),
  target_role public.user_role,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (
    (target_type='all') or
    (target_type='role' and target_role is not null) or
    (target_type='class' and target_class_id is not null) or
    (target_type='user' and target_user_id is not null)
  )
);

create table if not exists public.objections (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references public.scores(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  component public.score_component not null,
  reason text not null,
  status public.objection_status not null default 'pending',
  teacher_response text,
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_scores_student on public.scores(student_id);
create index if not exists idx_scores_class_subject on public.scores(class_id,subject_id);
create index if not exists idx_assignments_teacher on public.teacher_assignments(teacher_id);
create index if not exists idx_objections_score on public.objections(score_id);

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce((select role='manager' from public.profiles where id=auth.uid()),false) $$;

create or replace function public.teacher_has_access(c uuid,s uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.teacher_assignments where teacher_id=auth.uid() and class_id=c and subject_id=s) $$;

create or replace function public.student_in_class(c uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.class_students where student_id=auth.uid() and class_id=c) $$;

alter table public.profiles enable row level security;
alter table public.grade_levels enable row level security;
alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.class_students enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.class_representatives enable row level security;
alter table public.scores enable row level security;
alter table public.announcements enable row level security;
alter table public.objections enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id=auth.uid() or public.is_manager() or
  (role='teacher' and public.current_role()='student') or
  (role='student' and public.current_role()='teacher')
);
drop policy if exists profiles_manager_write on public.profiles;
create policy profiles_manager_write on public.profiles for all to authenticated
using (public.is_manager()) with check (public.is_manager());

drop policy if exists grade_read on public.grade_levels;
create policy grade_read on public.grade_levels for select to authenticated using (true);
drop policy if exists grade_manager on public.grade_levels;
create policy grade_manager on public.grade_levels for all to authenticated using (public.is_manager()) with check(public.is_manager());

drop policy if exists class_read on public.classes;
create policy class_read on public.classes for select to authenticated using (true);
drop policy if exists class_manager on public.classes;
create policy class_manager on public.classes for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists subject_read on public.subjects;
create policy subject_read on public.subjects for select to authenticated using (true);
drop policy if exists subject_manager on public.subjects;
create policy subject_manager on public.subjects for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists cs_read on public.class_students;
create policy cs_read on public.class_students for select to authenticated using (
  public.is_manager() or student_id=auth.uid() or
  exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=class_students.class_id)
);
drop policy if exists cs_manager on public.class_students;
create policy cs_manager on public.class_students for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists ta_read on public.teacher_assignments;
create policy ta_read on public.teacher_assignments for select to authenticated using (
  public.is_manager() or teacher_id=auth.uid() or public.student_in_class(class_id)
);
drop policy if exists ta_manager on public.teacher_assignments;
create policy ta_manager on public.teacher_assignments for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists rep_read on public.class_representatives;
create policy rep_read on public.class_representatives for select to authenticated using(true);
drop policy if exists rep_manager on public.class_representatives;
create policy rep_manager on public.class_representatives for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists scores_read on public.scores;
create policy scores_read on public.scores for select to authenticated using (
  public.is_manager() or student_id=auth.uid() or public.teacher_has_access(class_id,subject_id)
);
drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores for insert to authenticated with check (
  public.is_manager() or public.teacher_has_access(class_id,subject_id)
);
drop policy if exists scores_update on public.scores;
create policy scores_update on public.scores for update to authenticated using (
  public.is_manager() or public.teacher_has_access(class_id,subject_id)
) with check (
  public.is_manager() or public.teacher_has_access(class_id,subject_id)
);
drop policy if exists scores_delete on public.scores;
create policy scores_delete on public.scores for delete to authenticated using(public.is_manager());

drop policy if exists ann_read on public.announcements;
create policy ann_read on public.announcements for select to authenticated using (
  public.is_manager() or created_by=auth.uid() or target_type='all' or
  (target_type='role' and target_role=public.current_role()) or
  (target_type='user' and target_user_id=auth.uid()) or
  (target_type='class' and (
    exists(select 1 from public.class_students cs where cs.student_id=auth.uid() and cs.class_id=target_class_id)
    or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=target_class_id)
  ))
);
drop policy if exists ann_manager on public.announcements;
create policy ann_manager on public.announcements for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists obj_read on public.objections;
create policy obj_read on public.objections for select to authenticated using (
  public.is_manager() or student_id=auth.uid() or exists(
    select 1 from public.scores sc
    where sc.id=objections.score_id and public.teacher_has_access(sc.class_id,sc.subject_id)
  )
);
drop policy if exists obj_student_insert on public.objections;
create policy obj_student_insert on public.objections for insert to authenticated with check(student_id=auth.uid());
drop policy if exists obj_teacher_update on public.objections;
create policy obj_teacher_update on public.objections for update to authenticated using (
  public.is_manager() or exists(
    select 1 from public.scores sc where sc.id=objections.score_id and public.teacher_has_access(sc.class_id,sc.subject_id)
  )
) with check (
  public.is_manager() or exists(
    select 1 from public.scores sc where sc.id=objections.score_id and public.teacher_has_access(sc.class_id,sc.subject_id)
  )
);

create or replace function public.save_score(
  p_student uuid,p_class uuid,p_subject uuid,p_period text,
  p_continuous numeric,p_final numeric
) returns public.scores
language plpgsql security definer set search_path=public
as $$
declare v public.scores;
begin
  if not (public.is_manager() or public.teacher_has_access(p_class,p_subject)) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v from public.scores
    where student_id=p_student and class_id=p_class and subject_id=p_subject and period=p_period
    for update;

  if not found then
    insert into public.scores(student_id,class_id,subject_id,period,continuous_score,final_score,updated_by)
    values(p_student,p_class,p_subject,p_period,p_continuous,p_final,auth.uid())
    returning * into v;
  else
    if v.continuous_locked and p_continuous is distinct from v.continuous_score then raise exception 'CONTINUOUS_LOCKED'; end if;
    if v.final_locked and p_final is distinct from v.final_score then raise exception 'FINAL_LOCKED'; end if;
    update public.scores set
      continuous_score=p_continuous, final_score=p_final, updated_by=auth.uid(), updated_at=now()
    where id=v.id returning * into v;
  end if;
  return v;
end $$;

create or replace function public.set_score_lock(
  p_class uuid,p_subject uuid,p_period text,p_component text,p_locked boolean
) returns void
language plpgsql security definer set search_path=public
as $$
begin
  if public.is_manager() then
    update public.scores set
      continuous_locked = case when p_component in ('continuous','both') then p_locked else continuous_locked end,
      final_locked = case when p_component in ('final','both') then p_locked else final_locked end
    where class_id=p_class and subject_id=p_subject and period=p_period;
  elsif public.teacher_has_access(p_class,p_subject) and p_locked=true and p_component in ('continuous','final') then
    update public.scores set
      continuous_locked = case when p_component='continuous' then true else continuous_locked end,
      final_locked = case when p_component='final' then true else final_locked end
    where class_id=p_class and subject_id=p_subject and period=p_period;
  else
    raise exception 'ACCESS_DENIED';
  end if;
end $$;

grant execute on function public.save_score(uuid,uuid,uuid,text,numeric,numeric) to authenticated;
grant execute on function public.set_score_lock(uuid,uuid,text,text,boolean) to authenticated;


-- Required PostgREST privileges.
-- RLS policies above still decide which rows each authenticated user may access.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles,
  public.grade_levels,
  public.classes,
  public.subjects,
  public.class_students,
  public.teacher_assignments,
  public.class_representatives,
  public.scores,
  public.announcements,
  public.objections
to authenticated;

grant execute on function public.current_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.teacher_has_access(uuid,uuid) to authenticated;
grant execute on function public.student_in_class(uuid) to authenticated;


-- Edge Functions using the Supabase secret/service-role key access profiles
-- through PostgREST, so table privileges are required in addition to BYPASSRLS.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.profiles to service_role;


-- سامانه آموزش و پرورش اصفهان - نسخه ۲
-- امکانات: تنظیم اعتراض، انضباط، تکالیف و فایل، گروه‌ها و ارزیابی سرگروه
-- این فایل را یک‌بار در Supabase SQL Editor اجرا کنید.

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


-- FIX: non-recursive group/homework RLS
-- Fix RLS recursion and group/homework access paths.
-- Run once in Supabase SQL Editor before publishing the related frontend fix.

set role postgres;

create or replace function public.students_share_class(p_student uuid)
returns boolean
language sql stable security definer set search_path=public
as $
  select exists(
    select 1
    from public.class_students mine
    join public.class_students peer on peer.class_id=mine.class_id
    where mine.student_id=auth.uid()
      and peer.student_id=p_student
  )
$;

create or replace function public.can_view_group(p_group uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or exists(
      select 1
      from public.student_groups g
      where g.id=p_group
        and (
          g.teacher_id=auth.uid()
          or g.leader_id=auth.uid()
          or exists(
            select 1
            from public.student_group_members gm
            where gm.group_id=g.id and gm.student_id=auth.uid()
          )
        )
    )
$$;

create or replace function public.can_manage_group(p_group uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or exists(
      select 1
      from public.student_groups g
      where g.id=p_group and g.teacher_id=auth.uid()
    )
$$;

create or replace function public.teacher_group_matches(
  p_group uuid,
  p_class uuid,
  p_subject uuid
)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1
    from public.student_groups g
    where g.id=p_group
      and g.teacher_id=auth.uid()
      and g.class_id=p_class
      and g.subject_id=p_subject
  )
$$;

create or replace function public.can_view_group_field(p_field uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1
    from public.group_score_fields f
    where f.id=p_field and public.can_view_group(f.group_id)
  )
$$;

create or replace function public.can_review_group_field(p_field uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or exists(
      select 1
      from public.group_score_fields f
      join public.student_groups g on g.id=f.group_id
      where f.id=p_field
        and (g.teacher_id=auth.uid() or g.leader_id=auth.uid())
    )
$$;

create or replace function public.can_submit_group_score(
  p_field uuid,
  p_student uuid,
  p_score numeric
)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or exists(
      select 1
      from public.group_score_fields f
      join public.student_groups g on g.id=f.group_id
      join public.student_group_members gm on gm.group_id=g.id
      where f.id=p_field
        and g.leader_id=auth.uid()
        and gm.student_id=p_student
        and p_score between 0 and f.max_score
    )
$$;

create or replace function public.can_read_assignment_file(p_path text)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or exists(
      select 1
      from public.assignment_submissions s
      join public.assignments a on a.id=s.assignment_id
      where s.file_path=p_path
        and (s.student_id=auth.uid() or a.teacher_id=auth.uid())
    )
$$;

-- Allow students to see the names of classmates/group members.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using(
  id=auth.uid()
  or public.is_manager()
  or (role='teacher' and public.current_role()='student')
  or (role='student' and public.current_role()='teacher')
  or (
    role='student'
    and public.current_role()='student'
    and public.students_share_class(id)
  )
);

-- Remove mutually recursive policies and rebuild them through SECURITY DEFINER helpers.
drop policy if exists groups_read on public.student_groups;
create policy groups_read on public.student_groups
for select to authenticated
using(public.can_view_group(id));

drop policy if exists group_members_read on public.student_group_members;
create policy group_members_read on public.student_group_members
for select to authenticated
using(
  public.is_manager()
  or student_id=auth.uid()
  or public.can_view_group(group_id)
);

drop policy if exists group_members_teacher_write on public.student_group_members;
create policy group_members_teacher_write on public.student_group_members
for all to authenticated
using(public.can_manage_group(group_id))
with check(public.can_manage_group(group_id));

drop policy if exists group_fields_read on public.group_score_fields;
create policy group_fields_read on public.group_score_fields
for select to authenticated
using(public.can_view_group_field(id));

drop policy if exists group_fields_teacher_write on public.group_score_fields;
create policy group_fields_teacher_write on public.group_score_fields
for all to authenticated
using(public.can_manage_group(group_id))
with check(public.can_manage_group(group_id));

drop policy if exists group_entries_read on public.group_score_entries;
create policy group_entries_read on public.group_score_entries
for select to authenticated
using(
  public.is_manager()
  or student_id=auth.uid()
  or public.can_review_group_field(field_id)
);

drop policy if exists group_entries_leader_insert on public.group_score_entries;
create policy group_entries_leader_insert on public.group_score_entries
for insert to authenticated
with check(
  submitted_by=auth.uid()
  and public.can_submit_group_score(field_id,student_id,score)
);

drop policy if exists group_entries_leader_update on public.group_score_entries;
create policy group_entries_leader_update on public.group_score_entries
for update to authenticated
using(
  public.is_manager()
  or public.can_review_group_field(field_id)
)
with check(
  submitted_by=auth.uid()
  and public.can_submit_group_score(field_id,student_id,score)
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
      or public.teacher_group_matches(group_id,class_id,subject_id)
    )
  )
);

drop policy if exists assignment_files_select on storage.objects;
create policy assignment_files_select on storage.objects
for select to authenticated
using(
  bucket_id='assignment-files'
  and (
    (storage.foldername(name))[1]=auth.uid()::text
    or public.can_read_assignment_file(name)
  )
);

grant execute on function public.students_share_class(uuid) to authenticated;
grant execute on function public.can_view_group(uuid) to authenticated;
grant execute on function public.can_manage_group(uuid) to authenticated;
grant execute on function public.teacher_group_matches(uuid,uuid,uuid) to authenticated;
grant execute on function public.can_view_group_field(uuid) to authenticated;
grant execute on function public.can_review_group_field(uuid) to authenticated;
grant execute on function public.can_submit_group_score(uuid,uuid,numeric) to authenticated;
grant execute on function public.can_read_assignment_file(text) to authenticated;

-- Quick integrity checks.
select
  has_function_privilege('authenticated','public.students_share_class(uuid)','EXECUTE') as classmates_exec,
  has_function_privilege('authenticated','public.can_view_group(uuid)','EXECUTE') as can_view_group_exec,
  has_function_privilege('authenticated','public.can_manage_group(uuid)','EXECUTE') as can_manage_group_exec,
  has_function_privilege('authenticated','public.teacher_group_matches(uuid,uuid,uuid)','EXECUTE') as teacher_group_matches_exec,
  has_function_privilege('authenticated','public.can_read_assignment_file(text)','EXECUTE') as assignment_file_exec;



-- سامانه آموزش و پرورش اصفهان - نسخه ۶
-- امکانات: کارنامه قابل کنترل، دفتر نمرات تکالیف، بایگانی نمرات گروهی و اطلاعیه دبیر

-- 1) کنترل نمایش کارنامه
alter table public.school_settings
  add column if not exists report_cards_open boolean not null default true;

-- 2) دفتر نمرات تکالیف؛ همه افراد هدف تکلیف از ابتدا نمره ۰ دارند.
create table if not exists public.homework_grades (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(5,2) not null default 0 check(score between 0 and 20),
  source text not null default 'automatic' check(source in ('automatic','submission','manager')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(assignment_id,student_id)
);

create index if not exists idx_homework_grades_student
  on public.homework_grades(student_id);
create index if not exists idx_homework_grades_assignment
  on public.homework_grades(assignment_id);

create or replace function public.sync_homework_gradebook(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.assignments;
begin
  select * into a from public.assignments where id=p_assignment;
  if not found then return; end if;

  if a.group_id is null then
    insert into public.homework_grades(assignment_id,student_id,score,source)
    select a.id,cs.student_id,0,'automatic'
    from public.class_students cs
    where cs.class_id=a.class_id
    on conflict(assignment_id,student_id) do nothing;
  else
    insert into public.homework_grades(assignment_id,student_id,score,source)
    select a.id,gm.student_id,0,'automatic'
    from public.student_group_members gm
    where gm.group_id=a.group_id
    on conflict(assignment_id,student_id) do nothing;
  end if;
end
$$;

create or replace function public.sync_homework_on_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.sync_homework_gradebook(new.id);
  return new;
end
$$;

drop trigger if exists trg_sync_homework_assignment on public.assignments;
create trigger trg_sync_homework_assignment
after insert on public.assignments
for each row execute function public.sync_homework_on_assignment();

create or replace function public.sync_homework_on_class_student()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.homework_grades(assignment_id,student_id,score,source)
  select a.id,new.student_id,0,'automatic'
  from public.assignments a
  where a.class_id=new.class_id and a.group_id is null
  on conflict(assignment_id,student_id) do nothing;
  return new;
end
$$;

drop trigger if exists trg_sync_homework_class_student on public.class_students;
create trigger trg_sync_homework_class_student
after insert on public.class_students
for each row execute function public.sync_homework_on_class_student();

create or replace function public.sync_homework_on_group_member()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.homework_grades(assignment_id,student_id,score,source)
  select a.id,new.student_id,0,'automatic'
  from public.assignments a
  where a.group_id=new.group_id
  on conflict(assignment_id,student_id) do nothing;
  return new;
end
$$;

drop trigger if exists trg_sync_homework_group_member on public.student_group_members;
create trigger trg_sync_homework_group_member
after insert on public.student_group_members
for each row execute function public.sync_homework_on_group_member();

-- داده‌های قبلی را هم وارد دفتر نمرات می‌کنیم.
insert into public.homework_grades(assignment_id,student_id,score,source)
select a.id,cs.student_id,0,'automatic'
from public.assignments a
join public.class_students cs on cs.class_id=a.class_id
where a.group_id is null
on conflict(assignment_id,student_id) do nothing;

insert into public.homework_grades(assignment_id,student_id,score,source)
select a.id,gm.student_id,0,'automatic'
from public.assignments a
join public.student_group_members gm on gm.group_id=a.group_id
where a.group_id is not null
on conflict(assignment_id,student_id) do nothing;

insert into public.homework_grades(assignment_id,student_id,score,source,updated_by,updated_at)
select s.assignment_id,s.student_id,coalesce(s.score,0),
       case when s.status='graded' and s.score is not null then 'submission' else 'automatic' end,
       s.reviewed_by,coalesce(s.reviewed_at,s.submitted_at)
from public.assignment_submissions s
on conflict(assignment_id,student_id) do update
set score=excluded.score,
    source=excluded.source,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at
where public.homework_grades.source <> 'manager';

-- نسخه جدید بررسی تکلیف: نمره دفتر تکالیف نیز همزمان به‌روز می‌شود.
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

  insert into public.homework_grades(
    assignment_id,student_id,score,source,updated_by,updated_at
  ) values(
    s.assignment_id,
    s.student_id,
    case when p_status='graded' then p_score else 0 end,
    case when p_status='graded' then 'submission' else 'automatic' end,
    auth.uid(),
    now()
  )
  on conflict(assignment_id,student_id) do update
  set score=excluded.score,
      source=excluded.source,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  where public.homework_grades.source <> 'manager';

  return s;
end
$$;

alter table public.homework_grades enable row level security;

drop policy if exists homework_grades_read on public.homework_grades;
create policy homework_grades_read on public.homework_grades
for select to authenticated using(
  public.is_manager()
  or student_id=auth.uid()
  or exists(
    select 1 from public.assignments a
    where a.id=homework_grades.assignment_id and a.teacher_id=auth.uid()
  )
);

drop policy if exists homework_grades_manager_update on public.homework_grades;
create policy homework_grades_manager_update on public.homework_grades
for update to authenticated
using(public.is_manager())
with check(public.is_manager());

-- 3) بایگانی نمرات ثبت‌شده توسط سرگروه‌ها
create table if not exists public.group_score_archives (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.student_groups(id) on delete cascade,
  field_id uuid references public.group_score_fields(id) on delete set null,
  field_title text not null,
  field_max_score numeric(5,2) not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(5,2) not null,
  submitted_by uuid not null references public.profiles(id),
  original_updated_at timestamptz,
  archived_by uuid not null references public.profiles(id),
  archived_at timestamptz not null default now()
);

create index if not exists idx_group_score_archives_group
  on public.group_score_archives(group_id,archived_at desc);

create or replace function public.archive_group_scores(
  p_group uuid,
  p_entries jsonb
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  v_field uuid;
  v_student uuid;
  f public.group_score_fields;
  e public.group_score_entries;
  count_archived integer := 0;
begin
  if not (
    public.is_manager()
    or exists(
      select 1 from public.student_groups g
      where g.id=p_group and g.teacher_id=auth.uid()
    )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'INVALID_DATA';
  end if;

  for item in select value from jsonb_array_elements(p_entries)
  loop
    v_field := (item->>'field_id')::uuid;
    v_student := (item->>'student_id')::uuid;

    select * into f from public.group_score_fields
    where id=v_field and group_id=p_group;
    if not found then continue; end if;

    select * into e from public.group_score_entries
    where field_id=v_field and student_id=v_student
    for update;
    if not found then continue; end if;

    insert into public.group_score_archives(
      group_id,field_id,field_title,field_max_score,student_id,score,
      submitted_by,original_updated_at,archived_by
    ) values(
      p_group,f.id,f.title,f.max_score,e.student_id,e.score,
      e.submitted_by,e.updated_at,auth.uid()
    );

    delete from public.group_score_entries
    where field_id=v_field and student_id=v_student;

    count_archived := count_archived + 1;
  end loop;

  return count_archived;
end
$$;

alter table public.group_score_archives enable row level security;

drop policy if exists group_archives_read on public.group_score_archives;
create policy group_archives_read on public.group_score_archives
for select to authenticated using(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=group_score_archives.group_id and g.teacher_id=auth.uid()
  )
);

-- 4) اطلاعیه معلم برای کلاس، دانش‌آموز و گروه
alter table public.announcements
  add column if not exists target_group_id uuid references public.student_groups(id) on delete cascade;

alter table public.announcements
  drop constraint if exists announcements_target_type_check;
alter table public.announcements
  add constraint announcements_target_type_check
  check(target_type in ('all','role','class','user','group'));

alter table public.announcements
  drop constraint if exists announcements_check;
alter table public.announcements
  drop constraint if exists announcements_target_fields_check;
alter table public.announcements
  add constraint announcements_target_fields_check check(
    (target_type='all') or
    (target_type='role' and target_role is not null) or
    (target_type='class' and target_class_id is not null) or
    (target_type='user' and target_user_id is not null) or
    (target_type='group' and target_group_id is not null)
  );

drop policy if exists ann_read on public.announcements;
create policy ann_read on public.announcements
for select to authenticated using(
  public.is_manager()
  or created_by=auth.uid()
  or target_type='all'
  or (target_type='role' and target_role=public.current_role())
  or (target_type='user' and target_user_id=auth.uid())
  or (
    target_type='class' and (
      exists(
        select 1 from public.class_students cs
        where cs.student_id=auth.uid() and cs.class_id=target_class_id
      )
      or exists(
        select 1 from public.teacher_assignments ta
        where ta.teacher_id=auth.uid() and ta.class_id=target_class_id
      )
    )
  )
  or (
    target_type='group' and exists(
      select 1 from public.student_group_members gm
      where gm.group_id=target_group_id and gm.student_id=auth.uid()
    )
  )
);

drop policy if exists ann_teacher_insert on public.announcements;
create policy ann_teacher_insert on public.announcements
for insert to authenticated
with check(
  public.current_role()='teacher'
  and created_by=auth.uid()
  and (
    (
      target_type='class'
      and exists(
        select 1 from public.teacher_assignments ta
        where ta.teacher_id=auth.uid() and ta.class_id=target_class_id
      )
    )
    or (
      target_type='user'
      and exists(
        select 1
        from public.teacher_assignments ta
        join public.class_students cs on cs.class_id=ta.class_id
        where ta.teacher_id=auth.uid() and cs.student_id=target_user_id
      )
    )
    or (
      target_type='group'
      and exists(
        select 1 from public.student_groups g
        where g.id=target_group_id and g.teacher_id=auth.uid()
      )
    )
  )
);

-- دسترسی‌های PostgREST
grant select,update on table public.homework_grades to authenticated;
grant select on table public.group_score_archives to authenticated;
grant execute on function public.sync_homework_gradebook(uuid) to authenticated;
grant execute on function public.archive_group_scores(uuid,jsonb) to authenticated;
grant execute on function public.review_assignment_submission(uuid,text,numeric,text) to authenticated;

-- تست سریع
select
  has_table_privilege('authenticated','public.homework_grades','SELECT') as homework_grades_read,
  has_table_privilege('authenticated','public.group_score_archives','SELECT') as group_archives_read,
  has_function_privilege('authenticated','public.archive_group_scores(uuid,jsonb)','EXECUTE') as archive_group_scores_exec;
