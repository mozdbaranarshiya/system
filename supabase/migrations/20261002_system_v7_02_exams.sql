-- Exam delivery contains snapshots without keys. Keys and grades are server-only.
begin;
create table public.question_bank(
id uuid primary key default gen_random_uuid(),teacher_id uuid not null references public.profiles,
subject_id uuid not null references public.subjects,question_type text not null
check(question_type in ('multiple_choice','true_false','short_answer','essay')),
question_text text not null check(length(trim(question_text)) between 1 and 12000),
default_score numeric(8,2) not null default 1 check(default_score>0),
created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.question_options(
id uuid primary key default gen_random_uuid(),question_id uuid not null references public.question_bank,
option_text text not null,is_correct boolean not null default false,sort_order integer not null default 0,
unique(question_id,sort_order));
create unique index question_one_correct on public.question_options(question_id) where is_correct;
create table public.exams(
id uuid primary key default gen_random_uuid(),teacher_id uuid not null references public.profiles,
class_id uuid not null references public.classes,subject_id uuid not null references public.subjects,
title text not null check(length(trim(title))>0),description text,start_at timestamptz not null,end_at timestamptz not null,
duration_minutes integer not null check(duration_minutes between 1 and 480),
max_score numeric(8,2) not null default 20 check(max_score>0),published boolean not null default false,
show_result_after_submit boolean not null default true,created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),check(end_at>start_at));
create index exams_class_start on public.exams(class_id,start_at);
create table public.exam_questions(
exam_id uuid not null references public.exams,question_id uuid not null references public.question_bank,
score numeric(8,2) not null check(score>0),sort_order integer not null default 0,
question_type text not null,question_text text not null,options jsonb not null default '[]',
primary key(exam_id,question_id),unique(exam_id,sort_order));
create table public.exam_question_keys(
exam_id uuid not null,question_id uuid not null,correct_option_id uuid,
primary key(exam_id,question_id),foreign key(exam_id,question_id) references public.exam_questions);
create table public.exam_attempts(
id uuid primary key default gen_random_uuid(),exam_id uuid not null references public.exams,
student_id uuid not null references public.profiles,started_at timestamptz not null default now(),
deadline_at timestamptz not null,submitted_at timestamptz,status text not null default 'in_progress'
check(status in ('in_progress','submitted','graded')),auto_score numeric(8,2),manual_score numeric(8,2),total_score numeric(8,2),
unique(exam_id,student_id));
create index attempts_student on public.exam_attempts(student_id);
create table public.exam_answers(
attempt_id uuid not null references public.exam_attempts,question_id uuid not null references public.question_bank,
selected_option_id uuid,answer_text text check(length(answer_text)<=12000),awarded_score numeric(8,2),feedback text,
graded_by uuid references public.profiles,updated_at timestamptz not null default now(),
primary key(attempt_id,question_id));
create or replace function public.can_manage_exam(p_exam uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select public.is_manager() or exists(select 1 from public.exams e
where e.id=p_exam and e.teacher_id=auth.uid() and public.teacher_has_access(e.class_id,e.subject_id)) $$;

create or replace function system_private.freeze_exam() returns trigger
language plpgsql security definer set search_path=public
as $$ declare e uuid; begin
if tg_table_name='exams' then
e:=case when tg_op='DELETE' then old.id else new.id end;
if tg_op<>'DELETE' then
if not exists(select 1 from public.teacher_assignments where teacher_id=new.teacher_id and class_id=new.class_id and subject_id=new.subject_id)
then raise exception 'INVALID_ASSIGNMENT'; end if;
if new.published and (not exists(select 1 from public.exam_questions where exam_id=new.id)
or (select sum(score) from public.exam_questions where exam_id=new.id)<>new.max_score)
then raise exception 'EXAM_SCORE_MISMATCH'; end if;
end if;
else e:=case when tg_op='DELETE' then old.exam_id else new.exam_id end;
end if;
-- All writers, including the manager, share the same lock as start_exam().
if e is not null then perform pg_advisory_xact_lock(hashtext('exam:'||e::text)); end if;
if exists(select 1 from public.exam_attempts where exam_id=e) then
if tg_table_name='exams' and tg_op='UPDATE' and
(to_jsonb(new)-'show_result_after_submit'-'updated_at')=(to_jsonb(old)-'show_result_after_submit'-'updated_at') then return new; end if;
raise exception 'EXAM_LOCKED'; end if;
if tg_table_name='exam_questions' and exists(select 1 from public.exams where id=e and published) then raise exception 'EXAM_LOCKED'; end if;
if tg_op='DELETE' then return old; end if; return new; end $$;
create trigger exam_freeze before insert or update or delete on public.exams for each row execute function system_private.freeze_exam();
create trigger question_freeze before insert or update or delete on public.exam_questions for each row execute function system_private.freeze_exam();
create or replace function system_private.snapshot_question() returns trigger
language plpgsql security definer set search_path=public
as $$ declare q public.question_bank; e public.exams; n integer; begin
select * into q from public.question_bank where id=new.question_id;
select * into e from public.exams where id=new.exam_id;
if q.subject_id<>e.subject_id or (q.teacher_id<>e.teacher_id and not public.is_manager()) then raise exception 'ACCESS_DENIED'; end if;
if q.question_type in ('multiple_choice','true_false') then
select count(*) into n from public.question_options where question_id=q.id;
if n<>(case when q.question_type='true_false' then 2 else 4 end) or
not exists(select 1 from public.question_options where question_id=q.id and is_correct) then raise exception 'INVALID_OPTIONS'; end if;
end if;
new.question_type:=q.question_type; new.question_text:=q.question_text;
select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',option_text) order by sort_order),'[]') into new.options
from public.question_options where question_id=q.id;
return new; end $$;
create trigger question_snapshot before insert or update on public.exam_questions for each row execute function system_private.snapshot_question();
create or replace function system_private.snapshot_key() returns trigger
language plpgsql security definer set search_path=public
as $$ begin
insert into public.exam_question_keys(exam_id,question_id,correct_option_id)
values(new.exam_id,new.question_id,(select id from public.question_options where question_id=new.question_id and is_correct))
on conflict(exam_id,question_id) do update set correct_option_id=excluded.correct_option_id;
return new; end $$;
create trigger question_key after insert or update on public.exam_questions for each row execute function system_private.snapshot_key();
create or replace function system_private.remove_snapshot_key() returns trigger
language plpgsql security definer set search_path=public
as $$ begin delete from public.exam_question_keys where exam_id=old.exam_id and question_id=old.question_id; return old; end $$;
create trigger question_key_remove before delete on public.exam_questions for each row execute function system_private.remove_snapshot_key();

create or replace function public.save_bank_question(p_question jsonb,p_options jsonb default '[]') returns uuid
language plpgsql security definer set search_path=public
as $$ declare id_new uuid; sub uuid:=(p_question->>'subject_id')::uuid; qt text:=p_question->>'question_type'; begin
perform public.require_account_ready();
if not (public.is_manager() or (public.current_role()='teacher' and exists(select 1 from public.teacher_assignments where teacher_id=auth.uid() and subject_id=sub)))
then raise exception 'ACCESS_DENIED'; end if;
if qt in ('multiple_choice','true_false') and (jsonb_array_length(p_options)<>(case when qt='true_false' then 2 else 4 end)
or (select count(*) from jsonb_array_elements(p_options) x where (x->>'is_correct')::boolean)<>1)
then raise exception 'INVALID_OPTIONS'; end if;
insert into public.question_bank(teacher_id,subject_id,question_type,question_text,default_score)
values(auth.uid(),sub,qt,p_question->>'question_text',(p_question->>'default_score')::numeric) returning id into id_new;
insert into public.question_options(question_id,option_text,is_correct,sort_order)
select id_new,x->>'option_text',coalesce((x->>'is_correct')::boolean,false),ord::int
from jsonb_array_elements(p_options) with ordinality as z(x,ord);
return id_new; end $$;
create or replace function public.create_school_exam(p_exam jsonb,p_questions jsonb) returns uuid
language plpgsql security invoker set search_path=public
as $$ declare id_new uuid; begin
perform public.require_account_ready();
if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 200 then raise exception 'INVALID_DATA'; end if;
insert into public.exams(teacher_id,class_id,subject_id,title,description,start_at,end_at,duration_minutes,max_score,show_result_after_submit)
values(coalesce(nullif(p_exam->>'teacher_id','')::uuid,auth.uid()),(p_exam->>'class_id')::uuid,(p_exam->>'subject_id')::uuid,
p_exam->>'title',p_exam->>'description',(p_exam->>'start_at')::timestamptz,(p_exam->>'end_at')::timestamptz,
(p_exam->>'duration_minutes')::int,(select sum((x->>'score')::numeric) from jsonb_array_elements(p_questions) x),
coalesce((p_exam->>'show_result_after_submit')::boolean,true)) returning id into id_new;
insert into public.exam_questions(exam_id,question_id,score,sort_order,question_type,question_text)
select id_new,(x->>'question_id')::uuid,(x->>'score')::numeric,ord::int,'',''
from jsonb_array_elements(p_questions) with ordinality as z(x,ord);
if coalesce((p_exam->>'published')::boolean,false) then update public.exams set published=true where id=id_new; end if;
return id_new; end $$;

create or replace function public.start_exam(p_exam uuid) returns uuid
language plpgsql security definer set search_path=public
as $$ declare e public.exams; a public.exam_attempts; server_time timestamptz; begin
perform public.require_account_ready();
perform pg_advisory_xact_lock(hashtext('exam:'||p_exam::text));
select * into e from public.exams where id=p_exam;
if not found or public.current_role()<>'student' or not public.student_in_class(e.class_id) or not e.published then raise exception 'ACCESS_DENIED'; end if;
server_time:=clock_timestamp();
if server_time<e.start_at then raise exception 'EXAM_NOT_STARTED'; end if;
select * into a from public.exam_attempts where exam_id=p_exam and student_id=auth.uid();
if found then return a.id; end if;
if server_time>=e.end_at then raise exception 'EXAM_EXPIRED'; end if;
insert into public.exam_attempts(exam_id,student_id,started_at,deadline_at)
values(e.id,auth.uid(),server_time,least(e.end_at,server_time+make_interval(mins=>e.duration_minutes))) returning * into a;
return a.id; end $$;
create or replace function public.get_exam_attempt(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path=public
as $$ declare a public.exam_attempts; e public.exams; reveal boolean; begin
perform public.require_account_ready();
select * into a from public.exam_attempts where id=p_attempt;
if not found or not (a.student_id=auth.uid() or public.can_manage_exam(a.exam_id)) then raise exception 'ACCESS_DENIED'; end if;
select * into e from public.exams where id=a.exam_id;
reveal:=public.can_manage_exam(e.id) or (e.show_result_after_submit and a.status='graded' and now()>=e.end_at);
return jsonb_build_object('id',a.id,'exam_id',e.id,'title',e.title,'status',a.status,'deadline_at',a.deadline_at,
'server_now',now(),'total_score',case when reveal then a.total_score else null end,'max_score',e.max_score,
'auto_score',case when reveal then a.auto_score else null end,'manual_score',case when reveal then a.manual_score else null end,
'questions',(select coalesce(jsonb_agg(jsonb_build_object('id',q.question_id,'type',q.question_type,'text',q.question_text,
'options',q.options,'score',q.score) order by q.sort_order),'[]') from public.exam_questions q where q.exam_id=e.id),
'answers',(select coalesce(jsonb_agg(jsonb_build_object('question_id',v.question_id,'selected_option_id',v.selected_option_id,
'answer_text',v.answer_text,'awarded_score',case when reveal then v.awarded_score else null end,
'feedback',case when reveal then v.feedback else null end)),'[]') from public.exam_answers v where v.attempt_id=a.id),
'keys',case when reveal then (select coalesce(jsonb_agg(jsonb_build_object('question_id',k.question_id,'correct_option_id',k.correct_option_id)),'[]')
from public.exam_question_keys k where k.exam_id=e.id) else '[]'::jsonb end);
end $$;
create or replace function public.save_exam_answer(p_attempt uuid,p_question uuid,p_option uuid default null,p_text text default null) returns void
language plpgsql security definer set search_path=public
as $$ declare a public.exam_attempts; q public.exam_questions; begin
perform public.require_account_ready();
select * into a from public.exam_attempts where id=p_attempt for update;
if not found or a.student_id<>auth.uid() or public.current_role()<>'student' then raise exception 'ACCESS_DENIED'; end if;
if a.status<>'in_progress' or clock_timestamp()>=a.deadline_at then raise exception 'EXAM_EXPIRED'; end if;
select * into q from public.exam_questions where exam_id=a.exam_id and question_id=p_question;
if not found then raise exception 'INVALID_QUESTION'; end if;
if q.question_type in ('multiple_choice','true_false') then
if p_option is not null and not exists(select 1 from jsonb_array_elements(q.options) x where x->>'id'=p_option::text)
then raise exception 'INVALID_OPTIONS'; end if; p_text:=null;
else p_option:=null; end if;
insert into public.exam_answers(attempt_id,question_id,selected_option_id,answer_text)
values(a.id,p_question,p_option,p_text) on conflict(attempt_id,question_id) do update set
selected_option_id=excluded.selected_option_id,answer_text=excluded.answer_text,updated_at=now();
end $$;
create or replace function public.submit_exam(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path=public
as $$ declare a public.exam_attempts; manual_needed boolean; begin
perform public.require_account_ready();
select * into a from public.exam_attempts where id=p_attempt for update;
if not found or a.student_id<>auth.uid() then raise exception 'ACCESS_DENIED'; end if;
if a.status<>'in_progress' then return jsonb_build_object('status',a.status); end if;
-- Submission finalizes saved answers even after the deadline; new answers never do.
insert into public.exam_answers(attempt_id,question_id)
select a.id,question_id from public.exam_questions where exam_id=a.exam_id on conflict do nothing;
update public.exam_answers v set awarded_score=case when v.selected_option_id=k.correct_option_id then q.score else 0 end
from public.exam_questions q join public.exam_question_keys k using(exam_id,question_id)
where v.attempt_id=a.id and v.question_id=q.question_id and q.exam_id=a.exam_id and q.question_type in ('multiple_choice','true_false');
select exists(select 1 from public.exam_questions where exam_id=a.exam_id and question_type in ('essay','short_answer')) into manual_needed;
update public.exam_attempts set submitted_at=now(),status=case when manual_needed then 'submitted' else 'graded' end,
auto_score=(select coalesce(sum(awarded_score),0) from public.exam_answers where attempt_id=a.id),
manual_score=case when manual_needed then null else 0 end,
total_score=case when manual_needed then null else (select coalesce(sum(awarded_score),0) from public.exam_answers where attempt_id=a.id) end
where id=a.id returning * into a;
return jsonb_build_object('status',a.status); end $$;
create or replace function public.grade_exam_answer(p_attempt uuid,p_question uuid,p_score numeric,p_feedback text default null) returns void
language plpgsql security definer set search_path=public
as $$ declare a public.exam_attempts; q public.exam_questions; begin
perform public.require_account_ready();
select * into a from public.exam_attempts where id=p_attempt for update;
if not found or not public.can_manage_exam(a.exam_id) then raise exception 'ACCESS_DENIED'; end if;
select * into q from public.exam_questions where exam_id=a.exam_id and question_id=p_question;
if not found then raise exception 'INVALID_QUESTION'; end if;
if a.status='in_progress' or q.question_type not in ('essay','short_answer') or p_score is null or p_score<0 or p_score>q.score
then raise exception 'INVALID_SCORE'; end if;
update public.exam_answers set awarded_score=p_score,feedback=p_feedback,graded_by=auth.uid() where attempt_id=a.id and question_id=p_question;
update public.exam_attempts set manual_score=(select coalesce(sum(v.awarded_score),0) from public.exam_answers v
join public.exam_questions x on x.question_id=v.question_id and x.exam_id=a.exam_id where v.attempt_id=a.id and x.question_type in ('essay','short_answer')),
status=case when exists(select 1 from public.exam_answers where attempt_id=a.id and awarded_score is null) then 'submitted' else 'graded' end,
total_score=case when exists(select 1 from public.exam_answers where attempt_id=a.id and awarded_score is null) then null
else (select sum(awarded_score) from public.exam_answers where attempt_id=a.id) end where id=a.id;
end $$;
create or replace function public.my_exam_results() returns jsonb
language plpgsql stable security definer set search_path=public
as $$ begin perform public.require_account_ready();
return (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'exam_id',e.id,'title',e.title,'class_id',e.class_id,'subject_id',e.subject_id,
'student_id',a.student_id,'status',a.status,'submitted_at',a.submitted_at,
'total_score',case when a.status='graded' and e.show_result_after_submit and now()>=e.end_at then a.total_score else null end,
'max_score',e.max_score)),'[]') from public.exam_attempts a join public.exams e on e.id=a.exam_id where a.student_id=auth.uid()); end $$;

