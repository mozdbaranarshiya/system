begin;
create or replace function system_private.matches_audience(p_type text,p_role text,p_grade uuid,p_class uuid,p_user uuid,p_viewer uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles u where u.id=p_viewer and u.active and (
p_type='all' or (p_type='role' and u.role::text=p_role) or (p_type='user' and u.id=p_user)
or (p_type='class' and (exists(select 1 from public.class_students where student_id=u.id and class_id=p_class)
or exists(select 1 from public.teacher_assignments where teacher_id=u.id and class_id=p_class)))
or (p_type='grade' and (exists(select 1 from public.class_students cs join public.classes c on c.id=cs.class_id where cs.student_id=u.id and c.grade_id=p_grade)
or exists(select 1 from public.teacher_assignments ta join public.classes c on c.id=ta.class_id where ta.teacher_id=u.id and c.grade_id=p_grade))))) $$;
create or replace function public.audience_allows(p_type text,p_role text,p_grade uuid,p_class uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.account_ready() and system_private.matches_audience(p_type,p_role,p_grade,p_class,p_user,auth.uid()) $$;

create table public.calendar_events(
id uuid primary key default gen_random_uuid(),title text not null,description text,event_type text not null
check(event_type in ('exam','holiday','parents_meeting','trip','competition','cultural','school_meeting','deadline','other')),
start_at timestamptz not null,end_at timestamptz not null,all_day boolean not null default false,
target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
target_role public.user_role,target_grade_id uuid references public.grade_levels,target_class_id uuid references public.classes,
target_user_id uuid references public.profiles,created_by uuid not null references public.profiles default auth.uid(),
created_at timestamptz not null default now(),check(end_at>=start_at),
check(target_type='all' or (target_type='role' and target_role is not null) or (target_type='grade' and target_grade_id is not null)
or (target_type='class' and target_class_id is not null) or (target_type='user' and target_user_id is not null)));
create index calendar_start on public.calendar_events(start_at);
create table public.forms(
id uuid primary key default gen_random_uuid(),title text not null,description text,
target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
target_role public.user_role,target_grade_id uuid references public.grade_levels,target_class_id uuid references public.classes,
target_user_id uuid references public.profiles,opens_at timestamptz not null default now(),closes_at timestamptz not null,
active boolean not null default false,allow_multiple boolean not null default false,
created_by uuid not null references public.profiles default auth.uid(),created_at timestamptz not null default now(),check(closes_at>opens_at),
check(target_type='all' or (target_type='role' and target_role is not null) or (target_type='grade' and target_grade_id is not null)
or (target_type='class' and target_class_id is not null) or (target_type='user' and target_user_id is not null)));
create table public.form_fields(
id uuid primary key default gen_random_uuid(),form_id uuid not null references public.forms,
field_type text not null check(field_type in ('short_text','long_text','number','date','time','single_choice','multiple_choice','boolean')),
label text not null,placeholder text,required boolean not null default false,
options jsonb not null default '[]' check(jsonb_typeof(options)='array'),sort_order integer not null default 0,
unique(form_id,sort_order) deferrable);
create table public.form_submissions(
id uuid primary key default gen_random_uuid(),form_id uuid not null references public.forms,
user_id uuid not null references public.profiles,submission_number integer not null default 1,submitted_at timestamptz not null default now(),
unique(form_id,user_id,submission_number));
create table public.form_answers(
submission_id uuid not null references public.form_submissions,field_id uuid not null references public.form_fields,
value jsonb not null,primary key(submission_id,field_id));
create index forms_audience on public.forms(target_class_id,closes_at);
create index submissions_user on public.form_submissions(user_id,submitted_at);
create or replace function public.reorder_form_fields(p_form uuid,p_fields uuid[]) returns void
language plpgsql security invoker set search_path=public
as $$ begin
if not public.is_manager() then raise exception 'ACCESS_DENIED'; end if;
perform 1 from public.forms where id=p_form for update;
if cardinality(p_fields)<>(select count(*) from public.form_fields where form_id=p_form)
or (select count(distinct id) from unnest(p_fields) id)<>cardinality(p_fields)
or exists(select 1 from unnest(p_fields) x(id) where not exists(select 1 from public.form_fields f where f.id=x.id and f.form_id=p_form))
then raise exception 'INVALID_FIELD'; end if;
set constraints form_fields_form_id_sort_order_key deferred;
update public.form_fields f set sort_order=z.ord from unnest(p_fields) with ordinality z(id,ord) where f.id=z.id and f.form_id=p_form;
set constraints form_fields_form_id_sort_order_key immediate;
end $$;
create or replace function public.can_read_form(p_form uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or exists(select 1 from public.forms f where f.id=p_form and f.active and
public.audience_allows(f.target_type,f.target_role::text,f.target_grade_id,f.target_class_id,f.target_user_id)) $$;
create or replace function public.create_school_form(p_form jsonb,p_fields jsonb) returns uuid
language plpgsql security invoker set search_path=public
as $$ declare id_new uuid; begin
if not public.is_manager() then raise exception 'ACCESS_DENIED'; end if;
if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields) not between 1 and 100 then raise exception 'INVALID_DATA'; end if;
insert into public.forms(title,description,target_type,target_role,target_grade_id,target_class_id,target_user_id,opens_at,closes_at,active,allow_multiple)
values(p_form->>'title',p_form->>'description',p_form->>'target_type',nullif(p_form->>'target_role','')::public.user_role,
nullif(p_form->>'target_grade_id','')::uuid,nullif(p_form->>'target_class_id','')::uuid,nullif(p_form->>'target_user_id','')::uuid,
(p_form->>'opens_at')::timestamptz,(p_form->>'closes_at')::timestamptz,coalesce((p_form->>'active')::boolean,false),coalesce((p_form->>'allow_multiple')::boolean,false)) returning id into id_new;
insert into public.form_fields(form_id,field_type,label,placeholder,required,options,sort_order)
select id_new,x->>'field_type',x->>'label',x->>'placeholder',coalesce((x->>'required')::boolean,false),coalesce(x->'options','[]'),ord::int
from jsonb_array_elements(p_fields) with ordinality as z(x,ord);
return id_new; end $$;
create or replace function public.submit_school_form(p_form uuid,p_answers jsonb) returns uuid
language plpgsql security definer set search_path=public
as $$ declare f public.forms; field public.form_fields; v jsonb; sid uuid; sn integer; txt text; begin
perform public.require_account_ready();
select * into f from public.forms where id=p_form for update;
if not found or not public.can_read_form(f.id) then raise exception 'ACCESS_DENIED'; end if;
if not f.active or clock_timestamp()<f.opens_at or clock_timestamp()>=f.closes_at then raise exception 'FORM_CLOSED'; end if;
if jsonb_typeof(p_answers)<>'object' then raise exception 'INVALID_DATA'; end if;
select coalesce(max(submission_number),0)+1 into sn from public.form_submissions where form_id=f.id and user_id=auth.uid();
if not f.allow_multiple and sn>1 then raise exception 'FORM_ALREADY_SUBMITTED'; end if;
if exists(select 1 from jsonb_object_keys(p_answers) k where not exists(select 1 from public.form_fields where id::text=k and form_id=f.id))
then raise exception 'INVALID_FIELD'; end if;
-- Validation and all answers are committed together; partial submissions are impossible.
for field in select * from public.form_fields where form_id=f.id order by sort_order loop
v:=p_answers->field.id::text; txt:=v#>>'{}';
if v is null or v='null'::jsonb or v='[]'::jsonb or (jsonb_typeof(v)='string' and trim(txt)='') then
if field.required then raise exception 'FIELD_REQUIRED'; end if; continue; end if;
if (field.field_type in ('short_text','long_text','date','time','single_choice') and jsonb_typeof(v)<>'string')
or (field.field_type='number' and jsonb_typeof(v)<>'number') or (field.field_type='boolean' and jsonb_typeof(v)<>'boolean')
or (field.field_type='multiple_choice' and jsonb_typeof(v)<>'array') then raise exception 'INVALID_FIELD'; end if;
if field.field_type='short_text' and length(txt)>1000 or length(v::text)>16000 then raise exception 'INVALID_FIELD'; end if;
if field.field_type='date' then perform txt::date; end if;
if field.field_type='time' then perform txt::time; end if;
if field.field_type='single_choice' and not (field.options @> jsonb_build_array(txt)) then raise exception 'INVALID_OPTIONS'; end if;
if field.field_type='multiple_choice' and (not field.options @> v or
(select count(distinct x) from jsonb_array_elements(v) x)<>jsonb_array_length(v)) then raise exception 'INVALID_OPTIONS'; end if;
end loop;
insert into public.form_submissions(form_id,user_id,submission_number) values(f.id,auth.uid(),sn) returning id into sid;
insert into public.form_answers(submission_id,field_id,value)
select sid,ff.id,p_answers->ff.id::text from public.form_fields ff where ff.form_id=f.id
and p_answers ? ff.id::text and p_answers->ff.id::text<>'null'::jsonb;
return sid; end $$;

create table public.polls(
id uuid primary key default gen_random_uuid(),title text not null,description text,
target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
target_role public.user_role,target_class_id uuid references public.classes,target_grade_id uuid references public.grade_levels,
target_user_id uuid references public.profiles,starts_at timestamptz not null default now(),ends_at timestamptz not null,
anonymous boolean not null default true,show_results boolean not null default false,
created_by uuid not null references public.profiles default auth.uid(),created_at timestamptz not null default now(),check(ends_at>starts_at),
check(target_type='all' or (target_type='role' and target_role is not null) or (target_type='grade' and target_grade_id is not null)
or (target_type='class' and target_class_id is not null) or (target_type='user' and target_user_id is not null)));
create table public.poll_options(id uuid primary key default gen_random_uuid(),poll_id uuid not null references public.polls,
option_text text not null,sort_order integer not null default 0,unique(poll_id,id));
create table public.poll_votes(poll_id uuid not null references public.polls,user_id uuid not null references public.profiles,
option_id uuid not null,voted_at timestamptz not null default now(),primary key(poll_id,user_id),
foreign key(poll_id,option_id) references public.poll_options(poll_id,id));
create or replace function public.can_read_poll(p_poll uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or exists(select 1 from public.polls p where p.id=p_poll and
public.audience_allows(p.target_type,p.target_role::text,p.target_grade_id,p.target_class_id,p.target_user_id)) $$;
create or replace function public.create_school_poll(p_poll jsonb,p_options jsonb) returns uuid
language plpgsql security invoker set search_path=public
as $$ declare id_new uuid; begin
if not public.is_manager() then raise exception 'ACCESS_DENIED'; end if;
if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 20 then raise exception 'INVALID_OPTIONS'; end if;
insert into public.polls(title,description,target_type,target_role,target_grade_id,target_class_id,target_user_id,starts_at,ends_at,anonymous,show_results)
values(p_poll->>'title',p_poll->>'description',p_poll->>'target_type',nullif(p_poll->>'target_role','')::public.user_role,
nullif(p_poll->>'target_grade_id','')::uuid,nullif(p_poll->>'target_class_id','')::uuid,nullif(p_poll->>'target_user_id','')::uuid,
(p_poll->>'starts_at')::timestamptz,(p_poll->>'ends_at')::timestamptz,coalesce((p_poll->>'anonymous')::boolean,true),coalesce((p_poll->>'show_results')::boolean,false)) returning id into id_new;
insert into public.poll_options(poll_id,option_text,sort_order) select id_new,x#>>'{}',ord::int
from jsonb_array_elements(p_options) with ordinality as z(x,ord);
return id_new; end $$;
create or replace function public.vote_school_poll(p_poll uuid,p_option uuid) returns void
language plpgsql security definer set search_path=public
as $$ declare p public.polls; begin
perform public.require_account_ready(); select * into p from public.polls where id=p_poll for update;
if not found or not public.can_read_poll(p.id) then raise exception 'ACCESS_DENIED'; end if;
if clock_timestamp()<p.starts_at or clock_timestamp()>=p.ends_at then raise exception 'POLL_CLOSED'; end if;
if exists(select 1 from public.poll_votes where poll_id=p.id and user_id=auth.uid()) then raise exception 'ALREADY_VOTED'; end if;
insert into public.poll_votes(poll_id,user_id,option_id) values(p.id,auth.uid(),p_option); end $$;
create or replace function public.school_poll_results(p_poll uuid) returns jsonb
language plpgsql stable security definer set search_path=public
as $$ declare p public.polls; n integer; begin
perform public.require_account_ready(); select * into p from public.polls where id=p_poll;
if not found or not public.can_read_poll(p.id) then raise exception 'ACCESS_DENIED'; end if;
if not public.is_manager() and not p.show_results then raise exception 'RESULTS_HIDDEN'; end if;
select count(*) into n from public.poll_votes where poll_id=p.id;
return jsonb_build_object('participants',n,'anonymous',p.anonymous,'options',
(select coalesce(jsonb_agg(z order by z.sort_order),'[]') from (
select o.id,o.option_text,o.sort_order,count(v.user_id) as votes,
case when n=0 then 0 else round(100.0*count(v.user_id)/n,2) end as percent
from public.poll_options o left join public.poll_votes v on v.poll_id=o.poll_id and v.option_id=o.id
where o.poll_id=p.id group by o.id) z),
'voters',case when public.is_manager() and not p.anonymous then
(select coalesce(jsonb_agg(jsonb_build_object('name',u.full_name,'option_id',v.option_id)),'[]') from public.poll_votes v join public.profiles u on u.id=v.user_id where v.poll_id=p.id)
else '[]'::jsonb end); end $$;
create or replace function system_private.freeze_poll() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
if exists(select 1 from public.poll_votes where poll_id=old.id) and
(to_jsonb(new)-'show_results')<>(to_jsonb(old)-'show_results') then raise exception 'POLL_LOCKED'; end if; return new; end $$;
create trigger poll_freeze before update on public.polls for each row execute function system_private.freeze_poll();
create or replace function system_private.freeze_poll_option() returns trigger
language plpgsql security definer set search_path=public
as $$ declare p uuid; begin
p:=case when tg_op='DELETE' then old.poll_id else new.poll_id end;
perform 1 from public.polls where id=p for update;
if exists(select 1 from public.poll_votes where poll_id=p) then raise exception 'POLL_LOCKED'; end if;
if tg_op='UPDATE' and old.poll_id<>new.poll_id then
perform 1 from public.polls where id=old.poll_id for update;
if exists(select 1 from public.poll_votes where poll_id=old.poll_id) then raise exception 'POLL_LOCKED'; end if;
end if;
if tg_op='DELETE' then return old; end if; return new; end $$;
create trigger poll_option_freeze before insert or update or delete on public.poll_options
for each row execute function system_private.freeze_poll_option();

create table public.extracurricular_classes(
id uuid primary key default gen_random_uuid(),title text not null,description text,category text not null default 'other',
teacher_id uuid not null references public.profiles,capacity integer not null check(capacity between 1 and 10000),location text,
starts_at timestamptz not null,ends_at timestamptz not null,registration_start timestamptz not null,registration_end timestamptz not null,
active boolean not null default true,created_by uuid not null references public.profiles default auth.uid(),created_at timestamptz not null default now(),
check(ends_at>starts_at),check(registration_end>registration_start));
create table public.extracurricular_sessions(
id uuid primary key default gen_random_uuid(),class_id uuid not null references public.extracurricular_classes,
title text,start_at timestamptz not null,end_at timestamptz not null,location text,check(end_at>start_at),unique(class_id,start_at));
create table public.extracurricular_enrollments(
id uuid primary key default gen_random_uuid(),class_id uuid not null references public.extracurricular_classes,
student_id uuid not null references public.profiles,status text not null default 'pending'
check(status in ('pending','approved','rejected','cancelled')),registered_at timestamptz not null default now(),unique(class_id,student_id));
create or replace function public.can_manage_extracurricular(p_class uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or (public.current_role()='teacher' and exists(select 1 from public.extracurricular_classes where id=p_class and teacher_id=auth.uid())) $$;
create or replace function public.register_extracurricular(p_class uuid) returns uuid
language plpgsql security definer set search_path=public
as $$ declare c public.extracurricular_classes; e public.extracurricular_enrollments; begin
perform public.require_account_ready(); if public.current_role()<>'student' then raise exception 'ACCESS_DENIED'; end if;
select * into c from public.extracurricular_classes where id=p_class for update;
if not found or not c.active or now()<c.registration_start or now()>=c.registration_end then raise exception 'REGISTRATION_CLOSED'; end if;
select * into e from public.extracurricular_enrollments where class_id=c.id and student_id=auth.uid();
if found and e.status in ('pending','approved') then return e.id; end if;
if (select count(*) from public.extracurricular_enrollments where class_id=c.id and status in ('pending','approved'))>=c.capacity
then raise exception 'CAPACITY_FULL'; end if;
insert into public.extracurricular_enrollments(class_id,student_id) values(c.id,auth.uid())
on conflict(class_id,student_id) do update set status='pending',registered_at=now() returning id into e.id; return e.id; end $$;
create or replace function public.set_extracurricular_status(p_enrollment uuid,p_status text) returns void
language plpgsql security definer set search_path=public
as $$ declare e public.extracurricular_enrollments; c public.extracurricular_classes; begin
perform public.require_account_ready(); select * into e from public.extracurricular_enrollments where id=p_enrollment;
if not found or not (public.can_manage_extracurricular(e.class_id) or (e.student_id=auth.uid() and p_status='cancelled')) then raise exception 'ACCESS_DENIED'; end if;
if p_status not in ('approved','rejected','cancelled') then raise exception 'INVALID_STATUS'; end if;
select * into c from public.extracurricular_classes where id=e.class_id for update;
select * into e from public.extracurricular_enrollments where id=p_enrollment for update;
if p_status='approved' and e.status not in ('pending','approved') and
(select count(*) from public.extracurricular_enrollments where class_id=c.id and status in ('pending','approved'))>=c.capacity
then raise exception 'CAPACITY_FULL'; end if;
update public.extracurricular_enrollments set status=p_status where id=e.id; end $$;
create or replace function public.extracurricular_counts() returns jsonb
language plpgsql stable security definer set search_path=public
as $$ begin perform public.require_account_ready(); return (select coalesce(jsonb_object_agg(c.id::text,
(select count(*) from public.extracurricular_enrollments where class_id=c.id and status in ('pending','approved'))),'{}')
from public.extracurricular_classes c where c.active or public.can_manage_extracurricular(c.id)); end $$;
create or replace function system_private.check_extracurricular_capacity() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
if not exists(select 1 from public.profiles where id=new.teacher_id and role='teacher' and active) then raise exception 'INVALID_DATA'; end if;
if new.capacity<(select count(*) from public.extracurricular_enrollments where class_id=new.id and status in ('pending','approved'))
then raise exception 'CAPACITY_FULL'; end if; return new; end $$;
create trigger extracurricular_capacity before insert or update on public.extracurricular_classes for each row execute function system_private.check_extracurricular_capacity();

create table public.appointment_slots(
id uuid primary key default gen_random_uuid(),staff_id uuid not null references public.profiles,date date not null,
start_time time not null,end_time time not null,location text,capacity integer not null default 1 check(capacity between 1 and 100),
active boolean not null default true,check(end_time>start_time));
create table public.appointments(
id uuid primary key default gen_random_uuid(),slot_id uuid not null references public.appointment_slots,
requester_id uuid not null references public.profiles,subject text not null,description text,
status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled','completed')),
created_at timestamptz not null default now(),approved_at timestamptz,unique(slot_id,requester_id));
create or replace function public.can_manage_slot(p_slot uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or (public.current_role()='teacher' and exists(select 1 from public.appointment_slots where id=p_slot and staff_id=auth.uid())) $$;
create or replace function system_private.check_slot() returns trigger
language plpgsql security definer set search_path=public
as $$ begin perform pg_advisory_xact_lock(hashtext('system:v7:appointments'));
if not exists(select 1 from public.profiles where id=new.staff_id and role in ('manager','teacher') and active) then raise exception 'INVALID_DATA'; end if;
if new.active and exists(select 1 from public.appointment_slots where id<>new.id and staff_id=new.staff_id and date=new.date and active
and start_time<new.end_time and new.start_time<end_time) then raise exception 'APPOINTMENT_CONFLICT'; end if;
if tg_op='UPDATE' and exists(select 1 from public.appointments where slot_id=old.id and status in ('pending','approved','completed')) then
if (to_jsonb(new)-'capacity'-'active'-'location')<>(to_jsonb(old)-'capacity'-'active'-'location') then raise exception 'SLOT_LOCKED'; end if;
if new.capacity<(select count(*) from public.appointments where slot_id=new.id and status in ('pending','approved')) then raise exception 'CAPACITY_FULL'; end if;
end if; return new; end $$;
create trigger slot_check before insert or update on public.appointment_slots for each row execute function system_private.check_slot();
create or replace function public.book_appointment(p_slot uuid,p_subject text,p_description text default null) returns uuid
language plpgsql security definer set search_path=public
as $$ declare s public.appointment_slots; a public.appointments; begin
perform public.require_account_ready(); if public.current_role()<>'student' then raise exception 'ACCESS_DENIED'; end if;
perform pg_advisory_xact_lock(hashtext('system:v7:appointments'));
select * into s from public.appointment_slots where id=p_slot for update;
if not found or not s.active or (s.date+s.start_time) at time zone 'Asia/Tehran'<=now() then raise exception 'SLOT_CLOSED'; end if;
if trim(coalesce(p_subject,''))='' then raise exception 'FIELD_REQUIRED'; end if;
select * into a from public.appointments where slot_id=s.id and requester_id=auth.uid();
if found and a.status in ('pending','approved','completed') then raise exception 'APPOINTMENT_EXISTS'; end if;
if exists(select 1 from public.appointments ap join public.appointment_slots x on x.id=ap.slot_id
where ap.requester_id=auth.uid() and ap.status in ('pending','approved') and x.date=s.date
and x.start_time<s.end_time and s.start_time<x.end_time) then raise exception 'APPOINTMENT_CONFLICT'; end if;
if (select count(*) from public.appointments where slot_id=s.id and status in ('pending','approved'))>=s.capacity then raise exception 'CAPACITY_FULL'; end if;
insert into public.appointments(slot_id,requester_id,subject,description) values(s.id,auth.uid(),p_subject,p_description)
on conflict(slot_id,requester_id) do update set subject=excluded.subject,description=excluded.description,status='pending',created_at=now(),approved_at=null returning id into a.id;
return a.id; end $$;
create or replace function public.set_appointment_status(p_appointment uuid,p_status text) returns void
language plpgsql security definer set search_path=public
as $$ declare a public.appointments; s public.appointment_slots; begin
perform public.require_account_ready(); perform pg_advisory_xact_lock(hashtext('system:v7:appointments'));
select * into a from public.appointments where id=p_appointment for update;
if not found or not (public.can_manage_slot(a.slot_id) or (a.requester_id=auth.uid() and p_status='cancelled')) then raise exception 'ACCESS_DENIED'; end if;
if p_status not in ('approved','rejected','cancelled','completed') or a.status='completed' then raise exception 'INVALID_STATUS'; end if;
select * into s from public.appointment_slots where id=a.slot_id for update;
if p_status='approved' and a.status not in ('pending','approved') then raise exception 'INVALID_STATUS'; end if;
if p_status='completed' and (a.status<>'approved' or (s.date+s.start_time) at time zone 'Asia/Tehran'>now()) then raise exception 'INVALID_STATUS'; end if;
update public.appointments set status=p_status,approved_at=case when p_status='approved' then now() else approved_at end where id=a.id; end $$;

do $$ declare t text; begin
foreach t in array array['calendar_events','forms','form_fields','form_submissions','form_answers','polls','poll_options','poll_votes',
'extracurricular_classes','extracurricular_sessions','extracurricular_enrollments','appointment_slots','appointments'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from anon,authenticated',t);
execute format('create policy account_gate on public.%I as restrictive for all to authenticated using(public.account_ready()) with check(public.account_ready())',t);
end loop; end $$;
grant select,insert,update,delete on public.calendar_events,public.forms,public.form_fields,public.polls,public.poll_options,public.extracurricular_classes,public.extracurricular_sessions,public.appointment_slots to authenticated;
grant select on public.form_submissions,public.form_answers,public.extracurricular_enrollments,public.appointments to authenticated;
create policy calendar_read on public.calendar_events for select to authenticated
using(public.is_manager() or public.audience_allows(target_type,target_role::text,target_grade_id,target_class_id,target_user_id));
create policy calendar_write on public.calendar_events for all to authenticated using(public.is_manager()) with check(public.is_manager() and created_by=auth.uid());
create policy forms_read on public.forms for select to authenticated using(public.can_read_form(id));
create policy forms_write on public.forms for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy fields_read on public.form_fields for select to authenticated using(public.can_read_form(form_id));
create policy fields_write on public.form_fields for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy submission_read on public.form_submissions for select to authenticated using(public.is_manager() or user_id=auth.uid());
create policy form_answer_read on public.form_answers for select to authenticated
using(exists(select 1 from public.form_submissions s where s.id=submission_id));
create policy polls_read on public.polls for select to authenticated using(public.can_read_poll(id));
create policy polls_write on public.polls for all to authenticated using(public.is_manager()) with check(public.is_manager());
create policy poll_option_read on public.poll_options for select to authenticated using(public.can_read_poll(poll_id));
create policy poll_option_write on public.poll_options for all to authenticated using(public.is_manager()) with check(public.is_manager());
-- No SELECT/INSERT grant or policy on poll_votes: anonymity and one-vote integrity use RPCs.
create policy extra_read on public.extracurricular_classes for select to authenticated using(active or public.can_manage_extracurricular(id));
create policy extra_write on public.extracurricular_classes for all to authenticated using(public.can_manage_extracurricular(id)) with check(public.is_manager() or (teacher_id=auth.uid() and public.current_role()='teacher'));
create policy sessions_read on public.extracurricular_sessions for select to authenticated using(exists(select 1 from public.extracurricular_classes where id=class_id));
create policy sessions_write on public.extracurricular_sessions for all to authenticated using(public.can_manage_extracurricular(class_id)) with check(public.can_manage_extracurricular(class_id));
create policy enrollment_read on public.extracurricular_enrollments for select to authenticated using(student_id=auth.uid() or public.can_manage_extracurricular(class_id));
create policy slot_read on public.appointment_slots for select to authenticated using(active or public.can_manage_slot(id));
create policy slot_write on public.appointment_slots for all to authenticated using(public.can_manage_slot(id)) with check(public.is_manager() or (staff_id=auth.uid() and public.current_role()='teacher'));
create policy appointment_read on public.appointments for select to authenticated using(requester_id=auth.uid() or public.can_manage_slot(slot_id));
-- Explicit privileges for all newly introduced public functions.
do $$ declare f record; begin
for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('audience_allows','can_read_form','create_school_form','reorder_form_fields','submit_school_form','can_read_poll','create_school_poll','vote_school_poll','school_poll_results',
'can_manage_extracurricular','register_extracurricular','set_extracurricular_status','extracurricular_counts','can_manage_slot','book_appointment','set_appointment_status') loop
execute format('revoke execute on function %s from public,anon',f.oid::regprocedure);
execute format('grant execute on function %s to authenticated',f.oid::regprocedure);
end loop; end $$;
commit;
