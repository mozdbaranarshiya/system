-- v8 / 03: Online exams, question bank, behavior, forms and polls
set role postgres;

create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  question_type text not null check(question_type in ('multiple_choice','true_false','short_answer','essay')),
  question_text text not null,
  default_score numeric(6,2) not null default 1 check(default_score>=0),
  correct_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.question_bank(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  sort_order integer not null default 0
);

create index if not exists idx_question_bank_teacher_subject on public.question_bank(teacher_id,subject_id);
create index if not exists idx_question_options_question on public.question_options(question_id,sort_order);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_minutes integer not null check(duration_minutes between 1 and 1440),
  max_score numeric(7,2) not null default 20 check(max_score>0),
  published boolean not null default false,
  show_result_after_submit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_time_check check(end_at>start_at)
);

create table if not exists public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  score numeric(6,2) not null check(score>=0),
  sort_order integer not null default 0,
  primary key(exam_id,question_id)
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status text not null default 'in_progress' check(status in ('in_progress','submitted','graded')),
  auto_score numeric(7,2) not null default 0,
  manual_score numeric(7,2) not null default 0,
  total_score numeric(7,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_attempt_once unique(exam_id,student_id)
);

create table if not exists public.exam_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  answer_data jsonb not null default '{}'::jsonb,
  auto_score numeric(6,2),
  manual_score numeric(6,2),
  feedback text,
  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_answer_once unique(attempt_id,question_id)
);

create index if not exists idx_exams_class_time on public.exams(class_id,start_at);
create index if not exists idx_exams_teacher on public.exams(teacher_id,created_at desc);
create index if not exists idx_exam_attempts_student on public.exam_attempts(student_id,created_at desc);
create index if not exists idx_exam_answers_attempt on public.exam_answers(attempt_id);

alter table public.question_bank enable row level security;
alter table public.question_options enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;

-- Students never receive direct SELECT privilege on question bank/options.
-- They receive sanitized question JSON only through get_exam_for_student().
revoke select on public.question_bank,public.question_options,public.exam_questions from authenticated;
grant select on public.question_bank,public.question_options,public.exam_questions to service_role;

drop policy if exists question_bank_owner on public.question_bank;
create policy question_bank_owner on public.question_bank for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(public.is_manager() or teacher_id=auth.uid());

drop policy if exists question_options_owner on public.question_options;
create policy question_options_owner on public.question_options for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.question_bank q where q.id=question_id and q.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.question_bank q where q.id=question_id and q.teacher_id=auth.uid())
);

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select to authenticated
using(
  public.is_manager()
  or teacher_id=auth.uid()
  or (published and public.student_in_class(class_id))
);
drop policy if exists exams_write on public.exams;
create policy exams_write on public.exams for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(
  public.is_manager()
  or (
    teacher_id=auth.uid()
    and public.teacher_has_access(class_id,subject_id)
  )
);

drop policy if exists exam_questions_owner on public.exam_questions;
create policy exam_questions_owner on public.exam_questions for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
);

drop policy if exists exam_attempts_read on public.exam_attempts;
create policy exam_attempts_read on public.exam_attempts for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
);

drop policy if exists exam_answers_read on public.exam_answers;
create policy exam_answers_read on public.exam_answers for select to authenticated
using(
  exists(
    select 1 from public.exam_attempts a
    join public.exams e on e.id=a.exam_id
    where a.id=attempt_id
      and (a.student_id=auth.uid() or e.teacher_id=auth.uid() or public.is_manager())
  )
);

-- Direct student writes are intentionally omitted; timing is enforced in RPCs.
revoke insert,update,delete on public.exam_attempts from authenticated;
revoke insert,update,delete on public.exam_answers from authenticated;
grant select on public.exam_attempts,public.exam_answers to authenticated;

create or replace function public.exam_deadline(p_attempt public.exam_attempts,p_exam public.exams)
returns timestamptz
language sql
immutable
as $$
  select least(
    p_exam.end_at,
    p_attempt.started_at + make_interval(mins=>p_exam.duration_minutes)
  )
$$;