do $$ declare t text; begin
foreach t in array array['question_bank','question_options','exams','exam_questions','exam_question_keys','exam_attempts','exam_answers'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from anon,authenticated',t);
execute format('create policy account_gate on public.%I as restrictive for all to authenticated using(public.account_ready()) with check(public.account_ready())',t);
end loop; end $$;
grant select,insert,update,delete on public.question_bank,public.question_options,public.exams,public.exam_questions to authenticated;
grant select on public.exam_attempts,public.exam_answers to authenticated;
create policy bank_owner on public.question_bank for all to authenticated
using(public.is_manager() or (teacher_id=auth.uid() and public.current_role()='teacher'))
with check(public.is_manager() or (teacher_id=auth.uid() and public.current_role()='teacher' and exists(select 1 from public.teacher_assignments where teacher_id=auth.uid() and subject_id=question_bank.subject_id)));
create policy option_owner on public.question_options for all to authenticated
using(exists(select 1 from public.question_bank q where q.id=question_id)) with check(exists(select 1 from public.question_bank q where q.id=question_id));
create policy exam_read on public.exams for select to authenticated using(public.is_manager() or (teacher_id=auth.uid() and public.teacher_has_access(class_id,subject_id)) or (published and public.student_in_class(class_id)));
create policy exam_write on public.exams for all to authenticated
using(public.is_manager() or (teacher_id=auth.uid() and public.teacher_has_access(class_id,subject_id))) with check(public.is_manager() or (teacher_id=auth.uid() and public.teacher_has_access(class_id,subject_id)));
create policy exam_question_owner on public.exam_questions for all to authenticated using(public.can_manage_exam(exam_id)) with check(public.can_manage_exam(exam_id));
create policy attempt_teacher_read on public.exam_attempts for select to authenticated using(public.can_manage_exam(exam_id));
create policy answer_teacher_read on public.exam_answers for select to authenticated
using(exists(select 1 from public.exam_attempts a where a.id=attempt_id and public.can_manage_exam(a.exam_id)));
-- Students receive only the explicitly redacted RPC payloads, never table rows.
revoke execute on function public.can_manage_exam(uuid),public.save_bank_question(jsonb,jsonb),public.create_school_exam(jsonb,jsonb),
public.start_exam(uuid),public.get_exam_attempt(uuid),public.save_exam_answer(uuid,uuid,uuid,text),public.submit_exam(uuid),
public.grade_exam_answer(uuid,uuid,numeric,text),public.my_exam_results() from public,anon;
grant execute on function public.can_manage_exam(uuid),public.save_bank_question(jsonb,jsonb),public.create_school_exam(jsonb,jsonb),
public.start_exam(uuid),public.get_exam_attempt(uuid),public.save_exam_answer(uuid,uuid,uuid,text),public.submit_exam(uuid),
public.grade_exam_answer(uuid,uuid,numeric,text),public.my_exam_results() to authenticated;
commit;
