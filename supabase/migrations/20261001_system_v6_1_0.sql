-- سامانه آموزش و پرورش اصفهان - نسخه ۶.۱.۰
-- سرعت: Bootstrap تک‌درخواست + ایندکس‌ها
-- پایداری: بایگانی نمرات گروه با آرایه کلیدهای متنی

set role postgres;

create index if not exists idx_classes_grade on public.classes(grade_id);
create index if not exists idx_subjects_grade on public.subjects(grade_id);
create index if not exists idx_class_students_student on public.class_students(student_id);
create index if not exists idx_teacher_assignments_class_subject on public.teacher_assignments(class_id,subject_id);
create index if not exists idx_representatives_student on public.class_representatives(student_id);
create index if not exists idx_announcements_created_at on public.announcements(created_at desc);
create index if not exists idx_group_entries_student on public.group_score_entries(student_id);
create index if not exists idx_group_archives_group_time on public.group_score_archives(group_id,archived_at desc);
create index if not exists idx_homework_grades_assignment_student on public.homework_grades(assignment_id,student_id);

create or replace function public.get_app_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'national_id',p.national_id,
        'full_name',p.full_name,
        'role',p.role,
        'active',p.active
      ) order by p.full_name)
      from public.profiles p
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',g.id,
        'title',g.title,
        'sort_order',g.sort_order
      ) order by g.sort_order,g.title)
      from public.grade_levels g
    ), '[]'::jsonb),
    'classes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,
        'grade_id',c.grade_id,
        'title',c.title,
        'academic_year',c.academic_year
      ) order by c.title)
      from public.classes c
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,
        'grade_id',s.grade_id,
        'title',s.title
      ) order by s.title)
      from public.subjects s
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ta.id,
        'teacher_id',ta.teacher_id,
        'class_id',ta.class_id,
        'subject_id',ta.subject_id
      ) order by ta.id)
      from public.teacher_assignments ta
    ), '[]'::jsonb),
    'classStudents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class_id',cs.class_id,
        'student_id',cs.student_id
      ) order by cs.class_id,cs.student_id)
      from public.class_students cs
    ), '[]'::jsonb),
    'representatives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class_id',cr.class_id,
        'student_id',cr.student_id
      ) order by cr.class_id)
      from public.class_representatives cr
    ), '[]'::jsonb)
  )
$$;

grant execute on function public.get_app_bootstrap() to authenticated;

create or replace function public.archive_group_scores_v2(
  p_group uuid,
  p_keys text[]
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  k text;
  v_field uuid;
  v_student uuid;
  f public.group_score_fields;
  e public.group_score_entries;
  count_archived integer := 0;
begin
  if p_keys is null or coalesce(array_length(p_keys,1),0)=0 then
    raise exception 'NO_SELECTION';
  end if;

  if not (
    public.is_manager()
    or exists(
      select 1
      from public.student_groups g
      where g.id=p_group and g.teacher_id=auth.uid()
    )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  foreach k in array p_keys
  loop
    begin
      v_field := split_part(k,'|',1)::uuid;
      v_student := split_part(k,'|',2)::uuid;
    exception when others then
      continue;
    end;

    select * into f
    from public.group_score_fields
    where id=v_field and group_id=p_group;

    if not found then continue; end if;

    select * into e
    from public.group_score_entries
    where field_id=v_field and student_id=v_student
    for update;

    if not found then continue; end if;

    insert into public.group_score_archives(
      group_id,field_id,field_title,field_max_score,student_id,score,
      submitted_by,original_updated_at,archived_by,archived_at
    ) values(
      p_group,f.id,f.title,f.max_score,e.student_id,e.score,
      e.submitted_by,e.updated_at,auth.uid(),now()
    );

    delete from public.group_score_entries
    where field_id=v_field and student_id=v_student;

    count_archived := count_archived + 1;
  end loop;

  if count_archived=0 then
    raise exception 'NOTHING_ARCHIVED';
  end if;

  return count_archived;
end
$$;

grant execute on function public.archive_group_scores_v2(uuid,text[]) to authenticated;

select
  has_function_privilege('authenticated','public.get_app_bootstrap()','EXECUTE') as bootstrap_exec,
  has_function_privilege('authenticated','public.archive_group_scores_v2(uuid,text[])','EXECUTE') as archive_v2_exec;