create or replace function public.start_exam(p_exam uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.exams;
  a public.exam_attempts;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into e from public.exams where id=p_exam;
  if not found or not e.published then raise exception 'EXAM_NOT_AVAILABLE'; end if;
  if public.current_role()<>'student' then raise exception 'STUDENT_ONLY'; end if;
  if not public.student_in_class(e.class_id) then raise exception 'ACCESS_DENIED'; end if;
  if now()<e.start_at then raise exception 'EXAM_NOT_STARTED'; end if;
  if now()>=e.end_at then raise exception 'EXAM_ENDED'; end if;

  select * into a from public.exam_attempts
  where exam_id=e.id and student_id=auth.uid();

  if found then
    if a.status<>'in_progress' then raise exception 'EXAM_ALREADY_SUBMITTED'; end if;
    if now()>public.exam_deadline(a,e) then raise exception 'EXAM_TIME_FINISHED'; end if;
    return a.id;
  end if;

  insert into public.exam_attempts(exam_id,student_id,started_at,status)
  values(e.id,auth.uid(),now(),'in_progress')
  returning id into a.id;
  return a.id;
end
$$;
grant execute on function public.start_exam(uuid) to authenticated;

create or replace function public.get_exam_for_student(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.exams;
  a public.exam_attempts;
begin
  if public.current_role()<>'student' then raise exception 'STUDENT_ONLY'; end if;
  select * into e from public.exams where id=p_exam and published;
  if not found or not public.student_in_class(e.class_id) then raise exception 'ACCESS_DENIED'; end if;
  if now()<e.start_at then raise exception 'EXAM_NOT_STARTED'; end if;
  if now()>=e.end_at then raise exception 'EXAM_ENDED'; end if;

  select * into a from public.exam_attempts
  where exam_id=e.id and student_id=auth.uid() and status='in_progress';
  if not found then raise exception 'EXAM_NOT_STARTED_BY_STUDENT'; end if;
  if now()>public.exam_deadline(a,e) then raise exception 'EXAM_TIME_FINISHED'; end if;

  return jsonb_build_object(
    'exam',jsonb_build_object(
      'id',e.id,'title',e.title,'description',e.description,
      'start_at',e.start_at,'end_at',e.end_at,
      'duration_minutes',e.duration_minutes,'max_score',e.max_score,
      'attempt_id',a.id,'attempt_started_at',a.started_at,
      'deadline',public.exam_deadline(a,e)
    ),
    'questions',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',q.id,
          'type',q.question_type,
          'text',q.question_text,
          'score',eq.score,
          'sort_order',eq.sort_order,
          'options',case
            when q.question_type in ('multiple_choice','true_false') then
              coalesce((
                select jsonb_agg(
                  jsonb_build_object('id',o.id,'text',o.option_text,'sort_order',o.sort_order)
                  order by o.sort_order,o.id
                )
                from public.question_options o where o.question_id=q.id
              ),'[]'::jsonb)
            else '[]'::jsonb
          end,
          'answer',(
            select ans.answer_data
            from public.exam_answers ans
            where ans.attempt_id=a.id and ans.question_id=q.id
          )
        )
        order by eq.sort_order,q.id
      )
      from public.exam_questions eq
      join public.question_bank q on q.id=eq.question_id
      where eq.exam_id=e.id
    ),'[]'::jsonb)
  );
end
$$;
grant execute on function public.get_exam_for_student(uuid) to authenticated;

