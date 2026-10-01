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
