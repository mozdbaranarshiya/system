-- v7 / مرحله ۱۳: ارتقای کارنامه
set role postgres;

alter table public.school_settings
  add column if not exists passing_score numeric(5,2) not null default 10
  check(passing_score between 0 and 20);

create or replace function public.student_report_stats(p_student uuid)
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
    'attendance',jsonb_build_object(
      'total_absence',(select count(*) from public.attendance_records a where a.student_id=p_student and a.status in ('absent','excused_absence','unexcused_absence')),
      'unexcused_absence',(select count(*) from public.attendance_records a where a.student_id=p_student and a.status='unexcused_absence'),
      'late',(select count(*) from public.attendance_records a where a.student_id=p_student and a.status='late'),
      'late_minutes',(select coalesce(sum(a.delay_minutes),0) from public.attendance_records a where a.student_id=p_student and a.status='late')
    ),
    'behavior',jsonb_build_object(
      'positive_points',(select coalesce(sum(greatest(b.points,0)),0) from public.behavior_events b where b.student_id=p_student),
      'negative_points',(select coalesce(sum(least(b.points,0)),0) from public.behavior_events b where b.student_id=p_student)
    ),
    'passing_score',(select passing_score from public.school_settings where id=true)
  ) into result;
  return result;
end
$$;

grant execute on function public.student_report_stats(uuid) to authenticated;
