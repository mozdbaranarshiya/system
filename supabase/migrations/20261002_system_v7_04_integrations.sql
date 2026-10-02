begin;
create table public.notifications(
id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles,type text not null,title text not null,
body text,link text,entity_type text,entity_id uuid,read_at timestamptz,created_at timestamptz not null default now(),
dedup_key text not null,unique(user_id,dedup_key));
create index notifications_user_time on public.notifications(user_id,created_at desc);
create index notifications_unread on public.notifications(user_id) where read_at is null;
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select on public.notifications to authenticated;
create policy notification_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.account_ready());
create or replace function public.read_notifications(p_id uuid default null) returns void
language plpgsql security invoker set search_path=public
as $$ begin perform public.require_account_ready();
-- Executed through the private definer helper to limit writable columns.
perform system_private.mark_notifications(p_id); end $$;
create or replace function system_private.mark_notifications(p_id uuid) returns void
language sql security definer set search_path=public
as $$ update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null and (p_id is null or id=p_id) $$;
-- The public wrapper is a definer only to reach the non-exposed private schema.
alter function public.read_notifications(uuid) security definer;
create or replace function system_private.notify(p_user uuid,p_type text,p_title text,p_body text,p_route text,p_entity text,p_id uuid,p_key text)
returns void language sql security definer set search_path=public
as $$ insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedup_key)
select p_user,p_type,p_title,p_body,p_route,p_entity,p_id,p_key where exists(select 1 from public.profiles where id=p_user and active)
on conflict(user_id,dedup_key) do nothing $$;
create or replace function system_private.notify_change() returns trigger
language plpgsql security definer set search_path=public
as $$ declare r record; n jsonb:=to_jsonb(new); typ text; title text; route text; body text; k text; begin
typ:=tg_table_name; title:=coalesce(n->>'title','به‌روزرسانی سامانه'); route:='dashboard';
if typ in ('assignments','exams','announcements','forms','polls','calendar_events','extracurricular_classes') then
if tg_op='UPDATE' then
if typ='exams' and not ((n->>'published')::boolean and not (to_jsonb(old)->>'published')::boolean) then return new; end if;
if typ in ('forms','extracurricular_classes') and not ((n->>'active')::boolean and not (to_jsonb(old)->>'active')::boolean) then return new; end if;
if typ not in ('exams','forms','extracurricular_classes') then return new; end if;
end if;
if typ='exams' and not (n->>'published')::boolean then return new; end if;
if typ in ('forms','extracurricular_classes') and not (n->>'active')::boolean then return new; end if;
route:=case typ when 'assignments' then 'homework' when 'exams' then 'exams' when 'announcements' then 'announcements'
when 'forms' then 'forms' when 'polls' then 'polls' when 'calendar_events' then 'calendar' else 'extracurricular' end;
body:=case typ when 'assignments' then 'تکلیف جدید ثبت شد.' when 'exams' then 'آزمون جدید منتشر شد.' when 'forms' then 'فرم جدید در دسترس است.'
when 'polls' then 'نظرسنجی جدید ثبت شد.' when 'calendar_events' then 'رویداد آموزشی جدید ثبت شد.' when 'extracurricular_classes' then 'کلاس فوق‌برنامه جدید در دسترس است.' else 'اطلاعیه جدید دریافت کردید.' end;
insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedup_key)
select u.id,typ,title,body,route,typ,(n->>'id')::uuid,typ||':'||(n->>'id')
from public.profiles u where u.active and (
(typ in ('assignments','exams') and u.role='student' and exists(select 1 from public.class_students cs where cs.student_id=u.id and cs.class_id=(n->>'class_id')::uuid)
and (typ<>'assignments' or n->>'group_id' is null or exists(select 1 from public.student_group_members gm where gm.group_id=(n->>'group_id')::uuid and gm.student_id=u.id)))
or (typ='extracurricular_classes' and u.role='student')
or (typ in ('forms','polls','calendar_events','announcements') and (
system_private.matches_audience(n->>'target_type',n->>'target_role',(n->>'target_grade_id')::uuid,(n->>'target_class_id')::uuid,(n->>'target_user_id')::uuid,u.id)
or (typ='announcements' and n->>'target_type'='group' and exists(select 1 from public.student_group_members where group_id=(n->>'target_group_id')::uuid and student_id=u.id)))))
on conflict(user_id,dedup_key) do nothing;
elsif typ='attendance_records' then
if new.status<>'present' and (tg_op='INSERT' or new.status is distinct from old.status) then
perform system_private.notify(new.student_id,'attendance','وضعیت حضور و غیاب','وضعیت حضور شما ثبت یا اصلاح شد.','attendance',typ,new.id,typ||':'||new.id||':'||new.updated_at); end if;
elsif typ='scores' then
if tg_op='INSERT' or new.continuous_score is distinct from old.continuous_score or new.final_score is distinct from old.final_score then
perform system_private.notify(new.student_id,'score','تغییر نمره','نمره یکی از درس‌های شما ثبت یا اصلاح شد.','report',typ,new.id,typ||':'||new.id||':'||md5(n::text)); end if;
elsif typ='assignment_submissions' then
if new.status in ('graded','needs_revision') and (tg_op='INSERT' or new.status is distinct from old.status or new.score is distinct from old.score) then
perform system_private.notify(new.student_id,'homework_result',case when new.status='graded' then 'نتیجه تکلیف' else 'تکلیف نیاز به اصلاح دارد' end,
'بازخورد تکلیف را مشاهده کنید.','homework',typ,new.id,typ||':'||new.id||':'||new.reviewed_at); end if;
elsif typ='objections' then
if new.status<>'pending' and new.status is distinct from old.status then
perform system_private.notify(new.student_id,'objection_result','پاسخ اعتراض','پاسخ اعتراض شما ثبت شد.','objections',typ,new.id,typ||':'||new.id||':'||new.status); end if;
elsif typ='appointments' then
if tg_op='INSERT' or (new.status='pending' and old.status<>'pending') then
perform system_private.notify((select staff_id from public.appointment_slots where id=new.slot_id),'appointment_request','درخواست ملاقات',new.subject,'appointments',typ,new.id,typ||':'||new.id||':request:'||new.created_at);
end if;
if tg_op='UPDATE' and new.status is distinct from old.status then
perform system_private.notify(new.requester_id,'appointment_status','وضعیت ملاقات','وضعیت درخواست ملاقات شما تغییر کرد.','appointments',typ,new.id,typ||':'||new.id||':'||new.status||':'||now()); end if;
elsif typ='extracurricular_enrollments' then
perform system_private.notify(new.student_id,'enrollment','ثبت‌نام فوق‌برنامه','وضعیت ثبت‌نام شما ثبت یا تغییر کرد.','extracurricular',typ,new.id,typ||':'||new.id||':'||new.status||':'||now());
if tg_op='INSERT' then perform system_private.notify((select teacher_id from public.extracurricular_classes where id=new.class_id),'enrollment_request',
'درخواست ثبت‌نام فوق‌برنامه','ثبت‌نام جدید نیاز به بررسی دارد.','extracurricular',typ,new.id,typ||':'||new.id||':request'); end if;
end if; return new; end $$;
do $$ declare t text; begin
foreach t in array array['assignments','exams','announcements','forms','polls','calendar_events','extracurricular_classes','attendance_records','scores','assignment_submissions','appointments','extracurricular_enrollments'] loop
execute format('create trigger v7_notifications after insert or update on public.%I for each row execute function system_private.notify_change()',t);
end loop;
execute 'create trigger v7_notifications after update on public.objections for each row execute function system_private.notify_change()';
foreach t in array array['profiles','scores','attendance_records','teacher_assignments','class_students','timetable_entries','exams',
'discipline_scores','behavior_events','school_settings','forms','extracurricular_enrollments','appointments','polls','exam_answers','form_fields'] loop
execute format('create trigger v7_audit after insert or update or delete on public.%I for each row execute function system_private.audit_change()',t);
end loop; end $$;

