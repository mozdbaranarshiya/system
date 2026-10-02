-- v7: additive migration; run after the v6.1 / manager MFA migrations.
begin;
create schema if not exists system_private;
revoke all on schema system_private from public, anon, authenticated;

alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists password_changed_at timestamptz;
-- Only accounts still using their national ID as a password are marked.
update public.profiles p set must_change_password=true
from auth.users u where u.id=p.id and u.encrypted_password<>''
and u.encrypted_password=crypt(p.national_id,u.encrypted_password);
alter table public.profiles alter column must_change_password set default true;
grant usage on schema public to service_role;
grant select,insert,update,delete on public.profiles to service_role;
alter table public.school_settings add column if not exists passing_score numeric(5,2) not null default 10 check(passing_score between 0 and 20);
alter table public.school_settings add column if not exists absence_alert_threshold integer not null default 5 check(absence_alert_threshold>0);
alter table public.school_settings add column if not exists school_name text not null default 'سامانه مدرسه';

create or replace function public.account_ready() returns boolean
language sql stable security definer set search_path=public
as $$ select coalesce((select active and not must_change_password
and (role<>'manager' or coalesce(auth.jwt()->>'aal','aal1')='aal2')
from public.profiles where id=auth.uid()),false) $$;
create or replace function public.require_account_ready() returns void
language plpgsql stable security definer set search_path=public
as $$ begin if not public.account_ready() then raise exception 'ACCOUNT_NOT_READY'; end if; end $$;
create or replace function public.current_role() returns public.user_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and public.account_ready() $$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path=public
as $$ select public.account_ready() and coalesce((select role='manager' from public.profiles where id=auth.uid()),false) $$;
create or replace function public.teacher_has_access(c uuid,s uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.account_ready() and public.current_role()='teacher' and exists(select 1 from public.teacher_assignments
where teacher_id=auth.uid() and class_id=c and subject_id=s) $$;
create or replace function public.student_in_class(c uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.account_ready() and public.current_role()='student' and exists(select 1 from public.class_students where student_id=auth.uid() and class_id=c) $$;
create or replace function public.is_class_representative(p_class uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.current_role()='student' and exists(select 1 from public.class_representatives where class_id=p_class and student_id=auth.uid()) $$;
create or replace function public.can_manage_group(p_group uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or exists(select 1 from public.student_groups g where g.id=p_group and g.teacher_id=auth.uid() and public.teacher_has_access(g.class_id,g.subject_id)) $$;
create or replace function public.can_view_group(p_group uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.can_manage_group(p_group) or (public.current_role()='student' and exists(
select 1 from public.student_groups g where g.id=p_group and (g.leader_id=auth.uid() or exists(select 1 from public.student_group_members where group_id=g.id and student_id=auth.uid())))) $$;
create or replace function public.can_manage_class(p_class uuid,p_subject uuid default null) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or (public.current_role()='teacher' and exists(
select 1 from public.teacher_assignments where teacher_id=auth.uid() and class_id=p_class
and (p_subject is null or subject_id=p_subject))) $$;
create or replace function public.can_read_class(p_class uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.can_manage_class(p_class) or public.student_in_class(p_class) $$;
create or replace function public.can_read_student(p_student uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.account_ready() and (p_student=auth.uid() or public.is_manager() or
(public.current_role()='teacher' and exists(select 1 from public.class_students cs
join public.teacher_assignments ta on ta.class_id=cs.class_id
where cs.student_id=p_student and ta.teacher_id=auth.uid()))) $$;

create or replace function system_private.protect_password_flag() returns trigger
language plpgsql set search_path=public
as $$ begin
if current_user in ('authenticated','anon') then
if tg_op='INSERT' then
if not new.must_change_password or new.password_changed_at is not null then raise exception 'ACCESS_DENIED'; end if;
elsif new.must_change_password is distinct from old.must_change_password or new.password_changed_at is distinct from old.password_changed_at
then raise exception 'ACCESS_DENIED'; end if;
end if; return new; end $$;
create trigger v7_password_flag before insert or update on public.profiles for each row execute function system_private.protect_password_flag();

-- Existing invoker queries remain subject to an additional, restrictive gate.
do $$ declare t text; begin
foreach t in array array['grade_levels','classes','subjects','class_students','teacher_assignments',
'class_representatives','scores','announcements','objections','school_settings','discipline_scores',
'student_groups','student_group_members','assignments','assignment_submissions','group_score_fields',
'group_score_entries','homework_grades','group_score_archives'] loop
execute format('create policy v7_account_gate on public.%I as restrictive for all to authenticated using(public.account_ready()) with check(public.account_ready())',t);
end loop; end $$;
create policy v7_profile_read_gate on public.profiles as restrictive for select to authenticated
using(id=auth.uid() or (public.account_ready() and (
public.is_manager() or (role='student' and public.can_read_student(id))
or (role='teacher' and exists(select 1 from public.teacher_assignments ta where ta.teacher_id=profiles.id and public.student_in_class(ta.class_id))))));
create policy v7_profile_insert_gate on public.profiles as restrictive for insert to authenticated with check(public.account_ready());
create policy v7_profile_update_gate on public.profiles as restrictive for update to authenticated using(public.account_ready()) with check(public.account_ready());
create policy v7_profile_delete_gate on public.profiles as restrictive for delete to authenticated using(public.account_ready());
create policy v7_report_visibility on public.scores as restrictive for select to authenticated
using(public.current_role()<>'student' or (select report_cards_open from public.school_settings where id=true));
create policy v7_storage_gate on storage.objects as restrictive for all to authenticated
using(bucket_id<>'assignment-files' or public.account_ready()) with check(bucket_id<>'assignment-files' or public.account_ready());
-- Definer RPCs bypass RLS, so guard their entry points too, without changing old migrations.
do $$ declare f record; d text; begin
for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('save_score','set_score_lock','submit_assignment',
'review_assignment_submission','sync_homework_gradebook','archive_group_scores','archive_group_scores_v2') loop
d:=pg_get_functiondef(f.oid);
d:=regexp_replace(d,'\m[Bb][Ee][Gg][Ii][Nn]\M','BEGIN PERFORM public.require_account_ready();');
if f.proname in ('archive_group_scores','archive_group_scores_v2') then
d:=replace(d,'BEGIN PERFORM public.require_account_ready();','BEGIN PERFORM public.require_account_ready(); IF NOT public.can_manage_group(p_group) THEN RAISE EXCEPTION ''ACCESS_DENIED''; END IF;');
end if;
if f.proname='sync_homework_gradebook' then
d:=replace(d,'BEGIN PERFORM public.require_account_ready();','BEGIN PERFORM public.require_account_ready(); IF NOT EXISTS(SELECT 1 FROM public.assignments homework_ref WHERE homework_ref.id=p_assignment AND (public.is_manager() OR (homework_ref.teacher_id=auth.uid() AND public.teacher_has_access(homework_ref.class_id,homework_ref.subject_id)) OR public.student_can_access_assignment(homework_ref.id))) THEN RAISE EXCEPTION ''ACCESS_DENIED''; END IF;');
end if;
if f.proname='review_assignment_submission' then
d:=replace(d,'public.is_manager() or a.teacher_id=auth.uid()', 'public.is_manager() or (a.teacher_id=auth.uid() and public.teacher_has_access(a.class_id,a.subject_id))');
end if;
execute d;
execute format('revoke execute on function %s from public, anon',f.oid::regprocedure);
end loop; end $$;

create table public.audit_logs(
id uuid primary key default gen_random_uuid(), user_id uuid, action text not null,
table_name text not null, record_id text, old_data jsonb, new_data jsonb,
created_at timestamptz not null default now());
create index audit_logs_time on public.audit_logs(created_at desc);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using(public.is_manager());
create or replace function system_private.audit_change() returns trigger
language plpgsql security definer set search_path=public
as $$ declare o jsonb; n jsonb; begin
if tg_op<>'INSERT' then o:=to_jsonb(old); end if;
if tg_op<>'DELETE' then n:=to_jsonb(new); end if;
insert into public.audit_logs(user_id,action,table_name,record_id,old_data,new_data)
values(coalesce(auth.uid(),nullif(current_setting('system.audit_actor',true),'')::uuid),tg_op,tg_table_name,coalesce(n->>'id',o->>'id',concat_ws(':',coalesce(n->>'class_id',o->>'class_id'),coalesce(n->>'student_id',o->>'student_id'))),o,n);
if tg_op='DELETE' then return old; end if; return new; end $$;
-- Only the Edge Function's service client can supply its verified caller ID.
-- The transaction-local value cannot spill into the next PostgREST request.
create or replace function public.apply_profile_patch(p_user uuid,p_patch jsonb,p_actor uuid,p_create boolean default false) returns void
language plpgsql security definer set search_path=public
as $$ begin
if not exists(select 1 from public.profiles where id=p_actor and active
and (p_actor=p_user or (role='manager' and not must_change_password))) then raise exception 'ACCESS_DENIED'; end if;
if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) k
where k not in ('national_id','full_name','role','active','must_change_password','password_changed_at')) then raise exception 'INVALID_DATA'; end if;
perform set_config('system.audit_actor',p_actor::text,true);
if p_create then
insert into public.profiles(id,national_id,full_name,role,active,must_change_password)
values(p_user,p_patch->>'national_id',p_patch->>'full_name',(p_patch->>'role')::public.user_role,
coalesce((p_patch->>'active')::boolean,true),true);
else
update public.profiles set
national_id=case when p_patch?'national_id' then p_patch->>'national_id' else national_id end,
full_name=case when p_patch?'full_name' then p_patch->>'full_name' else full_name end,
role=case when p_patch?'role' then (p_patch->>'role')::public.user_role else role end,
active=case when p_patch?'active' then (p_patch->>'active')::boolean else active end,
must_change_password=case when p_patch?'must_change_password' then (p_patch->>'must_change_password')::boolean else must_change_password end,
password_changed_at=case when p_patch?'password_changed_at' then (p_patch->>'password_changed_at')::timestamptz else password_changed_at end
where id=p_user;
if not found then raise exception 'INVALID_DATA'; end if;
end if; end $$;
revoke execute on function public.apply_profile_patch(uuid,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.apply_profile_patch(uuid,jsonb,uuid,boolean) to service_role;

create table public.school_periods(
id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title))>0),
period_order integer not null unique check(period_order>0),start_time time not null,end_time time not null,
active boolean not null default true,check(end_time>start_time));
create table public.timetable_entries(
id uuid primary key default gen_random_uuid(),class_id uuid not null references public.classes,
subject_id uuid not null references public.subjects,teacher_id uuid not null references public.profiles,
weekday smallint not null check(weekday between 0 and 6),period_id uuid not null references public.school_periods,
academic_year text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
unique(class_id,weekday,period_id,academic_year),unique(teacher_id,weekday,period_id,academic_year));
create index timetable_class_year on public.timetable_entries(class_id,academic_year,weekday);
create or replace function system_private.check_timetable() returns trigger
language plpgsql security definer set search_path=public
as $$ declare p public.school_periods; begin
perform pg_advisory_xact_lock(hashtext('system:v7:timetable'));
if tg_table_name='school_periods' then
if new.active and exists(select 1 from public.school_periods x where x.id<>new.id and x.active
and new.start_time<x.end_time and x.start_time<new.end_time) then raise exception 'TIMETABLE_CONFLICT'; end if;
return new; end if;
select * into p from public.school_periods where id=new.period_id and active;
if not found or not exists(select 1 from public.teacher_assignments ta join public.profiles u on u.id=ta.teacher_id
join public.classes c on c.id=ta.class_id join public.subjects s on s.id=ta.subject_id
where ta.teacher_id=new.teacher_id and ta.class_id=new.class_id and ta.subject_id=new.subject_id
and u.active and u.role='teacher' and c.grade_id=s.grade_id and c.academic_year=new.academic_year)
then raise exception 'INVALID_ASSIGNMENT'; end if;
if exists(select 1 from public.timetable_entries t join public.school_periods x on x.id=t.period_id
where t.id<>new.id and t.weekday=new.weekday and t.academic_year=new.academic_year
and (t.teacher_id=new.teacher_id or t.class_id=new.class_id)
and p.start_time<x.end_time and x.start_time<p.end_time) then raise exception 'TIMETABLE_CONFLICT'; end if;
new.updated_at:=now(); return new; end $$;
create trigger periods_check before insert or update on public.school_periods for each row execute function system_private.check_timetable();
create trigger timetable_check before insert or update on public.timetable_entries for each row execute function system_private.check_timetable();

create table public.attendance_records(
id uuid primary key default gen_random_uuid(),student_id uuid not null references public.profiles,
class_id uuid not null references public.classes,subject_id uuid not null references public.subjects,
schedule_entry_id uuid references public.timetable_entries,attendance_date date not null,
status text not null check(status in ('present','absent','excused','unexcused','late','early_departure')),
delay_minutes integer not null default 0 check(delay_minutes between 0 and 720),note text check(length(note)<=2000),
recorded_by uuid not null references public.profiles,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
session_key uuid generated always as (coalesce(schedule_entry_id,'00000000-0000-0000-0000-000000000000'::uuid)) stored,
unique(student_id,class_id,subject_id,attendance_date,session_key),check(status in ('late','early_departure') or delay_minutes=0));
create index attendance_class_date on public.attendance_records(class_id,attendance_date);
create index attendance_student_date on public.attendance_records(student_id,attendance_date);
create or replace function system_private.check_attendance() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
if not exists(select 1 from public.class_students where class_id=new.class_id and student_id=new.student_id)
then raise exception 'INVALID_STUDENT'; end if;
if new.schedule_entry_id is not null and not exists(select 1 from public.timetable_entries t
where t.id=new.schedule_entry_id and t.class_id=new.class_id and t.subject_id=new.subject_id
and t.weekday=((extract(dow from new.attendance_date)::int+1)%7)) then raise exception 'INVALID_SESSION'; end if;
new.recorded_by:=auth.uid(); new.updated_at:=now(); return new; end $$;
create trigger attendance_check before insert or update on public.attendance_records for each row execute function system_private.check_attendance();
create or replace function public.save_attendance(p_class uuid,p_subject uuid,p_date date,p_records jsonb,p_schedule uuid default null)
returns integer language plpgsql security invoker set search_path=public
as $$ declare n integer; begin
perform public.require_account_ready();
if not public.can_manage_class(p_class,p_subject) then raise exception 'ACCESS_DENIED'; end if;
if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records) not between 1 and 500 then raise exception 'INVALID_DATA'; end if;
if (select count(distinct x->>'student_id') from jsonb_array_elements(p_records) x)<>jsonb_array_length(p_records)
then raise exception 'INVALID_DATA'; end if;
insert into public.attendance_records(student_id,class_id,subject_id,schedule_entry_id,attendance_date,status,delay_minutes,note,recorded_by)
select (x->>'student_id')::uuid,p_class,p_subject,p_schedule,p_date,x->>'status',coalesce((x->>'delay_minutes')::int,0),x->>'note',auth.uid()
from jsonb_array_elements(p_records) x
on conflict(student_id,class_id,subject_id,attendance_date,session_key) do update set
status=excluded.status,delay_minutes=excluded.delay_minutes,note=excluded.note,recorded_by=auth.uid(),updated_at=now();
get diagnostics n=row_count; return n; end $$;

create table public.behavior_categories(
id uuid primary key default gen_random_uuid(),title text not null unique,event_type text not null
check(event_type in ('positive','negative','neutral')),default_points integer not null default 0,active boolean not null default true);
insert into public.behavior_categories(title,event_type,default_points) values
('تشویق علمی','positive',5),('همکاری در کلاس','positive',3),('پیشرفت تحصیلی','positive',4),
('فعالیت فرهنگی','positive',3),('مسئولیت‌پذیری','positive',3),('تأخیر','negative',-1),
('بی‌نظمی','negative',-2),('تذکر','negative',-1),('انجام ندادن تکلیف','negative',-2),('سایر','neutral',0);
create table public.behavior_events(
id uuid primary key default gen_random_uuid(),student_id uuid not null references public.profiles,
class_id uuid not null references public.classes,subject_id uuid references public.subjects,
event_date date not null,category uuid not null references public.behavior_categories,
event_type text not null check(event_type in ('positive','negative','neutral')),title text not null,
description text,points integer not null check(points between -100 and 100),recorded_by uuid not null references public.profiles,
created_at timestamptz not null default now(),
check((event_type='positive' and points>=0) or (event_type='negative' and points<=0) or (event_type='neutral' and points=0)));
create index behavior_student_date on public.behavior_events(student_id,event_date);
create or replace function system_private.check_behavior() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
if not exists(select 1 from public.class_students where student_id=new.student_id and class_id=new.class_id)
or not exists(select 1 from public.behavior_categories where id=new.category and active and event_type=new.event_type)
then raise exception 'INVALID_DATA'; end if;
new.recorded_by:=auth.uid(); return new; end $$;
create trigger behavior_check before insert or update on public.behavior_events for each row execute function system_private.check_behavior();

do $$ declare t text; begin
foreach t in array array['school_periods','timetable_entries','attendance_records','behavior_categories','behavior_events'] loop
execute format('alter table public.%I enable row level security',t);
execute format('grant select,insert,update,delete on public.%I to authenticated',t);
execute format('create policy account_gate on public.%I as restrictive for all to authenticated using(public.account_ready()) with check(public.account_ready())',t);
end loop; end $$;
create policy periods_read on public.school_periods for select to authenticated using(true);
create policy periods_write on public.school_periods for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy timetable_read on public.timetable_entries for select to authenticated using(public.can_read_class(class_id) or teacher_id=auth.uid());
create policy timetable_write on public.timetable_entries for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy attendance_read on public.attendance_records for select to authenticated using(student_id=auth.uid() or public.can_manage_class(class_id,subject_id));
create policy attendance_insert on public.attendance_records for insert to authenticated with check(public.can_manage_class(class_id,subject_id));
create policy attendance_update on public.attendance_records for update to authenticated using(public.can_manage_class(class_id,subject_id)) with check(public.can_manage_class(class_id,subject_id));
create policy category_read on public.behavior_categories for select to authenticated using(true);
create policy category_write on public.behavior_categories for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy behavior_read on public.behavior_events for select to authenticated using(student_id=auth.uid() or public.can_manage_class(class_id,subject_id));
create policy behavior_insert on public.behavior_events for insert to authenticated with check(public.can_manage_class(class_id,subject_id));
create policy behavior_update on public.behavior_events for update to authenticated using(public.can_manage_class(class_id,subject_id)) with check(public.can_manage_class(class_id,subject_id));
revoke execute on function public.account_ready(),public.require_account_ready(),public.can_manage_class(uuid,uuid),public.can_read_class(uuid),public.can_read_student(uuid),public.save_attendance(uuid,uuid,date,jsonb,uuid) from public,anon;
grant execute on function public.account_ready(),public.require_account_ready(),public.can_manage_class(uuid,uuid),public.can_read_class(uuid),public.can_read_student(uuid),public.save_attendance(uuid,uuid,date,jsonb,uuid) to authenticated;
commit;
