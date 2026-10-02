-- v7 / مرحله ۱۴: گزارش‌های تجمیعی
set role postgres;

create or replace function public.report_data(
  p_type text,
  p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  result jsonb;
  v_class uuid:=nullif(p_filters->>'class_id','')::uuid;
  v_subject uuid:=nullif(p_filters->>'subject_id','')::uuid;
  v_student uuid:=nullif(p_filters->>'student_id','')::uuid;
  v_teacher uuid:=nullif(p_filters->>'teacher_id','')::uuid;
  v_from date:=coalesce(nullif(p_filters->>'from','')::date,current_date-interval '30 days');
  v_to date:=coalesce(nullif(p_filters->>'to','')::date,current_date);
begin
  if not public.is_manager() then raise exception 'MANAGER_ONLY'; end if;

  case p_type
    when 'students' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'name',p.full_name,'national_id',p.national_id,
        'class',c.title,'grade',g.title,'academic_year',c.academic_year,'active',p.active
      ) order by g.sort_order,c.title,p.full_name),'[]'::jsonb)
      into result
      from public.profiles p
      left join public.class_students cs on cs.student_id=p.id
      left join public.classes c on c.id=cs.class_id
      left join public.grade_levels g on g.id=c.grade_id
      where p.role='student' and (v_class is null or c.id=v_class);

    when 'teachers' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'name',p.full_name,'national_id',p.national_id,'active',p.active,
        'assignments',coalesce(x.cnt,0)
      ) order by p.full_name),'[]'::jsonb)
      into result
      from public.profiles p
      left join (
        select teacher_id,count(*) cnt from public.teacher_assignments group by teacher_id
      ) x on x.teacher_id=p.id
      where p.role='teacher';

    when 'classes' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'grade',g.title,'class',c.title,'academic_year',c.academic_year,
        'students',(select count(*) from public.class_students cs where cs.class_id=c.id),
        'teacher_assignments',(select count(*) from public.teacher_assignments ta where ta.class_id=c.id)
      ) order by g.sort_order,c.title),'[]'::jsonb)
      into result
      from public.classes c join public.grade_levels g on g.id=c.grade_id
      where v_class is null or c.id=v_class;

    when 'scores' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'student',p.full_name,'national_id',p.national_id,'class',c.title,'subject',sub.title,
        'period',s.period,'continuous',s.continuous_score,'final',s.final_score,'lesson',s.lesson_score
      ) order by c.title,p.full_name,sub.title,s.period),'[]'::jsonb)
      into result
      from public.scores s
      join public.profiles p on p.id=s.student_id
      join public.classes c on c.id=s.class_id
      join public.subjects sub on sub.id=s.subject_id
      where (v_class is null or s.class_id=v_class)
        and (v_subject is null or s.subject_id=v_subject)
        and (v_student is null or s.student_id=v_student);

    when 'averages' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'student',p.full_name,'national_id',p.national_id,'class',c.title,
        'average',round(avg(s.lesson_score),2),'completed_lessons',count(s.lesson_score)
      ) order by c.title,p.full_name),'[]'::jsonb)
      into result
      from public.profiles p
      join public.class_students cs on cs.student_id=p.id
      join public.classes c on c.id=cs.class_id
      left join public.scores s on s.student_id=p.id and s.class_id=c.id and s.lesson_score is not null
      where p.role='student' and (v_class is null or c.id=v_class)
        and (v_student is null or p.id=v_student)
      group by p.id,p.full_name,p.national_id,c.id,c.title;

    when 'attendance' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',a.attendance_date,'student',p.full_name,'national_id',p.national_id,
        'class',c.title,'subject',sub.title,'status',a.status,'delay_minutes',a.delay_minutes,'note',a.note
      ) order by a.attendance_date desc,c.title,p.full_name),'[]'::jsonb)
      into result
      from public.attendance_records a
      join public.profiles p on p.id=a.student_id
      join public.classes c on c.id=a.class_id
      left join public.subjects sub on sub.id=a.subject_id
      where a.attendance_date between v_from and v_to
        and (v_class is null or a.class_id=v_class)
        and (v_subject is null or a.subject_id=v_subject)
        and (v_student is null or a.student_id=v_student);

    when 'homework' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'student',p.full_name,'class',c.title,'subject',sub.title,'assignment',a.title,
        'score',hg.score,'source',hg.source,'due_at',a.due_at
      ) order by a.due_at desc,p.full_name),'[]'::jsonb)
      into result
      from public.homework_grades hg
      join public.assignments a on a.id=hg.assignment_id
      join public.profiles p on p.id=hg.student_id
      join public.classes c on c.id=a.class_id
      join public.subjects sub on sub.id=a.subject_id
      where (v_class is null or a.class_id=v_class)
        and (v_subject is null or a.subject_id=v_subject)
        and (v_student is null or hg.student_id=v_student)
        and a.due_at::date between v_from and v_to;

    when 'exams' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'exam',e.title,'class',c.title,'subject',sub.title,'student',p.full_name,
        'status',a.status,'auto_score',a.auto_score,'manual_score',a.manual_score,
        'total_score',a.total_score,'started_at',a.started_at,'submitted_at',a.submitted_at
      ) order by e.start_at desc,p.full_name),'[]'::jsonb)
      into result
      from public.exam_attempts a
      join public.exams e on e.id=a.exam_id
      join public.profiles p on p.id=a.student_id
      join public.classes c on c.id=e.class_id
      join public.subjects sub on sub.id=e.subject_id
      where (v_class is null or e.class_id=v_class)
        and (v_subject is null or e.subject_id=v_subject)
        and (v_student is null or a.student_id=v_student)
        and e.start_at::date between v_from and v_to;

    when 'discipline' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'student',p.full_name,'class',c.title,'score',d.score,'note',d.note,'updated_at',d.updated_at
      ) order by c.title,p.full_name),'[]'::jsonb)
      into result
      from public.discipline_scores d
      join public.profiles p on p.id=d.student_id
      join public.classes c on c.id=d.class_id
      where (v_class is null or d.class_id=v_class)
        and (v_student is null or d.student_id=v_student);

    when 'behavior' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'date',b.event_date,'student',p.full_name,'class',c.title,'category',b.category,
        'type',b.event_type,'title',b.title,'points',b.points,'description',b.description
      ) order by b.event_date desc,p.full_name),'[]'::jsonb)
      into result
      from public.behavior_events b
      join public.profiles p on p.id=b.student_id
      join public.classes c on c.id=b.class_id
      where b.event_date between v_from and v_to
        and (v_class is null or b.class_id=v_class)
        and (v_student is null or b.student_id=v_student);

    when 'objections' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'student',p.full_name,'subject',sub.title,'component',o.component,'reason',o.reason,
        'status',o.status,'response',o.response,'created_at',o.created_at,'resolved_at',o.resolved_at
      ) order by o.created_at desc),'[]'::jsonb)
      into result
      from public.objections o
      join public.profiles p on p.id=o.student_id
      join public.scores s on s.id=o.score_id
      join public.subjects sub on sub.id=s.subject_id
      where (v_subject is null or s.subject_id=v_subject)
        and (v_student is null or o.student_id=v_student)
        and o.created_at::date between v_from and v_to;

    when 'extracurricular' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'class',c.title,'category',c.category,'student',p.full_name,'status',e.status,
        'registered_at',e.registered_at,'teacher',tp.full_name
      ) order by c.title,p.full_name),'[]'::jsonb)
      into result
      from public.extracurricular_enrollments e
      join public.extracurricular_classes c on c.id=e.class_id
      join public.profiles p on p.id=e.student_id
      left join public.profiles tp on tp.id=c.teacher_id
      where (v_student is null or e.student_id=v_student)
        and (v_teacher is null or c.teacher_id=v_teacher);

    when 'forms' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'form',f.title,'user',p.full_name,'submitted_at',s.submitted_at
      ) order by s.submitted_at desc),'[]'::jsonb)
      into result
      from public.form_submissions s
      join public.forms f on f.id=s.form_id
      join public.profiles p on p.id=s.user_id
      where s.submitted_at::date between v_from and v_to
        and (v_student is null or s.user_id=v_student);

    when 'polls' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'poll',p.title,'anonymous',p.anonymous,'participants',
        (select count(*) from public.poll_votes v where v.poll_id=p.id),
        'starts_at',p.starts_at,'ends_at',p.ends_at
      ) order by p.created_at desc),'[]'::jsonb)
      into result
      from public.polls p
      where p.created_at::date between v_from and v_to;

    else
      raise exception 'INVALID_REPORT_TYPE';
  end case;

  return coalesce(result,'[]'::jsonb);
end
$$;

grant execute on function public.report_data(text,jsonb) to authenticated;