create or replace function public.save_exam_answer(
  p_attempt uuid,
  p_question uuid,
  p_answer jsonb
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.exam_attempts;
  e public.exams;
begin
  select * into a from public.exam_attempts
  where id=p_attempt and student_id=auth.uid() for update;
  if not found or a.status<>'in_progress' then raise exception 'EXAM_ATTEMPT_INVALID'; end if;
  select * into e from public.exams where id=a.exam_id;
  if now()<e.start_at or now()>public.exam_deadline(a,e) then raise exception 'EXAM_TIME_FINISHED'; end if;
  if not exists(
    select 1 from public.exam_questions eq
    where eq.exam_id=e.id and eq.question_id=p_question
  ) then raise exception 'QUESTION_NOT_IN_EXAM'; end if;

  insert into public.exam_answers(attempt_id,question_id,answer_data,answered_at,updated_at)
  values(a.id,p_question,coalesce(p_answer,'{}'::jsonb),now(),now())
  on conflict(attempt_id,question_id)
  do update set answer_data=excluded.answer_data,answered_at=now(),updated_at=now(),
    auto_score=null,manual_score=null,feedback=null;
end
$$;
grant execute on function public.save_exam_answer(uuid,uuid,jsonb) to authenticated;

create or replace function public.submit_exam(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.exam_attempts;
  e public.exams;
  v_auto numeric(7,2):=0;
  v_manual numeric(7,2):=0;
begin
  select * into a from public.exam_attempts
  where id=p_attempt and student_id=auth.uid() for update;
  if not found then raise exception 'EXAM_ATTEMPT_INVALID'; end if;
  if a.status<>'in_progress' then
    return jsonb_build_object('total_score',a.total_score,'status',a.status);
  end if;
  select * into e from public.exams where id=a.exam_id;

  update public.exam_answers ans
  set auto_score=case
    when q.question_type in ('multiple_choice','true_false') then
      case when exists(
        select 1
        from public.question_options o
        where o.question_id=q.id
          and (ans.answer_data->>'option_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    else null
  end,
  updated_at=now()
  from public.question_bank q
  join public.exam_questions eq on eq.question_id=q.id and eq.exam_id=e.id
  where ans.attempt_id=a.id and ans.question_id=q.id;

  select coalesce(sum(coalesce(ans.auto_score,0)),0),
         coalesce(sum(coalesce(ans.manual_score,0)),0)
  into v_auto,v_manual
  from public.exam_answers ans where ans.attempt_id=a.id;

  update public.exam_attempts
  set submitted_at=now(),
      status='submitted',
      auto_score=v_auto,
      manual_score=v_manual,
      total_score=v_auto+v_manual,
      updated_at=now()
  where id=a.id
  returning * into a;

  return jsonb_build_object(
    'attempt_id',a.id,
    'status',a.status,
    'auto_score',a.auto_score,
    'manual_score',a.manual_score,
    'total_score',case when e.show_result_after_submit then a.total_score else null end
  );
end
$$;
grant execute on function public.submit_exam(uuid) to authenticated;

create or replace function public.grade_exam_answer(
  p_answer uuid,
  p_score numeric,
  p_feedback text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ans public.exam_answers;
  a public.exam_attempts;
  e public.exams;
  eq public.exam_questions;
  v_manual numeric(7,2);
  v_auto numeric(7,2);
  pending_count integer;
begin
  select * into ans from public.exam_answers where id=p_answer for update;
  if not found then raise exception 'ANSWER_NOT_FOUND'; end if;
  select * into a from public.exam_attempts where id=ans.attempt_id;
  select * into e from public.exams where id=a.exam_id;
  if not (public.is_manager() or e.teacher_id=auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  select * into eq from public.exam_questions where exam_id=e.id and question_id=ans.question_id;
  if p_score<0 or p_score>eq.score then raise exception 'INVALID_SCORE'; end if;

  update public.exam_answers
  set manual_score=p_score,feedback=p_feedback,updated_at=now()
  where id=ans.id;

  select coalesce(sum(coalesce(auto_score,0)),0),
         coalesce(sum(coalesce(manual_score,0)),0)
  into v_auto,v_manual
  from public.exam_answers where attempt_id=a.id;

  select count(*) into pending_count
  from public.exam_questions x
  join public.question_bank q on q.id=x.question_id
  left join public.exam_answers ea on ea.attempt_id=a.id and ea.question_id=x.question_id
  where x.exam_id=e.id
    and q.question_type in ('short_answer','essay')
    and ea.manual_score is null;

  update public.exam_attempts
  set auto_score=v_auto,manual_score=v_manual,total_score=v_auto+v_manual,
      status=case when pending_count=0 then 'graded' else 'submitted' end,
      updated_at=now()
  where id=a.id;

  return jsonb_build_object('auto_score',v_auto,'manual_score',v_manual,'total_score',v_auto+v_manual);
end
$$;
grant execute on function public.grade_exam_answer(uuid,numeric,text) to authenticated;

create or replace function public.notify_exam_published()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare sid uuid;
begin
  if new.published and (tg_op='INSERT' or old.published is distinct from true) then
    for sid in select cs.student_id from public.class_students cs where cs.class_id=new.class_id
    loop
      perform public.notify_user(
        sid,'exam_new','آزمون جدید',new.title,'exams',
        'exam',new.id,'exam:new:'||new.id::text
      );
    end loop;
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_exam_published on public.exams;
create trigger trg_notify_exam_published
after insert or update on public.exams
for each row execute function public.notify_exam_published();

-- Advanced behavior and encouragement
create table if not exists public.behavior_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  default_points integer not null default 0,
  event_type text not null default 'neutral' check(event_type in ('positive','negative','neutral')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  event_date date not null default current_date,
  category_id uuid references public.behavior_categories(id) on delete set null,
  category text not null,
  event_type text not null check(event_type in ('positive','negative','neutral')),
  title text not null,
  description text,
  points integer not null default 0,
  recorded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_behavior_student_date on public.behavior_events(student_id,event_date desc);

alter table public.behavior_categories enable row level security;
alter table public.behavior_events enable row level security;

drop policy if exists behavior_categories_read on public.behavior_categories;
create policy behavior_categories_read on public.behavior_categories for select to authenticated using(active or public.is_manager());
drop policy if exists behavior_categories_manager on public.behavior_categories;
create policy behavior_categories_manager on public.behavior_categories for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists behavior_events_read on public.behavior_events;
create policy behavior_events_read on public.behavior_events for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id)
);
drop policy if exists behavior_events_write on public.behavior_events;
create policy behavior_events_write on public.behavior_events for insert to authenticated
with check(
  public.is_manager()
  or (
    recorded_by=auth.uid()
    and exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id)
  )
);
drop policy if exists behavior_events_update on public.behavior_events;
create policy behavior_events_update on public.behavior_events for update to authenticated
using(public.is_manager() or recorded_by=auth.uid())
with check(public.is_manager() or recorded_by=auth.uid());
drop policy if exists behavior_events_delete on public.behavior_events;
create policy behavior_events_delete on public.behavior_events for delete to authenticated
using(public.is_manager());

insert into public.behavior_categories(title,default_points,event_type)
values
('تشویق علمی',5,'positive'),
('همکاری در کلاس',3,'positive'),
('پیشرفت تحصیلی',4,'positive'),
('فعالیت فرهنگی',3,'positive'),
('مسئولیت‌پذیری',3,'positive'),
('تأخیر',-1,'negative'),
('بی‌نظمی',-2,'negative'),
('تذکر',-1,'negative'),
('انجام ندادن تکلیف',-2,'negative'),
('سایر',0,'neutral')
on conflict(title) do nothing;

-- Internal form builder
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  active boolean not null default true,
  single_response boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forms_time_check check(closes_at is null or opens_at is null or closes_at>=opens_at)
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  field_type text not null check(field_type in ('short_text','long_text','number','date','time','single_choice','multi_choice','yes_no')),
  label text not null,
  placeholder text,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  submitted_at timestamptz not null default now()
);

create table if not exists public.form_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  field_id uuid not null references public.form_fields(id) on delete cascade,
  answer jsonb not null default 'null'::jsonb,
  constraint form_answer_once unique(submission_id,field_id)
);

create index if not exists idx_forms_active_time on public.forms(active,opens_at,closes_at);
create index if not exists idx_form_submissions_form on public.form_submissions(form_id,submitted_at desc);

alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_answers enable row level security;

create or replace function public.target_visible(
  p_type text,p_role public.user_role,p_grade uuid,p_class uuid,p_user uuid
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or p_type='all'
    or (p_type='role' and p_role=public.current_role())
    or (p_type='user' and p_user=auth.uid())
    or (p_type='class' and public.can_read_class(p_class))
    or (
      p_type='grade' and exists(
        select 1 from public.classes c
        where c.grade_id=p_grade and public.can_read_class(c.id)
      )
    )
$$;
grant execute on function public.target_visible(text,public.user_role,uuid,uuid,uuid) to authenticated;

drop policy if exists forms_read on public.forms;
create policy forms_read on public.forms for select to authenticated
using(public.target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id));
drop policy if exists forms_manager on public.forms;
create policy forms_manager on public.forms for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists form_fields_read on public.form_fields;
create policy form_fields_read on public.form_fields for select to authenticated
using(exists(select 1 from public.forms f where f.id=form_id and public.target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id)));
drop policy if exists form_fields_manager on public.form_fields;
create policy form_fields_manager on public.form_fields for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists form_submissions_read on public.form_submissions;
create policy form_submissions_read on public.form_submissions for select to authenticated
using(user_id=auth.uid() or public.is_manager());

drop policy if exists form_answers_read on public.form_answers;
create policy form_answers_read on public.form_answers for select to authenticated
using(
  exists(select 1 from public.form_submissions s where s.id=submission_id and (s.user_id=auth.uid() or public.is_manager()))
);

revoke insert,update,delete on public.form_submissions,public.form_answers from authenticated;
grant select on public.form_submissions,public.form_answers to authenticated;

create or replace function public.submit_form(p_form uuid,p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  f public.forms;
  s uuid;
  item jsonb;
  field public.form_fields;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into f from public.forms where id=p_form;
  if not found or not f.active then raise exception 'FORM_NOT_ACTIVE'; end if;
  if not public.target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if f.opens_at is not null and now()<f.opens_at then raise exception 'FORM_NOT_OPEN'; end if;
  if f.closes_at is not null and now()>f.closes_at then raise exception 'FORM_CLOSED'; end if;
  if f.single_response and exists(select 1 from public.form_submissions x where x.form_id=f.id and x.user_id=auth.uid()) then
    raise exception 'FORM_ALREADY_SUBMITTED';
  end if;
  if jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_DATA'; end if;

  -- Required fields are validated before creating the submission.
  for field in select * from public.form_fields where form_id=f.id and required
  loop
    if not exists(
      select 1 from jsonb_array_elements(p_answers) x
      where (x->>'field_id')::uuid=field.id
        and x ? 'answer'
        and x->'answer' not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb)
    ) then raise exception 'FORM_REQUIRED_FIELD_MISSING'; end if;
  end loop;

  insert into public.form_submissions(form_id,user_id)
  values(f.id,auth.uid()) returning id into s;

  for item in select value from jsonb_array_elements(p_answers)
  loop
    select * into field from public.form_fields
    where id=(item->>'field_id')::uuid and form_id=f.id;
    if found then
      insert into public.form_answers(submission_id,field_id,answer)
      values(s,field.id,coalesce(item->'answer','null'::jsonb));
    end if;
  end loop;
  return s;
end
$$;
grant execute on function public.submit_form(uuid,jsonb) to authenticated;

-- Polls
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  anonymous boolean not null default false,
  show_results boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint polls_time_check check(ends_at is null or starts_at is null or ends_at>=starts_at)
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_text text not null,
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint poll_one_vote_per_user unique(poll_id,user_id)
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select to authenticated
using(public.target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id));
drop policy if exists polls_manager on public.polls;
create policy polls_manager on public.polls for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options for select to authenticated
using(exists(select 1 from public.polls p where p.id=poll_id and public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id)));
drop policy if exists poll_options_manager on public.poll_options;
create policy poll_options_manager on public.poll_options for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.poll_votes from authenticated;
grant select on public.poll_votes to authenticated;

