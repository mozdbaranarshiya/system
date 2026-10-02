-- v7 / مرحله ۱۶: داشبوردها، یکپارچه‌سازی تقویم/اعلان‌ها و سخت‌سازی نهایی
set role postgres;

-- همه جدول‌های v7 تا تغییر رمز اولیه بسته می‌مانند.
do $$
declare
  t text;
begin
  foreach t in array array[
    'school_periods','timetable_entries','attendance_records','calendar_events','notifications',
    'question_bank','question_options','exams','exam_questions','exam_attempts','exam_answers',
    'behavior_categories','behavior_events','forms','form_fields','form_submissions','form_answers',
    'polls','poll_options','poll_votes','extracurricular_classes','extracurricular_sessions',
    'extracurricular_enrollments','appointment_slots','appointments'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I','password_guard_v7_'||t,t);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using(public.password_change_complete()) with check(public.password_change_complete())',
        'password_guard_v7_'||t,t
      );
    end if;
  end loop;
end
$$;

-- جلسات فوق‌برنامه فقط برای مدیر، دبیر مسئول یا دانش‌آموز عضو.
drop policy if exists extra_sessions_read on public.extracurricular_sessions;
create policy extra_sessions_read on public.extracurricular_sessions
for select to authenticated
using(
  public.is_manager()
  or exists(
    select 1 from public.extracurricular_classes c
    where c.id=extracurricular_sessions.class_id and c.teacher_id=auth.uid()
  )
  or exists(
    select 1 from public.extracurricular_enrollments e
    where e.class_id=extracurricular_sessions.class_id
      and e.student_id=auth.uid()
      and e.status='approved'
  )
);

