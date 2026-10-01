-- Fix RLS recursion and group/homework access paths.
-- Run once in Supabase SQL Editor before publishing the related frontend fix.

set role postgres;

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
using(
  public.is_manager()
  or exists(
    select 1 from public.student_groups g
    where g.id=group_score_fields.group_id and g.teacher_id=auth.uid()
  )
)
with check(
  public.is_manager()
  or public.can_manage_group(group_id)
);

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

grant execute on function public.can_view_group(uuid) to authenticated;
grant execute on function public.can_manage_group(uuid) to authenticated;
grant execute on function public.teacher_group_matches(uuid,uuid,uuid) to authenticated;
grant execute on function public.can_view_group_field(uuid) to authenticated;
grant execute on function public.can_review_group_field(uuid) to authenticated;
grant execute on function public.can_submit_group_score(uuid,uuid,numeric) to authenticated;
grant execute on function public.can_read_assignment_file(text) to authenticated;

-- Quick integrity checks.
select
  has_function_privilege('authenticated','public.can_view_group(uuid)','EXECUTE') as can_view_group_exec,
  has_function_privilege('authenticated','public.can_manage_group(uuid)','EXECUTE') as can_manage_group_exec,
  has_function_privilege('authenticated','public.teacher_group_matches(uuid,uuid,uuid)','EXECUTE') as teacher_group_matches_exec,
  has_function_privilege('authenticated','public.can_read_assignment_file(text)','EXECUTE') as assignment_file_exec;