create or replace function public.vote_poll(p_poll uuid,p_option uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare p public.polls;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  if not public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p.starts_at is not null and now()<p.starts_at then raise exception 'POLL_NOT_STARTED'; end if;
  if p.ends_at is not null and now()>p.ends_at then raise exception 'POLL_ENDED'; end if;
  if not exists(select 1 from public.poll_options o where o.id=p_option and o.poll_id=p.id) then
    raise exception 'POLL_OPTION_INVALID';
  end if;

  begin
    insert into public.poll_votes(poll_id,option_id,user_id) values(p.id,p_option,auth.uid());
  exception when unique_violation then
    raise exception 'POLL_ALREADY_VOTED';
  end;
end
$$;
grant execute on function public.vote_poll(uuid,uuid) to authenticated;

create or replace function public.poll_results(p_poll uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare p public.polls;
declare total integer;
begin
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  if not public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if not (p.show_results or public.is_manager() or p.created_by=auth.uid() or (p.ends_at is not null and now()>p.ends_at)) then
    raise exception 'POLL_RESULTS_HIDDEN';
  end if;

  select count(*) into total from public.poll_votes v where v.poll_id=p.id;
  return jsonb_build_object(
    'participants',total,
    'anonymous',p.anonymous,
    'options',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'text',o.option_text,
        'votes',coalesce(v.cnt,0),
        'percent',case when total=0 then 0 else round(coalesce(v.cnt,0)::numeric*100/total,2) end
      ) order by o.sort_order,o.id)
      from public.poll_options o
      left join (
        select option_id,count(*) cnt from public.poll_votes where poll_id=p.id group by option_id
      ) v on v.option_id=o.id
      where o.poll_id=p.id
    ),'[]'::jsonb)
  );
