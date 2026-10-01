-- سامانه آموزش و پرورش اصفهان - نسخه ۶
-- امکانات: کارنامه قابل کنترل، دفتر نمرات تکالیف، بایگانی نمرات گروهی و اطلاعیه دبیر

set role postgres;

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
