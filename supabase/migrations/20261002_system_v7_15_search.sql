-- v7 / مرحله ۱۵: جست‌وجوی سراسری سطح‌دسترسی‌محور
set role postgres;

create or replace function public.global_search(p_query text)
returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  q text:=trim(coalesce(p_query,''));
  result jsonb;
begin
  if length(q)<2 then return '[]'::jsonb; end if;

  with results as (
    -- کاربران؛ دسترسی صریح بر اساس نقش فعلی
    select
      case when p.role='student' then 'student' else 'teacher' end::text type,
      p.id entity_id,
      p.full_name title,
      case when public.is_manager() then p.national_id else
        case when p.id=auth.uid() then p.national_id else p.role::text end
      end subtitle,
      case when p.role='student' then 'studentProfile' else null end route,
      10 rank
    from public.profiles p
    where (
      p.full_name ilike '%'||q||'%'
      or (public.is_manager() and p.national_id like '%'||q||'%')
      or (p.id=auth.uid() and p.national_id like '%'||q||'%')
    )
    and (
      public.is_manager()
      or p.id=auth.uid()
      or (
        public.current_role()='teacher' and p.role='student'
        and exists(
          select 1 from public.class_students cs
          join public.teacher_assignments ta on ta.class_id=cs.class_id
          where cs.student_id=p.id and ta.teacher_id=auth.uid()
        )
      )
      or (public.current_role()='student' and p.role='teacher')
    )

    union all
    select 'class',c.id,c.title,g.title||' — '||c.academic_year,'timetable',20
    from public.classes c join public.grade_levels g on g.id=c.grade_id
    where (c.title ilike '%'||q||'%' or g.title ilike '%'||q||'%')
      and (
        public.is_manager()
        or public.student_in_class(c.id)
        or exists(select 1 from public.teacher_assignments ta where ta.class_id=c.id and ta.teacher_id=auth.uid())
      )

    union all
    select 'subject',s.id,s.title,g.title,null,30
    from public.subjects s join public.grade_levels g on g.id=s.grade_id
    where s.title ilike '%'||q||'%'
      and (
        public.is_manager()
        or exists(select 1 from public.teacher_assignments ta where ta.subject_id=s.id and ta.teacher_id=auth.uid())
        or exists(
          select 1 from public.class_students cs
          join public.classes c on c.id=cs.class_id
          where cs.student_id=auth.uid() and c.grade_id=s.grade_id
        )
      )

    union all
    select 'assignment',a.id,a.title,sub.title||' — '||c.title,'homework',40
    from public.assignments a
    join public.subjects sub on sub.id=a.subject_id
    join public.classes c on c.id=a.class_id
    where (a.title ilike '%'||q||'%' or coalesce(a.description,'') ilike '%'||q||'%')
      and (
        public.is_manager()
        or a.teacher_id=auth.uid()
        or public.student_can_access_assignment(a.id)
      )

    union all
    select 'exam',e.id,e.title,sub.title||' — '||c.title,'exams',50
    from public.exams e
    join public.subjects sub on sub.id=e.subject_id
    join public.classes c on c.id=e.class_id
    where (e.title ilike '%'||q||'%' or coalesce(e.description,'') ilike '%'||q||'%')
      and (
        public.is_manager()
        or e.teacher_id=auth.uid()
        or (e.published and public.student_in_class(e.class_id))
      )

    union all
    select 'announcement',a.id,a.title,left(a.body,80),'announcements',60
    from public.announcements a
    where (a.title ilike '%'||q||'%' or a.body ilike '%'||q||'%')
      and (
        public.is_manager()
        or a.created_by=auth.uid()
        or a.target_type='all'
        or (a.target_type='role' and a.target_role=public.current_role())
        or (a.target_type='user' and a.target_user_id=auth.uid())
        or (a.target_type='class' and (
          public.student_in_class(a.target_class_id)
          or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=a.target_class_id)
        ))
        or (a.target_type='group' and exists(
          select 1 from public.student_group_members gm where gm.group_id=a.target_group_id and gm.student_id=auth.uid()
        ))
      )

    union all
    select 'form',f.id,f.title,left(coalesce(f.description,''),80),'forms',70
    from public.forms f
    where (f.title ilike '%'||q||'%' or coalesce(f.description,'') ilike '%'||q||'%')
      and public.can_access_form(f.id)

    union all
    select 'extracurricular',e.id,e.title,coalesce(e.location,''),'extracurricular',80
    from public.extracurricular_classes e
    where (e.title ilike '%'||q||'%' or coalesce(e.description,'') ilike '%'||q||'%')
      and (e.active or public.is_manager() or e.teacher_id=auth.uid())
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'type',type,'id',entity_id,'title',title,'subtitle',subtitle,'route',route
  ) order by rank,title),'[]'::jsonb)
  into result
  from (select * from results limit 50) r;

  return result;
end
$$;

grant execute on function public.global_search(text) to authenticated;