end
$$;
grant execute on function public.poll_results(uuid) to authenticated;

select public.attach_audit_trigger(x)
from unnest(array['exams','behavior_events','forms']) as x;

          and o.id=(ans.answer_data->>'option_id')::uuid
          and o.is_correct
      ) then eq.score else 0 end
    else null
  end,
  updated_at=now()
  from public.question_bank q
  join public.exam_questions eq on eq.question_id=q.id and eq.exam_id=e.id
  where ans.attempt_id=a.id and ans.question_id=q.id;

  select coalesce(sum(coalesce(ans.auto_score,0)),0),
         coalesce(sum(coalesce(ans.manual_score,0)),0)
  into v_auto,v_manual
  from public.exam_answers ans where ans.attempt_id=a.id;

  update public.exam_attempts
  set submitted_at=now(),
      status='submitted',
      auto_score=v_auto,
      manual_score=v_manual,
      total_score=v_auto+v_manual,
      updated_at=now()
  where id=a.id
  returning * into a;

  return jsonb_build_object(
    'attempt_id',a.id,
    'status',a.status,
    'auto_score',a.auto_score,
    'manual_score',a.manual_score,
    'total_score',case when e.show_result_after_submit then a.total_score else null end
  );
end
$$;
grant execute on function public.submit_exam(uuid) to authenticated;

