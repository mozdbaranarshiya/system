-- v8 / 04: Extracurricular classes, appointments, aggregated profile/reports/search/dashboard
set role postgres;

create table if not exists public.extracurricular_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'other' check(category in (
    'remedial','sports','art','cultural','language','olympiad','laboratory','other'
  )),
  teacher_id uuid references public.profiles(id) on delete set null,
  capacity integer not null default 20 check(capacity>0),
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_start timestamptz,
  registration_end timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extracurricular_time_check check(ends_at is null or starts_at is null or ends_at>=starts_at),
  constraint extracurricular_reg_time_check check(registration_end is null or registration_start is null or registration_end>=registration_start)
);

create table if not exists public.extracurricular_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  note text,
  created_at timestamptz not null default now(),
  constraint extracurricular_session_time_check check(ends_at>starts_at)
);

create table if not exists public.extracurricular_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extracurricular_one_enrollment unique(class_id,student_id)
);

create index if not exists idx_extracurricular_active on public.extracurricular_classes(active,registration_start,registration_end);
create index if not exists idx_extracurricular_teacher on public.extracurricular_classes(teacher_id);
create index if not exists idx_extracurricular_enroll_student on public.extracurricular_enrollments(student_id,status);

alter table public.extracurricular_classes enable row level security;
alter table public.extracurricular_sessions enable row level security;
alter table public.extracurricular_enrollments enable row level security;

drop policy if exists extracurricular_classes_read on public.extracurricular_classes;
create policy extracurricular_classes_read on public.extracurricular_classes for select to authenticated
using(active or public.is_manager() or teacher_id=auth.uid());
drop policy if exists extracurricular_classes_write on public.extracurricular_classes;
create policy extracurricular_classes_write on public.extracurricular_classes for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(public.is_manager() or teacher_id=auth.uid());

drop policy if exists extracurricular_sessions_read on public.extracurricular_sessions;
create policy extracurricular_sessions_read on public.extracurricular_sessions for select to authenticated
using(
  exists(
    select 1 from public.extracurricular_classes c
    where c.id=class_id and (
      c.active or public.is_manager() or c.teacher_id=auth.uid()
      or exists(select 1 from public.extracurricular_enrollments e where e.class_id=c.id and e.student_id=auth.uid() and e.status='approved')
    )
  )
);
drop policy if exists extracurricular_sessions_write on public.extracurricular_sessions;
create policy extracurricular_sessions_write on public.extracurricular_sessions for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
);

drop policy if exists extracurricular_enrollments_read on public.extracurricular_enrollments;
create policy extracurricular_enrollments_read on public.extracurricular_enrollments for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
);
drop policy if exists extracurricular_enrollments_manage on public.extracurricular_enrollments;
create policy extracurricular_enrollments_manage on public.extracurricular_enrollments for update to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
);

revoke insert,delete on public.extracurricular_enrollments from authenticated;
grant select,update on public.extracurricular_enrollments to authenticated;