-- تقویم یکپارچه: رویداد دستی + تکلیف + آزمون + فوق‌برنامه + ملاقات تأییدشده.
create or replace function public.calendar_feed(
  p_from timestamptz,
  p_to timestamptz
) returns table(
  source text,
  entity_id uuid,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean,
  event_type text,
  class_id uuid,
  subject_id uuid
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    'event'::text,e.id,e.title,e.description,e.start_at,e.end_at,e.all_day,e.event_type,
    e.target_class_id,null::uuid
  from public.calendar_events e
  where e.start_at<=p_to and coalesce(e.end_at,e.start_at)>=p_from

  union all

  select
    'assignment',a.id,a.title,a.description,a.due_at,a.due_at,false,'homework',
    a.class_id,a.subject_id
  from public.assignments a
  where a.due_at between p_from and p_to

  union all

  select
    'exam',e.id,e.title,e.description,e.start_at,e.end_at,false,'exam',
    e.class_id,e.subject_id
  from public.exams e
  where e.published and e.start_at<=p_to and e.end_at>=p_from

  union all

  select
    'extracurricular',s.id,c.title,coalesce(s.note,c.description),s.starts_at,s.ends_at,false,'extracurricular',
    null::uuid,null::uuid
  from public.extracurricular_sessions s
  join public.extracurricular_classes c on c.id=s.class_id
  where s.starts_at<=p_to and s.ends_at>=p_from

  union all

  select
    'appointment',a.id,'ملاقات: '||a.subject,a.description,
    (s.date+s.start_time) at time zone current_setting('TIMEZONE'),
    (s.date+s.end_time) at time zone current_setting('TIMEZONE'),
    false,'appointment',null::uuid,null::uuid
  from public.appointments a
  join public.appointment_slots s on s.id=a.slot_id
  where a.status='approved'
    and (
      a.requester_id=auth.uid()
      or s.staff_id=auth.uid()
      or public.is_manager()
    )
    and (s.date+s.start_time) at time zone current_setting('TIMEZONE') <= p_to
    and (s.date+s.end_time) at time zone current_setting('TIMEZONE') >= p_from
$$;

grant execute on function public.calendar_feed(timestamptz,timestamptz) to authenticated;

-- اعلان اطلاعیه‌های جدید.
create or replace function public.notify_announcement_created()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
  select distinct p.id,'announcement','اطلاعیه جدید',new.title,'announcements','announcement',new.id,
         'announcement:new:'||new.id::text
  from public.profiles p
  where p.active and p.id<>new.created_by and (
    new.target_type='all'
    or (new.target_type='role' and p.role=new.target_role)
    or (new.target_type='user' and p.id=new.target_user_id)
    or (
      new.target_type='class'
      and exists(select 1 from public.class_students cs where cs.class_id=new.target_class_id and cs.student_id=p.id)
    )
    or (
      new.target_type='group'
      and exists(select 1 from public.student_group_members gm where gm.group_id=new.target_group_id and gm.student_id=p.id)
    )
  )
  on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  return new;
end
$$;

drop trigger if exists trg_notify_announcement_created on public.announcements;
create trigger trg_notify_announcement_created
after insert on public.announcements
for each row execute function public.notify_announcement_created();

-- اعلان نتیجه آزمون پس از تصحیح.
create or replace function public.notify_exam_attempt_result()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status='graded' and old.status is distinct from new.status then
    perform public.push_notification(
      new.student_id,'exam_result','نتیجه آزمون',
      'نمره آزمون شما ثبت شد: '||new.total_score::text,
      'exams','exam_attempt',new.id,
      'exam:result:'||new.id::text||':'||new.total_score::text
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_exam_attempt_result on public.exam_attempts;
create trigger trg_notify_exam_attempt_result
after update on public.exam_attempts
for each row execute function public.notify_exam_attempt_result();

-- یادآوری‌های نزدیک؛ فقط برای کاربر جاری و با dedupe.
create or replace function public.refresh_due_notifications()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  before_count bigint;
  after_count bigint;
begin
  select count(*) into before_count from public.notifications where user_id=auth.uid();

  if public.current_role()='student' then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select auth.uid(),'homework_due','مهلت تکلیف نزدیک است',a.title,'homework','assignment',a.id,
           'homework:due24:'||a.id::text
    from public.assignments a
    where a.due_at between now() and now()+interval '24 hours'
      and public.student_can_access_assignment(a.id)
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;

    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select auth.uid(),'exam_due','آزمون نزدیک است',e.title,'exams','exam',e.id,
           'exam:due24:'||e.id::text
    from public.exams e
    where e.published and e.start_at between now() and now()+interval '24 hours'
      and public.student_in_class(e.class_id)
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;

    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select auth.uid(),'form','مهلت فرم نزدیک است',f.title,'forms','form',f.id,
           'form:due24:'||f.id::text
    from public.forms f
    where f.active and f.closes_at between now() and now()+interval '24 hours'
      and public.can_access_form(f.id)
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;

  select count(*) into after_count from public.notifications where user_id=auth.uid();
  return greatest(0,(after_count-before_count)::integer);
end
$$;

grant execute on function public.refresh_due_notifications() to authenticated;

-- داشبورد تجمیعی نقش‌محور؛ بدون Queryهای متعدد در Frontend.
create or replace function public.dashboard_v7()
returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  r public.user_role:=public.current_role();
  weekday_no integer:=((extract(dow from current_date)::integer+1)%7);
  result jsonb;
begin
  if r='manager' then
    select jsonb_build_object(
      'role','manager',
      'students',(select count(*) from public.profiles where role='student' and active),
      'teachers',(select count(*) from public.profiles where role='teacher' and active),
      'classes',(select count(*) from public.classes),
      'absent_today',(select count(*) from public.attendance_records where attendance_date=current_date and status in ('absent','excused_absence','unexcused_absence')),
      'upcoming_exams',(select count(*) from public.exams where published and start_at between now() and now()+interval '7 days'),
      'active_homework',(select count(*) from public.assignments where due_at>=now()),
      'pending_objections',(select count(*) from public.objections where status='pending'),
      'active_forms',(select count(*) from public.forms where active and (closes_at is null or closes_at>=now())),
      'active_polls',(select count(*) from public.polls where active and (ends_at is null or ends_at>=now())),
      'active_extracurricular',(select count(*) from public.extracurricular_classes where active),
      'pending_appointments',(select count(*) from public.appointments where status='pending'),
      'near_events',(select count(*) from public.calendar_events where start_at between now() and now()+interval '7 days'),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    ) into result;

  elsif r='teacher' then
    select jsonb_build_object(
      'role','teacher',
      'today_schedule',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',t.id,'class_id',t.class_id,'subject_id',t.subject_id,'period_id',t.period_id,
          'period_title',sp.title,'start_time',sp.start_time,'end_time',sp.end_time
        ) order by sp.period_order)
        from public.timetable_entries t join public.school_periods sp on sp.id=t.period_id
        where t.teacher_id=auth.uid() and t.weekday=weekday_no and sp.active
      ),'[]'::jsonb),
      'pending_homework',(select count(*) from public.assignment_submissions s join public.assignments a on a.id=s.assignment_id where a.teacher_id=auth.uid() and s.status='pending'),
      'exams',(select count(*) from public.exams where teacher_id=auth.uid() and end_at>=now()),
      'pending_objections',(select count(*) from public.objections o join public.scores s on s.id=o.score_id where o.status='pending' and public.teacher_has_access(s.class_id,s.subject_id)),
      'pending_appointments',(select count(*) from public.appointments a join public.appointment_slots s on s.id=a.slot_id where s.staff_id=auth.uid() and a.status='pending'),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    ) into result;

  else
    select jsonb_build_object(
      'role','student',
      'today_schedule',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',t.id,'class_id',t.class_id,'subject_id',t.subject_id,'period_id',t.period_id,
          'period_title',sp.title,'start_time',sp.start_time,'end_time',sp.end_time
        ) order by sp.period_order)
        from public.timetable_entries t join public.school_periods sp on sp.id=t.period_id
        where public.student_in_class(t.class_id) and t.weekday=weekday_no and sp.active
      ),'[]'::jsonb),
      'due_homework',(select count(*) from public.assignments a where a.due_at between now() and now()+interval '7 days' and public.student_can_access_assignment(a.id)),
      'upcoming_exams',(select count(*) from public.exams e where e.published and e.start_at between now() and now()+interval '7 days' and public.student_in_class(e.class_id)),
      'latest_scores',coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('subject_id',s.subject_id,'period',s.period,'lesson_score',s.lesson_score,'updated_at',s.updated_at) x
          from public.scores s where s.student_id=auth.uid()
          order by s.updated_at desc limit 5
        ) z
      ),'[]'::jsonb),
      'absence_count',(select count(*) from public.attendance_records where student_id=auth.uid() and status in ('absent','excused_absence','unexcused_absence')),
      'active_forms',(select count(*) from public.forms f where f.active and public.can_access_form(f.id) and (f.closes_at is null or f.closes_at>=now())),
      'active_polls',(select count(*) from public.polls p where p.active and public.can_access_poll(p.id) and (p.ends_at is null or p.ends_at>=now())),
      'available_extracurricular',(select count(*) from public.extracurricular_classes where active and (registration_end is null or registration_end>=now())),
      'upcoming_appointments',(select count(*) from public.appointments a join public.appointment_slots s on s.id=a.slot_id where a.requester_id=auth.uid() and a.status='approved' and s.date>=current_date),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null)
    ) into result;
  end if;

  return result;
end
$$;

grant execute on function public.dashboard_v7() to authenticated;
