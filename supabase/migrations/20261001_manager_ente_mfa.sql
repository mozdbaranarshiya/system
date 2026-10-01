-- سامانه آموزش و پرورش اصفهان
-- احراز هویت دومرحله‌ای TOTP فقط برای مدیر (سازگار با Ente Auth)
-- این migration را یک‌بار در Supabase SQL Editor اجرا کنید.

set role postgres;

-- تشخیص نقش مدیر بدون درنظرگرفتن MFA؛ فقط برای جریان ورود/تشخیص نقش.
create or replace function public.is_manager_role()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    (select role='manager' from public.profiles where id=auth.uid()),
    false
  )
$$;

-- همه دسترسی‌های مدیریتی موجود از این پس علاوه بر نقش مدیر به AAL2 نیاز دارند.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    coalesce(
      (select role='manager' from public.profiles where id=auth.uid()),
      false
    )
    and coalesce(auth.jwt()->>'aal','aal1')='aal2'
$$;

-- برای سیاست‌های محدودکننده: کاربران غیرمدیر همان رفتار قبلی را دارند،
-- ولی مدیر فقط پس از TOTP اجازه عبور دارد.
create or replace function public.manager_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    (
      select
        role <> 'manager'
        or coalesce(auth.jwt()->>'aal','aal1')='aal2'
      from public.profiles
      where id=auth.uid()
    ),
    false
  )
$$;

grant execute on function public.is_manager_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.manager_mfa_ok() to authenticated;

-- مدیر در AAL1 فقط باید بتواند پروفایل خودش را بخواند تا برنامه تشخیص دهد
-- که باید صفحه Ente Auth / TOTP را نشان دهد.
drop policy if exists manager_mfa_guard_profiles on public.profiles;
create policy manager_mfa_guard_profiles
on public.profiles
as restrictive
for select
to authenticated
using (
  public.manager_mfa_ok()
  or id=auth.uid()
);

-- این جدول‌ها برای مدیرِ AAL1 کاملاً بسته می‌شوند.
drop policy if exists manager_mfa_guard_grade_levels on public.grade_levels;
create policy manager_mfa_guard_grade_levels on public.grade_levels
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_classes on public.classes;
create policy manager_mfa_guard_classes on public.classes
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_subjects on public.subjects;
create policy manager_mfa_guard_subjects on public.subjects
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_class_students on public.class_students;
create policy manager_mfa_guard_class_students on public.class_students
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_teacher_assignments on public.teacher_assignments;
create policy manager_mfa_guard_teacher_assignments on public.teacher_assignments
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_class_representatives on public.class_representatives;
create policy manager_mfa_guard_class_representatives on public.class_representatives
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_scores on public.scores;
create policy manager_mfa_guard_scores on public.scores
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_announcements on public.announcements;
create policy manager_mfa_guard_announcements on public.announcements
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_objections on public.objections;
create policy manager_mfa_guard_objections on public.objections
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_school_settings on public.school_settings;
create policy manager_mfa_guard_school_settings on public.school_settings
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_discipline_scores on public.discipline_scores;
create policy manager_mfa_guard_discipline_scores on public.discipline_scores
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_student_groups on public.student_groups;
create policy manager_mfa_guard_student_groups on public.student_groups
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_student_group_members on public.student_group_members;
create policy manager_mfa_guard_student_group_members on public.student_group_members
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_assignments on public.assignments;
create policy manager_mfa_guard_assignments on public.assignments
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_assignment_submissions on public.assignment_submissions;
create policy manager_mfa_guard_assignment_submissions on public.assignment_submissions
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_group_score_fields on public.group_score_fields;
create policy manager_mfa_guard_group_score_fields on public.group_score_fields
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_group_score_entries on public.group_score_entries;
create policy manager_mfa_guard_group_score_entries on public.group_score_entries
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_homework_grades on public.homework_grades;
create policy manager_mfa_guard_homework_grades on public.homework_grades
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

drop policy if exists manager_mfa_guard_group_score_archives on public.group_score_archives;
create policy manager_mfa_guard_group_score_archives on public.group_score_archives
as restrictive for all to authenticated
using (public.manager_mfa_ok())
with check (public.manager_mfa_ok());

-- فایل‌های تکلیف نیز برای مدیرِ بدون MFA قابل خواندن/تغییر نیست.
drop policy if exists manager_mfa_guard_assignment_files on storage.objects;
create policy manager_mfa_guard_assignment_files
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id <> 'assignment-files'
  or public.manager_mfa_ok()
)
with check (
  bucket_id <> 'assignment-files'
  or public.manager_mfa_ok()
);

select
  has_function_privilege('authenticated','public.is_manager_role()','EXECUTE') as manager_role_exec,
  has_function_privilege('authenticated','public.manager_mfa_ok()','EXECUTE') as manager_mfa_exec;