create or replace function public.grade_exam_answer(
  p_answer uuid,
  p_score numeric,
  p_feedback text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ans public.exam_answers;
  a public.exam_attempts;
  e public.exams;
  eq public.exam_questions;
  v_manual numeric(7,2);
  v_auto numeric(7,2);
  pending_count integer;
begin
  select * into ans from public.exam_answers where id=p_answer for update;
  if not found then raise exception 'ANSWER_NOT_FOUND'; end if;
  select * into a from public.exam_attempts where id=ans.attempt_id;
  select * into e from public.exams where id=a.exam_id;
  if not (public.is_manager() or e.teacher_id=auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  select * into eq from public.exam_questions where exam_id=e.id and question_id=ans.question_id;
  if p_score<0 or p_score>eq.score then raise exception 'INVALID_SCORE'; end if;

  update public.exam_answers
  set manual_score=p_score,feedback=p_feedback,updated_at=now()
  where id=ans.id;

  select coalesce(sum(coalesce(auto_score,0)),0),
         coalesce(sum(coalesce(manual_score,0)),0)
  into v_auto,v_manual
  from public.exam_answers where attempt_id=a.id;

  select count(*) into pending_count
  from public.exam_questions x
  join public.question_bank q on q.id=x.question_id
  left join public.exam_answers ea on ea.attempt_id=a.id and ea.question_id=x.question_id
  where x.exam_id=e.id
    and q.question_type in ('short_answer','essay')
    and ea.manual_score is null;

  update public.exam_attempts
  set auto_score=v_auto,manual_score=v_manual,total_score=v_auto+v_manual,
      status=case when pending_count=0 then 'graded' else 'submitted' end,
      updated_at=now()
  where id=a.id;

  return jsonb_build_object('auto_score',v_auto,'manual_score',v_manual,'total_score',v_auto+v_manual);
end
$$;
grant execute on function public.grade_exam_answer(uuid,numeric,text) to authenticated;

create or replace function public.notify_exam_published()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare sid uuid;
begin
  if new.published and (tg_op='INSERT' or old.published is distinct from true) then
    for sid in select cs.student_id from public.class_students cs where cs.class_id=new.class_id
    loop
      perform public.notify_user(
        sid,'exam_new','آزمون جدید',new.title,'exams',
        'exam',new.id,'exam:new:'||new.id::text
      );
    end loop;
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_exam_published on public.exams;
create trigger trg_notify_exam_published
after insert or update on public.exams
for each row execute function public.notify_exam_published();

-- Advanced behavior and encouragement
create table if not exists public.behavior_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  default_points integer not null default 0,
  event_type text not null default 'neutral' check(event_type in ('positive','negative','neutral')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  event_date date not null default current_date,
  category_id uuid references public.behavior_categories(id) on delete set null,
  category text not null,
  event_type text not null check(event_type in ('positive','negative','neutral')),
  title text not null,
  description text,
  points integer not null default 0,
  recorded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_behavior_student_date on public.behavior_events(student_id,event_date desc);

alter table public.behavior_categories enable row level security;
alter table public.behavior_events enable row level security;

drop policy if exists behavior_categories_read on public.behavior_categories;
create policy behavior_categories_read on public.behavior_categories for select to authenticated using(active or public.is_manager());
drop policy if exists behavior_categories_manager on public.behavior_categories;
create policy behavior_categories_manager on public.behavior_categories for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists behavior_events_read on public.behavior_events;
create policy behavior_events_read on public.behavior_events for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id)
);
drop policy if exists behavior_events_write on public.behavior_events;
create policy behavior_events_write on public.behavior_events for insert to authenticated
with check(
  public.is_manager()
  or (
    recorded_by=auth.uid()
    and exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id)
  )
);
drop policy if exists behavior_events_update on public.behavior_events;
create policy behavior_events_update on public.behavior_events for update to authenticated
using(public.is_manager() or recorded_by=auth.uid())
with check(public.is_manager() or recorded_by=auth.uid());
drop policy if exists behavior_events_delete on public.behavior_events;
create policy behavior_events_delete on public.behavior_events for delete to authenticated
using(public.is_manager());

