-- Fix API privileges for the school system.
-- Run this entire file in Supabase SQL Editor.
-- IMPORTANT: do NOT grant access to auth.users.

set role postgres;

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
grant execute on function public.teacher_has_access(uuid, uuid) to authenticated;
grant execute on function public.student_in_class(uuid) to authenticated;
grant execute on function public.save_score(uuid, uuid, uuid, text, numeric, numeric) to authenticated;
grant execute on function public.set_score_lock(uuid, uuid, text, text, boolean) to authenticated;

-- No privileges are granted on auth.users; browser clients should use public.profiles instead.

-- Quick checks: these should all return true for the listed privileges.
select
  has_schema_privilege('authenticated', 'public', 'USAGE') as public_schema_usage,
  has_table_privilege('authenticated', 'public.profiles', 'SELECT') as profiles_select,
  has_table_privilege('authenticated', 'public.grade_levels', 'INSERT') as grades_insert,
  has_table_privilege('authenticated', 'public.classes', 'INSERT') as classes_insert,
  has_table_privilege('authenticated', 'public.subjects', 'INSERT') as subjects_insert,
  has_table_privilege('authenticated', 'public.class_students', 'INSERT') as class_students_insert,
  has_table_privilege('authenticated', 'public.teacher_assignments', 'INSERT') as assignments_insert,
  has_table_privilege('authenticated', 'public.class_representatives', 'INSERT') as representatives_insert,
  has_table_privilege('authenticated', 'public.scores', 'UPDATE') as scores_update,
  has_table_privilege('authenticated', 'public.announcements', 'INSERT') as announcements_insert,
  has_table_privilege('authenticated', 'public.objections', 'INSERT') as objections_insert;
