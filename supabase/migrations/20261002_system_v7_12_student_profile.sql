-- v7 / مرحله ۱۲: پرونده جامع دانش‌آموز
set role postgres;

create or replace function public.can_view_student_profile(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select
    public.is_manager()
    or p_student=auth.uid()
    or exists(
      select 1
      from public.class_students cs
      join public.teacher_assignments ta on ta.class_id=cs.class_id
      where cs.student_id=p_student and ta.teacher_id=auth.uid()
    )
$$;
grant execute on function public.can_view_student_profile(uuid) to authenticated;

create or replace function public.student_profile_bundle(p_student uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
begin
  if not public.can_view_student_profile(p_student) then raise exception 'ACCESS_DENIED'; end if;

  select jsonb_build_object(
    'profile',(select to_jsonb(p) - 'password_required_at' from public.profiles p where p.id=p_student),
    'classes',coalesce((
      select jsonb_agg(jsonb_build_object('class_id',cs.class_id,'class_title',c.title,'academic_year',c.academic_year,'grade_id',c.grade_id))
      from public.class_students cs join public.classes c on c.id=cs.class_id
      where cs.student_id=p_student
    ),'[]'::jsonb),
    'scores',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.period,s.updated_at desc)
      from public.scores s where s.student_id=p_student
    ),'[]'::jsonb),
    'attendance',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.attendance_date desc)
      from public.attendance_records a where a.student_id=p_student
    ),'[]'::jsonb),
    'homework_grades',coalesce((
      select jsonb_agg(to_jsonb(h))
      from public.homework_grades h where h.student_id=p_student
    ),'[]'::jsonb),
    'exam_attempts',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.started_at desc)
      from public.exam_attempts a where a.student_id=p_student
    ),'[]'::jsonb),
    'behavior',coalesce((
      select jsonb_agg(to_jsonb(b) order by b.event_date desc)
      from public.behavior_events b where b.student_id=p_student
    ),'[]'::jsonb),
    'discipline',coalesce((
      select jsonb_agg(to_jsonb(d))
      from public.discipline_scores d where d.student_id=p_student
    ),'[]'::jsonb),
    'objections',coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at desc)
      from public.objections o where o.student_id=p_student
    ),'[]'::jsonb),
    'extracurricular',coalesce((
      select jsonb_agg(jsonb_build_object('enrollment',to_jsonb(e),'class',to_jsonb(c)))
      from public.extracurricular_enrollments e
      join public.extracurricular_classes c on c.id=e.class_id
      where e.student_id=p_student
    ),'[]'::jsonb),
    'forms',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.submitted_at desc)
      from public.form_submissions s where s.user_id=p_student
    ),'[]'::jsonb)
  ) into result;

  return result;
end
$$;

grant execute on function public.student_profile_bundle(uuid) to authenticated;