create or replace function public.generate_school_reminders() returns void
language plpgsql security definer set search_path=public
as $$ declare expired uuid[]; begin
select array_agg(id) into expired from (select id from public.exam_attempts
where status='in_progress' and deadline_at<=clock_timestamp() order by deadline_at limit 500 for update skip locked) locked;
if expired is not null then
insert into public.exam_answers(attempt_id,question_id)
select a.id,q.question_id from public.exam_attempts a join public.exam_questions q on q.exam_id=a.exam_id where a.id=any(expired) on conflict do nothing;
update public.exam_answers v set awarded_score=case when v.selected_option_id=k.correct_option_id then q.score else 0 end
from public.exam_questions q join public.exam_question_keys k using(exam_id,question_id) join public.exam_attempts a on a.exam_id=q.exam_id
where v.attempt_id=a.id and v.question_id=q.question_id and a.id=any(expired) and q.question_type in ('multiple_choice','true_false');
update public.exam_attempts a set submitted_at=clock_timestamp(),auto_score=z.auto_score,
status=case when z.manual_needed then 'submitted' else 'graded' end,manual_score=case when z.manual_needed then null else 0 end,
total_score=case when z.manual_needed then null else z.auto_score end
from (select v.attempt_id,coalesce(sum(v.awarded_score),0) as auto_score,bool_or(q.question_type in ('short_answer','essay')) as manual_needed
from public.exam_answers v join public.exam_attempts a on a.id=v.attempt_id join public.exam_questions q on q.exam_id=a.exam_id and q.question_id=v.question_id
where a.id=any(expired) group by v.attempt_id) z where a.id=z.attempt_id;
end if;
insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedup_key)
select x.user_id,x.type,x.title,x.body,x.link,x.entity_type,x.entity_id,x.dedup_key from (
select cs.student_id as user_id,'homework_reminder' as type,'مهلت تکلیف نزدیک است' as title,a.title as body,'homework' as link,'assignments' as entity_type,a.id as entity_id,'homework_reminder:'||a.id as dedup_key
from public.assignments a join public.class_students cs on cs.class_id=a.class_id where a.due_at>now() and a.due_at<=now()+interval '24 hours'
and (a.group_id is null or exists(select 1 from public.student_group_members where group_id=a.group_id and student_id=cs.student_id))
and not exists(select 1 from public.assignment_submissions where assignment_id=a.id and student_id=cs.student_id and status in ('pending','graded'))
union all select cs.student_id,'exam_reminder','آزمون نزدیک است',e.title,'exams','exams',e.id,'exam_reminder:'||e.id
from public.exams e join public.class_students cs on cs.class_id=e.class_id where e.published and e.start_at>now() and e.start_at<=now()+interval '24 hours'
union all select a.student_id,'exam_result','نتیجه آزمون',e.title,'exams','exam_attempts',a.id,'exam_result:'||a.id
from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.status='graded' and e.show_result_after_submit and e.end_at<=now()
) x join public.profiles p on p.id=x.user_id and p.active
on conflict(user_id,dedup_key) do nothing;
end $$;
revoke execute on function public.generate_school_reminders() from public,anon,authenticated;
grant execute on function public.generate_school_reminders() to service_role;
-- Configure automatically if pg_cron is already enabled; setup instructions cover the other case.
do $$ begin if exists(select 1 from pg_extension where extname='pg_cron') then
execute $q$select cron.schedule('system-v7-reminders','*/15 * * * *','select public.generate_school_reminders()')$q$;
end if; end $$;