insert into public.behavior_categories(title,default_points,event_type)
values
('تشویق علمی',5,'positive'),
('همکاری در کلاس',3,'positive'),
('پیشرفت تحصیلی',4,'positive'),
('فعالیت فرهنگی',3,'positive'),
('مسئولیت‌پذیری',3,'positive'),
('تأخیر',-1,'negative'),
('بی‌نظمی',-2,'negative'),
('تذکر',-1,'negative'),
('انجام ندادن تکلیف',-2,'negative'),
('سایر',0,'neutral')
on conflict(title) do nothing;

-- Internal form builder
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  active boolean not null default true,
  single_response boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forms_time_check check(closes_at is null or opens_at is null or closes_at>=opens_at)
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  field_type text not null check(field_type in ('short_text','long_text','number','date','time','single_choice','multi_choice','yes_no')),
  label text not null,
  placeholder text,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  submitted_at timestamptz not null default now()
);

create table if not exists public.form_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  field_id uuid not null references public.form_fields(id) on delete cascade,
  answer jsonb not null default 'null'::jsonb,
  constraint form_answer_once unique(submission_id,field_id)
);

create index if not exists idx_forms_active_time on public.forms(active,opens_at,closes_at);
create index if not exists idx_form_submissions_form on public.form_submissions(form_id,submitted_at desc);

alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_answers enable row level security;

create or replace function public.target_visible(
  p_type text,p_role public.user_role,p_grade uuid,p_class uuid,p_user uuid
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or p_type='all'
    or (p_type='role' and p_role=public.current_role())
    or (p_type='user' and p_user=auth.uid())
    or (p_type='class' and public.can_read_class(p_class))
    or (
      p_type='grade' and exists(
        select 1 from public.classes c
        where c.grade_id=p_grade and public.can_read_class(c.id)
      )
    )
$$;
grant execute on function public.target_visible(text,public.user_role,uuid,uuid,uuid) to authenticated;

drop policy if exists forms_read on public.forms;
create policy forms_read on public.forms for select to authenticated
using(public.target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id));
drop policy if exists forms_manager on public.forms;
create policy forms_manager on public.forms for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists form_fields_read on public.form_fields;
create policy form_fields_read on public.form_fields for select to authenticated
using(exists(select 1 from public.forms f where f.id=form_id and public.target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id)));
drop policy if exists form_fields_manager on public.form_fields;
create policy form_fields_manager on public.form_fields for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists form_submissions_read on public.form_submissions;
create policy form_submissions_read on public.form_submissions for select to authenticated
using(user_id=auth.uid() or public.is_manager());

drop policy if exists form_answers_read on public.form_answers;
create policy form_answers_read on public.form_answers for select to authenticated
using(
  exists(select 1 from public.form_submissions s where s.id=submission_id and (s.user_id=auth.uid() or public.is_manager()))
);

revoke insert,update,delete on public.form_submissions,public.form_answers from authenticated;
grant select on public.form_submissions,public.form_answers to authenticated;