create or replace function public.register_extracurricular(p_class uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  c public.extracurricular_classes;
  eid uuid;
  used integer;
begin
  if public.current_role()<>'student' then raise exception 'STUDENT_ONLY'; end if;
  select * into c from public.extracurricular_classes where id=p_class for update;
  if not found or not c.active then raise exception 'CLASS_NOT_AVAILABLE'; end if;
  if c.registration_start is not null and now()<c.registration_start then raise exception 'REGISTRATION_NOT_STARTED'; end if;
  if c.registration_end is not null and now()>c.registration_end then raise exception 'REGISTRATION_ENDED'; end if;

  if exists(select 1 from public.extracurricular_enrollments e where e.class_id=c.id and e.student_id=auth.uid() and e.status<>'cancelled') then
    raise exception 'ALREADY_REGISTERED';
  end if;

  select count(*) into used from public.extracurricular_enrollments e
  where e.class_id=c.id and e.status in ('pending','approved');
  if used>=c.capacity then raise exception 'CLASS_FULL'; end if;

  insert into public.extracurricular_enrollments(class_id,student_id,status)
  values(c.id,auth.uid(),'pending')
  on conflict(class_id,student_id)
  do update set status='pending',registered_at=now(),updated_at=now()
  returning id into eid;

  if c.teacher_id is not null then
    perform public.notify_user(
      c.teacher_id,'extracurricular_request','درخواست ثبت‌نام فوق‌برنامه',
      c.title,'extracurricular','extracurricular_class',c.id,
      'extra:req:'||eid::text
    );
  end if;
  return eid;
end
$$;
grant execute on function public.register_extracurricular(uuid) to authenticated;

create or replace function public.set_extracurricular_enrollment_status(p_enrollment uuid,p_status text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare e public.extracurricular_enrollments;
declare c public.extracurricular_classes;
declare approved integer;
begin
  if p_status not in ('approved','rejected','cancelled') then raise exception 'INVALID_STATUS'; end if;
  select * into e from public.extracurricular_enrollments where id=p_enrollment for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into c from public.extracurricular_classes where id=e.class_id for update;
  if not (public.is_manager() or c.teacher_id=auth.uid() or (e.student_id=auth.uid() and p_status='cancelled')) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p_status='approved' then
    select count(*) into approved from public.extracurricular_enrollments
    where class_id=c.id and status='approved' and id<>e.id;
    if approved>=c.capacity then raise exception 'CLASS_FULL'; end if;
  end if;
  update public.extracurricular_enrollments set status=p_status,updated_at=now() where id=e.id;
  perform public.notify_user(
    e.student_id,'extracurricular_status','وضعیت ثبت‌نام فوق‌برنامه تغییر کرد',
    c.title,'extracurricular','extracurricular_class',c.id,
    'extra:status:'||e.id::text||':'||p_status
  );
end
$$;
grant execute on function public.set_extracurricular_enrollment_status(uuid,text) to authenticated;

-- Appointment scheduling
create table if not exists public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  location text,
  capacity integer not null default 1 check(capacity>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_slot_time_check check(end_time>start_time)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.appointment_slots(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  subject text not null,
  description text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled','completed')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint appointment_one_request unique(slot_id,requester_id)
);

create index if not exists idx_appointment_slots_staff_date on public.appointment_slots(staff_id,date,start_time);
create index if not exists idx_appointments_requester on public.appointments(requester_id,created_at desc);

alter table public.appointment_slots enable row level security;
alter table public.appointments enable row level security;

create or replace function public.check_appointment_slot_overlap()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if exists(
    select 1 from public.appointment_slots s
    where s.staff_id=new.staff_id and s.date=new.date and s.id<>coalesce(new.id,gen_random_uuid())
      and s.active
      and new.start_time<s.end_time and new.end_time>s.start_time
  ) then raise exception 'APPOINTMENT_SLOT_CONFLICT'; end if;
  return new;
end
$$;
drop trigger if exists trg_appointment_slot_overlap on public.appointment_slots;
create trigger trg_appointment_slot_overlap
before insert or update on public.appointment_slots
for each row execute function public.check_appointment_slot_overlap();

drop policy if exists appointment_slots_read on public.appointment_slots;
create policy appointment_slots_read on public.appointment_slots for select to authenticated
using(active or staff_id=auth.uid() or public.is_manager());
drop policy if exists appointment_slots_write on public.appointment_slots;
create policy appointment_slots_write on public.appointment_slots for all to authenticated
using(public.is_manager() or staff_id=auth.uid())
with check(
  public.is_manager()
  or (
    staff_id=auth.uid()
    and public.current_role() in ('manager','teacher')
  )
);

drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
using(
  requester_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.appointment_slots s where s.id=slot_id and s.staff_id=auth.uid())
);
revoke insert,update,delete on public.appointments from authenticated;
grant select on public.appointments to authenticated;

create or replace function public.book_appointment(
  p_slot uuid,p_subject text,p_description text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.appointment_slots;
  used integer;
  aid uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into s from public.appointment_slots where id=p_slot for update;
  if not found or not s.active then raise exception 'APPOINTMENT_SLOT_UNAVAILABLE'; end if;
  if (s.date + s.end_time)<=now() then raise exception 'APPOINTMENT_SLOT_EXPIRED'; end if;

  select count(*) into used from public.appointments a
  where a.slot_id=s.id and a.status in ('pending','approved');
  if used>=s.capacity then raise exception 'APPOINTMENT_FULL'; end if;

  begin
    insert into public.appointments(slot_id,requester_id,subject,description,status)
    values(s.id,auth.uid(),trim(p_subject),nullif(trim(p_description),'') ,'pending')
    returning id into aid;
  exception when unique_violation then
    raise exception 'APPOINTMENT_ALREADY_REQUESTED';
  end;

  perform public.notify_user(
    s.staff_id,'appointment_request','درخواست ملاقات جدید',
    trim(p_subject),'appointments','appointment',aid,'appointment:req:'||aid::text
  );
  return aid;
end
$$;
grant execute on function public.book_appointment(uuid,text,text) to authenticated;

create or replace function public.set_appointment_status(p_appointment uuid,p_status text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare a public.appointments;
declare s public.appointment_slots;
begin
  if p_status not in ('approved','rejected','cancelled','completed') then raise exception 'INVALID_STATUS'; end if;
  select * into a from public.appointments where id=p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  select * into s from public.appointment_slots where id=a.slot_id;

  if p_status='cancelled' and a.requester_id=auth.uid() then
    null;
  elsif not (public.is_manager() or s.staff_id=auth.uid()) then
    raise exception 'ACCESS_DENIED';
  end if;

  update public.appointments
  set status=p_status,
      approved_at=case when p_status='approved' then now() else approved_at end,
      updated_at=now()
  where id=a.id;

  perform public.notify_user(
    a.requester_id,'appointment_status','وضعیت ملاقات تغییر کرد',
    a.subject,'appointments','appointment',a.id,
    'appointment:status:'||a.id::text||':'||p_status
  );
end
$$;
grant execute on function public.set_appointment_status(uuid,text) to authenticated;

create or replace function public.teacher_can_access_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or p_student=auth.uid()
    or exists(
      select 1 from public.class_students cs
      join public.teacher_assignments ta on ta.class_id=cs.class_id
      where cs.student_id=p_student and ta.teacher_id=auth.uid()
    )
$$;
grant execute on function public.teacher_can_access_student(uuid) to authenticated;

create or replace function public.student_profile_v8(p_student uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.profiles;
  cl jsonb;
begin
  if not public.teacher_can_access_student(p_student) then raise exception 'ACCESS_DENIED'; end if;
  select * into p from public.profiles where id=p_student and role='student';
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;

  select jsonb_build_object(
    'class_id',c.id,'class_title',c.title,'academic_year',c.academic_year,
    'grade_id',g.id,'grade_title',g.title
  ) into cl
  from public.class_students cs
  join public.classes c on c.id=cs.class_id
  join public.grade_levels g on g.id=c.grade_id
  where cs.student_id=p.id
  order by c.academic_year desc
  limit 1;

  return jsonb_build_object(
    'profile',jsonb_build_object(
      'id',p.id,'full_name',p.full_name,'national_id',p.national_id,
      'active',p.active,'created_at',p.created_at,
      'must_change_password',coalesce(p.must_change_password,false)
    ),
    'class',cl,
    'average',(
      select round(avg(s.lesson_score)::numeric,2) from public.scores s
      where s.student_id=p.id and s.lesson_score is not null
    ),
    'attendance',jsonb_build_object(
      'total_absent',(select count(*) from public.attendance_records a where a.student_id=p.id and a.status in ('absent','excused_absent','unexcused_absent')),
      'unexcused',(select count(*) from public.attendance_records a where a.student_id=p.id and a.status='unexcused_absent'),
      'late',(select count(*) from public.attendance_records a where a.student_id=p.id and a.status='late')
    ),
    'homework',jsonb_build_object(
      'count',(select count(*) from public.homework_grades h where h.student_id=p.id),
      'average',(select round(avg(h.score)::numeric,2) from public.homework_grades h where h.student_id=p.id)
    ),
    'exams',jsonb_build_object(
      'count',(select count(*) from public.exam_attempts a where a.student_id=p.id and a.status in ('submitted','graded')),
      'average',(select round(avg(a.total_score)::numeric,2) from public.exam_attempts a where a.student_id=p.id and a.status in ('submitted','graded'))
    ),
    'behavior',jsonb_build_object(
      'positive',(select coalesce(sum(greatest(b.points,0)),0) from public.behavior_events b where b.student_id=p.id),
      'negative',(select coalesce(sum(least(b.points,0)),0) from public.behavior_events b where b.student_id=p.id)
    ),
    'objections',(select count(*) from public.objections o where o.student_id=p.id),
    'scores',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.period,sub.title)
      from public.scores s
      join public.subjects sub on sub.id=s.subject_id
      where s.student_id=p.id
    ),'[]'::jsonb)
  );
end
$$;
grant execute on function public.student_profile_v8(uuid) to authenticated;

-- Unified calendar feed. SECURITY INVOKER keeps the underlying RLS in force.
create or replace function public.calendar_feed_v8(p_start timestamptz,p_end timestamptz)
returns table(
  source text,
  id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  event_type text,
  link text
)
language sql
stable
security invoker
set search_path=public
as $$
  select 'event',e.id,e.title,e.start_at,coalesce(e.end_at,e.start_at),e.event_type,'calendar'
  from public.calendar_events e
  where e.start_at<p_end and coalesce(e.end_at,e.start_at)>=p_start
  union all
  select 'homework',a.id,a.title,a.due_at,a.due_at,'homework','homework'
  from public.assignments a
  where a.due_at is not null and a.due_at>=p_start and a.due_at<p_end
  union all
  select 'exam',e.id,e.title,e.start_at,e.end_at,'exam','exams'
  from public.exams e
  where e.published and e.start_at<p_end and e.end_at>=p_start
  union all
  select 'extracurricular',s.id,c.title,s.starts_at,s.ends_at,'extracurricular','extracurricular'
  from public.extracurricular_sessions s
  join public.extracurricular_classes c on c.id=s.class_id
  where s.starts_at<p_end and s.ends_at>=p_start
  union all
  select 'appointment',a.id,a.subject,
         (s.date+s.start_time) at time zone current_setting('TIMEZONE'),
         (s.date+s.end_time) at time zone current_setting('TIMEZONE'),
         'appointment','appointments'
  from public.appointments a
  join public.appointment_slots s on s.id=a.slot_id
  where a.status='approved'
    and ((s.date+s.start_time) at time zone current_setting('TIMEZONE'))<p_end
    and ((s.date+s.end_time) at time zone current_setting('TIMEZONE'))>=p_start
  order by starts_at
$$;
grant execute on function public.calendar_feed_v8(timestamptz,timestamptz) to authenticated;

-- Reminders are materialized on demand when the user opens the app; this avoids a cron dependency.
create or replace function public.materialize_my_reminders()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare n integer:=0;
declare r record;
begin
  if auth.uid() is null then return 0; end if;

  if public.current_role()='student' then
    for r in
      select a.id,a.title,a.due_at
      from public.assignments a
      where public.student_can_access_assignment(a.id)
        and a.due_at between now() and now()+interval '24 hours'
    loop
      perform public.notify_user(auth.uid(),'homework_due','مهلت تکلیف نزدیک است',r.title,'homework','assignment',r.id,'due:homework:'||r.id::text);
      n:=n+1;
    end loop;

    for r in
      select e.id,e.title,e.start_at
      from public.exams e
      where e.published and public.student_in_class(e.class_id)
        and e.start_at between now() and now()+interval '24 hours'
    loop
      perform public.notify_user(auth.uid(),'exam_due','آزمون نزدیک است',r.title,'exams','exam',r.id,'due:exam:'||r.id::text);
      n:=n+1;
    end loop;
  end if;
  return n;
end
$$;
grant execute on function public.materialize_my_reminders() to authenticated;

-- Global search with explicit role-aware filtering.
create or replace function public.global_search(p_query text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare q text:=trim(coalesce(p_query,''));
declare role public.user_role:=public.current_role();
begin
  if length(q)<2 then return jsonb_build_object('people','[]'::jsonb,'classes','[]'::jsonb,'subjects','[]'::jsonb,'content','[]'::jsonb); end if;

  return jsonb_build_object(
    'people',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'title',p.full_name,'subtitle',p.national_id,'role',p.role) order by p.full_name)
      from public.profiles p
      where p.active
        and (p.full_name ilike '%'||q||'%' or p.national_id ilike '%'||q||'%')
        and (
          public.is_manager()
          or (role='teacher' and (
            p.role='teacher'
            or (p.role='student' and public.teacher_can_access_student(p.id))
          ))
          or (role='student' and (p.id=auth.uid() or p.role='teacher'))
        )
      limit 20
    ),'[]'::jsonb),
    'classes',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'subtitle',g.title,'type','class'))
      from public.classes c join public.grade_levels g on g.id=c.grade_id
      where (c.title ilike '%'||q||'%' or g.title ilike '%'||q||'%')
        and public.can_read_class(c.id)
      limit 15
    ),'[]'::jsonb),
    'subjects',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'type','subject'))
      from public.subjects s
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
      limit 15
    ),'[]'::jsonb),
    'content',coalesce((
      select jsonb_agg(z.x)
      from (
        select q2.x
        from (
          select jsonb_build_object('id',a.id,'title',a.title,'type','homework','route','homework') x
          from public.assignments a where a.title ilike '%'||q||'%'
          union all
          select jsonb_build_object('id',e.id,'title',e.title,'type','exam','route','exams')
          from public.exams e where e.title ilike '%'||q||'%'
          union all
          select jsonb_build_object('id',f.id,'title',f.title,'type','form','route','forms')
          from public.forms f where f.title ilike '%'||q||'%'
          union all
          select jsonb_build_object('id',ec.id,'title',ec.title,'type','extracurricular','route','extracurricular')
          from public.extracurricular_classes ec where ec.title ilike '%'||q||'%'
        ) q2
        limit 32
      ) z
    ),'[]'::jsonb)
  );