create or replace function public.get_school_calendar(p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security invoker set search_path=public
as $$ select coalesce(jsonb_agg(z order by z.start_at),'[]') from (
select id,title,start_at,end_at,event_type as type,'calendar'::text as route from public.calendar_events where start_at<p_to and end_at>=p_from
union all select id,title,due_at,due_at,'homework','homework' from public.assignments where due_at>=p_from and due_at<p_to
union all select id,title,start_at,end_at,'exam','exams' from public.exams where published and start_at<p_to and end_at>=p_from
union all select c.id,c.title,c.starts_at,c.ends_at,'extracurricular','extracurricular' from public.extracurricular_classes c
where c.starts_at<p_to and c.ends_at>=p_from and (public.can_manage_extracurricular(c.id) or exists(
select 1 from public.extracurricular_enrollments where class_id=c.id and student_id=auth.uid() and status='approved'))
union all select s.id,coalesce(s.title,c.title),s.start_at,s.end_at,'extracurricular','extracurricular' from public.extracurricular_sessions s
join public.extracurricular_classes c on c.id=s.class_id where s.start_at<p_to and s.end_at>=p_from
and (public.can_manage_extracurricular(c.id) or exists(select 1 from public.extracurricular_enrollments where class_id=c.id and student_id=auth.uid() and status='approved'))
union all select a.id,a.subject,(s.date+s.start_time) at time zone 'Asia/Tehran',(s.date+s.end_time) at time zone 'Asia/Tehran','appointment','appointments'
from public.appointments a join public.appointment_slots s on s.id=a.slot_id where a.status='approved'
and (s.date+s.start_time) at time zone 'Asia/Tehran'>=p_from and (s.date+s.start_time) at time zone 'Asia/Tehran'<p_to
) z $$;
create or replace function public.get_school_dashboard() returns jsonb
language sql stable security invoker set search_path=public
as $$ select jsonb_build_object('server_now',now(),'stats',jsonb_build_object(
'students',(select count(*) from public.profiles where role='student'),'teachers',(select count(*) from public.profiles where role='teacher'),
'classes',(select count(*) from public.classes where public.can_read_class(id)),
'absences_today',(select count(*) from public.attendance_records where attendance_date=(now() at time zone 'Asia/Tehran')::date and status in ('absent','unexcused','excused')),
'exams',(select count(*) from public.exams where published and end_at>now()),'homework',(select count(*) from public.assignments where due_at>now()),
'objections',(select count(*) from public.objections where status='pending'),'forms',(select count(*) from public.forms where active and closes_at>now()),
'polls',(select count(*) from public.polls where ends_at>now()),'extracurricular',(select count(*) from public.extracurricular_classes where active),
'appointments',(select count(*) from public.appointments where status='pending'),'notifications',(select count(*) from public.notifications where read_at is null),
'pending_homework',(select count(*) from public.assignment_submissions where status='pending')),
'today_schedule',(select coalesce(jsonb_agg(t order by p.period_order),'[]') from public.timetable_entries t join public.school_periods p on p.id=t.period_id
join public.classes c on c.id=t.class_id where t.weekday=((extract(dow from now() at time zone 'Asia/Tehran')::int+1)%7) and t.academic_year=c.academic_year),
'upcoming',public.get_school_calendar(now(),now()+interval '7 days')) $$;

create or replace function public.get_student_profile(p_student uuid) returns jsonb
language plpgsql stable security invoker set search_path=public
as $$ begin
if not public.can_read_student(p_student) then raise exception 'ACCESS_DENIED'; end if;
return jsonb_build_object(
'profile',(select to_jsonb(p)-'password_changed_at' from public.profiles p where id=p_student and role='student'),
'classes',(select coalesce(jsonb_agg(c order by c.academic_year desc,c.title),'[]') from public.class_students cs join public.classes c on c.id=cs.class_id where cs.student_id=p_student and public.can_read_class(c.id)),
'scores',(select coalesce(jsonb_agg(s order by s.period),'[]') from public.scores s where student_id=p_student),
'attendance',(select coalesce(jsonb_agg(z),'[]') from (select * from public.attendance_records where student_id=p_student order by attendance_date desc limit 200) z),
'attendance_summary',(select jsonb_build_object('total',count(*) filter(where status in ('absent','excused','unexcused')),
'unexcused',count(*) filter(where status='unexcused'),'late',count(*) filter(where status='late')) from public.attendance_records where student_id=p_student),
'class_summaries',(select coalesce(jsonb_agg(z),'[]') from (select cs.class_id,
(select count(*) from public.attendance_records a where a.student_id=p_student and a.class_id=cs.class_id and a.status in ('absent','excused','unexcused')) as total,
(select count(*) from public.attendance_records a where a.student_id=p_student and a.class_id=cs.class_id and a.status='unexcused') as unexcused,
(select count(*) from public.attendance_records a where a.student_id=p_student and a.class_id=cs.class_id and a.status='late') as late,
(select coalesce(sum(points),0) from public.behavior_events b where b.student_id=p_student and b.class_id=cs.class_id and b.points>0) as positive,
(select coalesce(sum(points),0) from public.behavior_events b where b.student_id=p_student and b.class_id=cs.class_id and b.points<0) as negative
from public.class_students cs where cs.student_id=p_student) z),
'homework',(select coalesce(jsonb_agg(z),'[]') from (select h.*,a.title,a.class_id,a.subject_id from public.homework_grades h join public.assignments a on a.id=h.assignment_id where h.student_id=p_student order by h.updated_at desc limit 200) z),
'exams',case when p_student=auth.uid() then public.my_exam_results() else (select coalesce(jsonb_agg(z),'[]') from (select a.*,e.title,e.class_id,e.subject_id from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.student_id=p_student order by a.started_at desc limit 200) z) end,
'discipline',(select coalesce(jsonb_agg(d),'[]') from public.discipline_scores d where student_id=p_student),
'behavior',(select coalesce(jsonb_agg(z),'[]') from (select * from public.behavior_events where student_id=p_student order by event_date desc limit 200) z),
'behavior_summary',(select jsonb_build_object('positive',coalesce(sum(points) filter(where points>0),0),'negative',coalesce(sum(points) filter(where points<0),0)) from public.behavior_events where student_id=p_student),
'objections',(select coalesce(jsonb_agg(z),'[]') from (select * from public.objections where student_id=p_student order by created_at desc limit 200) z),
'extracurricular',(select coalesce(jsonb_agg(z),'[]') from (select en.*,ec.title from public.extracurricular_enrollments en join public.extracurricular_classes ec on ec.id=en.class_id where en.student_id=p_student order by en.registered_at desc limit 200) z),
'forms',(select coalesce(jsonb_agg(z),'[]') from (select fs.*,f.title from public.form_submissions fs join public.forms f on f.id=fs.form_id where fs.user_id=p_student order by fs.submitted_at desc limit 200) z));
end $$;
-- Preserve classmate names used by v6 groups, while redacting their identities.
-- The underlying profiles table permits only self / manager / assigned staff.
create or replace function public.get_app_bootstrap() returns jsonb
language plpgsql stable security definer set search_path=public
as $$ begin perform public.require_account_ready();
return jsonb_build_object(
'profiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,'active',p.active,
'national_id',case when public.can_read_student(p.id) or p.id=auth.uid() or public.is_manager() then p.national_id else null end) order by p.full_name),'[]')
from public.profiles p where p.id=auth.uid() or public.is_manager() or (p.role='student' and public.can_read_student(p.id))
or (p.role='student' and public.current_role()='student' and public.students_share_class(p.id))
or p.role in ('teacher','manager')
or exists(select 1 from public.extracurricular_enrollments en join public.extracurricular_classes ec on ec.id=en.class_id where en.student_id=p.id and ec.teacher_id=auth.uid())
or exists(select 1 from public.appointments ap join public.appointment_slots sl on sl.id=ap.slot_id where ap.requester_id=p.id and sl.staff_id=auth.uid())),
'grades',(select coalesce(jsonb_agg(g order by g.sort_order),'[]') from public.grade_levels g where public.is_manager() or exists(select 1 from public.classes c where c.grade_id=g.id and public.can_read_class(c.id))),
'classes',(select coalesce(jsonb_agg(c order by c.title),'[]') from public.classes c where public.can_read_class(c.id)),
'subjects',(select coalesce(jsonb_agg(s order by s.title),'[]') from public.subjects s where public.is_manager() or exists(select 1 from public.classes c where c.grade_id=s.grade_id and public.can_read_class(c.id))),
'assignments',(select coalesce(jsonb_agg(t),'[]') from public.teacher_assignments t where public.is_manager() or t.teacher_id=auth.uid() or public.student_in_class(t.class_id)),
'classStudents',(select coalesce(jsonb_agg(cs),'[]') from public.class_students cs where public.is_manager() or cs.student_id=auth.uid() or public.can_manage_class(cs.class_id)),
'representatives',(select coalesce(jsonb_agg(cr),'[]') from public.class_representatives cr where public.can_read_class(cr.class_id)));
end $$;
revoke execute on function public.get_app_bootstrap() from public,anon;
create or replace function public.global_search(p_query text) returns jsonb
language sql stable security invoker set search_path=public
as $$ with q as (select lower(trim(translate(left(p_query,100),'يكة۰۱۲۳۴۵۶۷۸۹','یکه0123456789'))) as text), hits as (
select p.id,p.full_name as title,p.role::text as category,case when p.role='student' then 'student-profile' else 'teachers' end as route
from public.profiles p,q where (public.is_manager() or p.id=auth.uid() or (p.role='student' and public.can_read_student(p.id)) or p.role='teacher')
and (position(q.text in lower(translate(p.full_name,'يك','یک')))>0 or position(q.text in p.national_id)>0)
union all select c.id,c.title,'class','timetable' from public.classes c,q where public.can_read_class(c.id) and position(q.text in lower(c.title))>0
union all select g.id,g.title,'grade','timetable' from public.grade_levels g,q where position(q.text in lower(g.title))>0 and exists(select 1 from public.classes c where c.grade_id=g.id and public.can_read_class(c.id))
union all select s.id,s.title,'subject','timetable' from public.subjects s,q where position(q.text in lower(s.title))>0 and exists(select 1 from public.classes c where c.grade_id=s.grade_id and public.can_read_class(c.id))
union all select id,title,'homework','homework' from public.assignments,q where position(q.text in lower(title))>0
union all select id,title,'exam','exams' from public.exams,q where position(q.text in lower(title))>0
union all select id,title,'announcement','announcements' from public.announcements,q where position(q.text in lower(title))>0
union all select id,title,'form','forms' from public.forms,q where position(q.text in lower(title))>0
union all select id,title,'extracurricular','extracurricular' from public.extracurricular_classes,q where position(q.text in lower(title))>0)
select coalesce(jsonb_agg(z),'[]') from (select h.* from hits h,q where length(q.text)>=2 order by category,title limit 40) z $$;
create or replace function public.get_absence_alerts(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path=public
as $$ select coalesce(jsonb_agg(z order by z.total desc),'[]') from (
select a.student_id,p.full_name,count(*) filter(where a.status in ('absent','excused','unexcused')) as total,
count(*) filter(where a.status='excused') as excused,count(*) filter(where a.status='unexcused') as unexcused,
count(*) filter(where a.status='late') as late from public.attendance_records a join public.profiles p on p.id=a.student_id
where a.attendance_date between p_from and p_to group by a.student_id,p.full_name
having count(*) filter(where a.status in ('absent','excused','unexcused')) >= (select absence_alert_threshold from public.school_settings where id=true)
) z $$;

create or replace function public.school_report(p_kind text,p_filters jsonb default '{}',p_offset integer default 0,p_limit integer default 100) returns jsonb
language plpgsql stable security invoker set search_path=public
as $$ declare src text; answer jsonb; begin
perform public.require_account_ready();
src:=case p_kind
when 'students' then $q$select to_jsonb(p)||jsonb_build_object('student_id',p.id,'class_id',c.id,'grade_id',c.grade_id,'academic_year',c.academic_year) as row from public.profiles p left join public.class_students cs on cs.student_id=p.id left join public.classes c on c.id=cs.class_id where p.role='student' and public.can_read_student(p.id)$q$
when 'teachers' then $q$select to_jsonb(p)||jsonb_build_object('teacher_id',p.id,'class_id',ta.class_id,'subject_id',ta.subject_id,'grade_id',c.grade_id,'academic_year',c.academic_year) as row from public.profiles p left join public.teacher_assignments ta on ta.teacher_id=p.id left join public.classes c on c.id=ta.class_id where p.role='teacher'$q$
when 'classes' then $q$select to_jsonb(c)||jsonb_build_object('class_id',c.id) as row from public.classes c where public.can_read_class(id)$q$
when 'scores' then 'select to_jsonb(t) as row from public.scores t'
when 'averages' then $q$select jsonb_build_object('student_id',student_id,'class_id',class_id,'period',period,'average',round(avg(lesson_score),2),'completed',count(lesson_score)) as row from public.scores group by student_id,class_id,period$q$
when 'attendance' then 'select to_jsonb(t) as row from public.attendance_records t'
when 'homework' then $q$select to_jsonb(t)||jsonb_build_object('class_id',a.class_id,'subject_id',a.subject_id,'teacher_id',a.teacher_id,'title',a.title) as row from public.homework_grades t join public.assignments a on a.id=t.assignment_id$q$
when 'exams' then 'select to_jsonb(t) as row from public.exams t'
when 'exam_results' then $q$select to_jsonb(t)||jsonb_build_object('class_id',e.class_id,'subject_id',e.subject_id,'teacher_id',e.teacher_id,'title',e.title) as row from public.exam_attempts t join public.exams e on e.id=t.exam_id$q$
when 'discipline' then 'select to_jsonb(t) as row from public.discipline_scores t'
when 'behavior' then 'select to_jsonb(t) as row from public.behavior_events t'
when 'objections' then $q$select to_jsonb(t)||jsonb_build_object('class_id',s.class_id,'subject_id',s.subject_id) as row from public.objections t join public.scores s on s.id=t.score_id$q$
when 'extracurricular' then $q$select to_jsonb(t)||jsonb_build_object('title',c.title,'teacher_id',c.teacher_id,'extracurricular_class_id',c.id,'class_id',cs.class_id) as row from public.extracurricular_enrollments t join public.extracurricular_classes c on c.id=t.class_id left join public.class_students cs on cs.student_id=t.student_id$q$
when 'forms' then $q$select to_jsonb(t)||jsonb_build_object('title',f.title,'student_id',t.user_id,'class_id',cs.class_id) as row from public.form_submissions t join public.forms f on f.id=t.form_id left join public.class_students cs on cs.student_id=t.user_id$q$
when 'polls' then 'select to_jsonb(t) as row from public.polls t'
else null end;
if src is null then raise exception 'INVALID_REPORT'; end if;
execute 'with source as ('||src||'), dated as (select row,coalesce((coalesce(row->>''attendance_date'',row->>''event_date''))::date,
(coalesce(row->>''submitted_at'',row->>''registered_at'',row->>''start_at'',row->>''updated_at'',row->>''created_at'')::timestamptz at time zone ''Asia/Tehran'')::date) as report_date from source), filtered as (select row from dated where
($1->>''class_id'' is null or row->>''class_id''=$1->>''class_id'') and
($1->>''student_id'' is null or row->>''student_id''=$1->>''student_id'') and
($1->>''subject_id'' is null or row->>''subject_id''=$1->>''subject_id'') and
($1->>''teacher_id'' is null or coalesce(row->>''teacher_id'',row->>''recorded_by'')=$1->>''teacher_id'') and
($1->>''status'' is null or row->>''status''=$1->>''status'') and
($1->>''from'' is null or report_date>=($1->>''from'')::date) and
($1->>''to'' is null or report_date<=($1->>''to'')::date) and
($1->>''academic_year'' is null or row->>''academic_year''=$1->>''academic_year'' or exists(select 1 from public.classes c where c.id::text=row->>''class_id'' and c.academic_year=$1->>''academic_year'')) and
($1->>''grade_id'' is null or row->>''grade_id''=$1->>''grade_id'' or exists(select 1 from public.classes c where c.id::text=row->>''class_id'' and c.grade_id::text=$1->>''grade_id'')))
select jsonb_build_object(''total'',(select count(*) from filtered),''rows'',(select coalesce(jsonb_agg(row),''[]'') from
(select row from filtered order by coalesce(row->>''id'',row->>''student_id''),row::text limit $3 offset $2) page))'
into answer using p_filters,greatest(p_offset,0),least(greatest(p_limit,1),200);
return answer; end $$;
do $$ declare f record; begin
for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('read_notifications','get_school_calendar','get_school_dashboard','get_student_profile','global_search','school_report','get_absence_alerts') loop
execute format('revoke execute on function %s from public,anon',f.oid::regprocedure);
execute format('grant execute on function %s to authenticated',f.oid::regprocedure); end loop; end $$;
-- Private helpers can be called only through their reviewed wrappers/triggers.
revoke execute on all functions in schema system_private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