create or replace function public.submit_form(p_form uuid,p_answers jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  f public.forms;
  s uuid;
  item jsonb;
  field public.form_fields;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into f from public.forms where id=p_form;
  if not found or not f.active then raise exception 'FORM_NOT_ACTIVE'; end if;
  if not public.target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if f.opens_at is not null and now()<f.opens_at then raise exception 'FORM_NOT_OPEN'; end if;
  if f.closes_at is not null and now()>f.closes_at then raise exception 'FORM_CLOSED'; end if;
  if f.single_response and exists(select 1 from public.form_submissions x where x.form_id=f.id and x.user_id=auth.uid()) then
    raise exception 'FORM_ALREADY_SUBMITTED';
  end if;
  if jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_DATA'; end if;

  -- Required fields are validated before creating the submission.
  for field in select * from public.form_fields where form_id=f.id and required
  loop
    if not exists(
      select 1 from jsonb_array_elements(p_answers) x
      where (x->>'field_id')::uuid=field.id
        and x ? 'answer'
        and x->'answer' not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb)
    ) then raise exception 'FORM_REQUIRED_FIELD_MISSING'; end if;
  end loop;

  insert into public.form_submissions(form_id,user_id)
  values(f.id,auth.uid()) returning id into s;

  for item in select value from jsonb_array_elements(p_answers)
  loop
    select * into field from public.form_fields
    where id=(item->>'field_id')::uuid and form_id=f.id;
    if found then
      insert into public.form_answers(submission_id,field_id,answer)
      values(s,field.id,coalesce(item->'answer','null'::jsonb));
    end if;
  end loop;
  return s;
end
$$;
grant execute on function public.submit_form(uuid,jsonb) to authenticated;

-- Polls
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  anonymous boolean not null default false,
  show_results boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint polls_time_check check(ends_at is null or starts_at is null or ends_at>=starts_at)
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_text text not null,
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  constraint poll_one_vote_per_user unique(poll_id,user_id)
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select to authenticated
using(public.target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id));
drop policy if exists polls_manager on public.polls;
create policy polls_manager on public.polls for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options for select to authenticated
using(exists(select 1 from public.polls p where p.id=poll_id and public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id)));
drop policy if exists poll_options_manager on public.poll_options;
create policy poll_options_manager on public.poll_options for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.poll_votes from authenticated;
grant select on public.poll_votes to authenticated;

create or replace function public.vote_poll(p_poll uuid,p_option uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare p public.polls;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  if not public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p.starts_at is not null and now()<p.starts_at then raise exception 'POLL_NOT_STARTED'; end if;
  if p.ends_at is not null and now()>p.ends_at then raise exception 'POLL_ENDED'; end if;
  if not exists(select 1 from public.poll_options o where o.id=p_option and o.poll_id=p.id) then
    raise exception 'POLL_OPTION_INVALID';
  end if;

  begin
    insert into public.poll_votes(poll_id,option_id,user_id) values(p.id,p_option,auth.uid());
  exception when unique_violation then
    raise exception 'POLL_ALREADY_VOTED';
  end;
end
$$;
grant execute on function public.vote_poll(uuid,uuid) to authenticated;

create or replace function public.poll_results(p_poll uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare p public.polls;
declare total integer;
begin
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  if not public.target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if not (p.show_results or public.is_manager() or p.created_by=auth.uid() or (p.ends_at is not null and now()>p.ends_at)) then
    raise exception 'POLL_RESULTS_HIDDEN';
  end if;

  select count(*) into total from public.poll_votes v where v.poll_id=p.id;
  return jsonb_build_object(
    'participants',total,
    'anonymous',p.anonymous,
    'options',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'text',o.option_text,
        'votes',coalesce(v.cnt,0),
        'percent',case when total=0 then 0 else round(coalesce(v.cnt,0)::numeric*100/total,2) end
      ) order by o.sort_order,o.id)
      from public.poll_options o
      left join (
        select option_id,count(*) cnt from public.poll_votes where poll_id=p.id group by option_id
      ) v on v.option_id=o.id
      where o.poll_id=p.id
    ),'[]'::jsonb)
  );
end
$$;
grant execute on function public.poll_results(uuid) to authenticated;

select public.attach_audit_trigger(x)
from unnest(array['exams','behavior_events','forms']) as x;