end
$$;
grant execute on function public.global_search(text) to authenticated;

-- Aggregated dashboard minimizes request count.
create or replace function public.dashboard_v8()
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare r public.user_role:=public.current_role();
begin
  if r='manager' then
    return jsonb_build_object(
      'students',(select count(*) from public.profiles where role='student' and active),
      'teachers',(select count(*) from public.profiles where role='teacher' and active),
      'classes',(select count(*) from public.classes),
      'absent_today',(select count(*) from public.attendance_records where attendance_date=current_date and status<>'present'),
      'upcoming_exams',(select count(*) from public.exams where published and start_at between now() and now()+interval '7 days'),
      'active_homework',(select count(*) from public.assignments where due_at>=now()),
      'pending_objections',(select count(*) from public.objections where status='pending'),
      'active_forms',(select count(*) from public.forms where active and (closes_at is null or closes_at>=now())),
      'active_polls',(select count(*) from public.polls where ends_at is null or ends_at>=now()),
      'extracurricular',(select count(*) from public.extracurricular_classes where active),
      'pending_appointments',(select count(*) from public.appointments where status='pending'),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    );
  elsif r='teacher' then
    return jsonb_build_object(
      'today_schedule',(select count(*) from public.timetable_entries where teacher_id=auth.uid() and weekday=case extract(dow from current_date)::int when 6 then 0 when 0 then 1 when 1 then 2 when 2 then 3 when 3 then 4 when 4 then 5 else -1 end),
      'pending_homework',(select count(*) from public.assignment_submissions s join public.assignments a on a.id=s.assignment_id where a.teacher_id=auth.uid() and s.status='submitted'),
      'upcoming_exams',(select count(*) from public.exams where teacher_id=auth.uid() and start_at between now() and now()+interval '7 days'),
      'pending_objections',(select count(*) from public.objections o join public.scores sc on sc.id=o.score_id where public.teacher_has_access(sc.class_id,sc.subject_id) and o.status='pending'),
      'pending_appointments',(select count(*) from public.appointments a join public.appointment_slots s on s.id=a.slot_id where s.staff_id=auth.uid() and a.status='pending'),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    );
  else
    return jsonb_build_object(
      'upcoming_homework',(select count(*) from public.assignments a where public.student_can_access_assignment(a.id) and a.due_at between now() and now()+interval '7 days'),
      'upcoming_exams',(select count(*) from public.exams where published and public.student_in_class(class_id) and start_at between now() and now()+interval '7 days'),
      'absences',(select count(*) from public.attendance_records where student_id=auth.uid() and status in ('absent','excused_absent','unexcused_absent')),
      'active_forms',(select count(*) from public.forms f where active and public.target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id) and (f.closes_at is null or f.closes_at>=now())),
      'active_polls',(select count(*) from public.polls p where public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) and (p.ends_at is null or p.ends_at>=now())),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    );
  end if;
end
$$;
grant execute on function public.dashboard_v8() to authenticated;

-- Report endpoint. SECURITY INVOKER keeps table policies active.
create or replace function public.report_data_v8(p_type text,p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare r public.user_role:=public.current_role();
declare class_filter uuid:=nullif(p_filters->>'class_id','')::uuid;
declare subject_filter uuid:=nullif(p_filters->>'subject_id','')::uuid;
declare student_filter uuid:=nullif(p_filters->>'student_id','')::uuid;
declare date_from date:=nullif(p_filters->>'date_from','')::date;
declare date_to date:=nullif(p_filters->>'date_to','')::date;
begin
  if r='student' then raise exception 'ACCESS_DENIED'; end if;

  if p_type='students' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'national_id',p.national_id,'active',p.active))
      from public.profiles p
      where p.role='student'
        and (r='manager' or public.teacher_can_access_student(p.id))
        and (student_filter is null or p.id=student_filter)
    ),'[]'::jsonb);
  elsif p_type='teachers' then
    if r<>'manager' then raise exception 'ACCESS_DENIED'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'national_id',p.national_id,'active',p.active)) from public.profiles p where p.role='teacher'),'[]'::jsonb);
  elsif p_type='classes' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'class',c.title,'year',c.academic_year,'grade',g.title)) from public.classes c join public.grade_levels g on g.id=c.grade_id where public.can_read_class(c.id) and (class_filter is null or c.id=class_filter)),'[]'::jsonb);
  elsif p_type='scores' then
    return coalesce((select jsonb_agg(to_jsonb(s)) from public.scores s where (class_filter is null or s.class_id=class_filter) and (subject_filter is null or s.subject_id=subject_filter) and (student_filter is null or s.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='attendance' then
    return coalesce((select jsonb_agg(to_jsonb(a)) from public.attendance_records a where (class_filter is null or a.class_id=class_filter) and (student_filter is null or a.student_id=student_filter) and (date_from is null or a.attendance_date>=date_from) and (date_to is null or a.attendance_date<=date_to)),'[]'::jsonb);
  elsif p_type='homework' then
    return coalesce((select jsonb_agg(to_jsonb(h)) from public.homework_grades h where (student_filter is null or h.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='exams' then
    return coalesce((select jsonb_agg(to_jsonb(a)) from public.exam_attempts a where (student_filter is null or a.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='discipline' then
    return coalesce((select jsonb_agg(to_jsonb(d)) from public.discipline_scores d where (student_filter is null or d.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='behavior' then
    return coalesce((select jsonb_agg(to_jsonb(b)) from public.behavior_events b where (student_filter is null or b.student_id=student_filter) and (date_from is null or b.event_date>=date_from) and (date_to is null or b.event_date<=date_to)),'[]'::jsonb);
  elsif p_type='objections' then
    return coalesce((select jsonb_agg(to_jsonb(o)) from public.objections o where (student_filter is null or o.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='extracurricular' then
    return coalesce((select jsonb_agg(to_jsonb(e)) from public.extracurricular_enrollments e where (student_filter is null or e.student_id=student_filter)),'[]'::jsonb);
  elsif p_type='forms' then
    return coalesce((select jsonb_agg(to_jsonb(s)) from public.form_submissions s where (student_filter is null or s.user_id=student_filter)),'[]'::jsonb);
  elsif p_type='polls' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'anonymous',p.anonymous,'starts_at',p.starts_at,'ends_at',p.ends_at)) from public.polls p where public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id)),'[]'::jsonb);
  end if;
  raise exception 'REPORT_TYPE_INVALID';
end
$$;
grant execute on function public.report_data_v8(text,jsonb) to authenticated;

select public.attach_audit_trigger(x)
from unnest(array['extracurricular_enrollments']) as x;
