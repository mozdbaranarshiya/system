-- v7 / مرحله ۶: آزمون آنلاین و بانک سؤال
set role postgres;

do $$ begin
  create type public.question_type as enum ('multiple_choice','true_false','short_answer','essay');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exam_attempt_status as enum ('in_progress','submitted','graded','expired');
exception when duplicate_object then null; end $$;

create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  question_type public.question_type not null,
  question_text text not null,
  default_score numeric(6,2) not null default 1 check(default_score>0),
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

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_minutes integer not null check(duration_minutes between 1 and 600),
  max_score numeric(6,2) not null default 20 check(max_score>0),
  published boolean not null default false,
  show_result_after_submit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at>start_at)
);

create table if not exists public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  score numeric(6,2) not null check(score>0),
  sort_order integer not null default 0,
  primary key(exam_id,question_id)
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status public.exam_attempt_status not null default 'in_progress',
  auto_score numeric(6,2) not null default 0,
  manual_score numeric(6,2) not null default 0,
  total_score numeric(6,2) not null default 0,
  graded_by uuid references public.profiles(id),
  graded_at timestamptz,
  unique(exam_id,student_id)
);

create table if not exists public.exam_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  selected_option_id uuid references public.question_options(id) on delete set null,
  answer_text text,
  manual_score numeric(6,2),
  feedback text,
  updated_at timestamptz not null default now(),
  unique(attempt_id,question_id)
);

create index if not exists idx_questions_teacher_subject on public.question_bank(teacher_id,subject_id);
create index if not exists idx_exams_class_time on public.exams(class_id,start_at,end_at);
create index if not exists idx_exams_teacher on public.exams(teacher_id,created_at desc);
create index if not exists idx_attempts_student on public.exam_attempts(student_id,started_at desc);
create index if not exists idx_attempts_exam on public.exam_attempts(exam_id,status);

drop trigger if exists trg_question_updated_at on public.question_bank;
create trigger trg_question_updated_at before update on public.question_bank for each row execute function public.touch_updated_at();
drop trigger if exists trg_exam_updated_at on public.exams;
create trigger trg_exam_updated_at before update on public.exams for each row execute function public.touch_updated_at();
drop trigger if exists trg_exam_answer_updated_at on public.exam_answers;
create trigger trg_exam_answer_updated_at before update on public.exam_answers for each row execute function public.touch_updated_at();

alter table public.question_bank enable row level security;
alter table public.question_options enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;

drop policy if exists question_bank_staff on public.question_bank;
create policy question_bank_staff on public.question_bank for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(public.is_manager() or teacher_id=auth.uid());

drop policy if exists question_options_staff on public.question_options;
create policy question_options_staff on public.question_options for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.question_bank q where q.id=question_options.question_id and q.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.question_bank q where q.id=question_options.question_id and q.teacher_id=auth.uid())
);

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select to authenticated
using(
  public.password_change_complete()
  and (
    public.is_manager()
    or teacher_id=auth.uid()
    or (published and public.student_in_class(class_id))
  )
);

drop policy if exists exams_teacher_write on public.exams;
create policy exams_teacher_write on public.exams for all to authenticated
using(public.is_manager() or teacher_id=auth.uid())
with check(
  public.is_manager()
  or (teacher_id=auth.uid() and public.teacher_has_access(class_id,subject_id))
);

drop policy if exists exam_questions_staff_read on public.exam_questions;
create policy exam_questions_staff_read on public.exam_questions for select to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_questions.exam_id and e.teacher_id=auth.uid())
);

drop policy if exists exam_questions_staff_write on public.exam_questions;
create policy exam_questions_staff_write on public.exam_questions for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_questions.exam_id and e.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_questions.exam_id and e.teacher_id=auth.uid())
);

drop policy if exists attempts_read on public.exam_attempts;
create policy attempts_read on public.exam_attempts for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.exams e where e.id=exam_attempts.exam_id and e.teacher_id=auth.uid())
);

drop policy if exists answers_read on public.exam_answers;
create policy answers_read on public.exam_answers for select to authenticated
using(
  exists(select 1 from public.exam_attempts a where a.id=exam_answers.attempt_id and a.student_id=auth.uid())
  or public.is_manager()
  or exists(
    select 1 from public.exam_attempts a join public.exams e on e.id=a.exam_id
    where a.id=exam_answers.attempt_id and e.teacher_id=auth.uid()
  )
);

create or replace function public.start_exam(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.exams;
  a public.exam_attempts;
  deadline timestamptz;
begin
  select * into e from public.exams where id=p_exam;
  if not found or not e.published then raise exception 'EXAM_NOT_AVAILABLE'; end if;
  if not public.student_in_class(e.class_id) then raise exception 'ACCESS_DENIED'; end if;
  if now()<e.start_at then raise exception 'EXAM_NOT_STARTED'; end if;
  if now()>e.end_at then raise exception 'EXAM_ENDED'; end if;

  insert into public.exam_attempts(exam_id,student_id)
  values(e.id,auth.uid())
  on conflict(exam_id,student_id) do nothing;

  select * into a from public.exam_attempts where exam_id=e.id and student_id=auth.uid();
  if a.status<>'in_progress' then
    return jsonb_build_object('attempt_id',a.id,'status',a.status,'deadline',a.submitted_at);
  end if;

  deadline:=least(e.end_at,a.started_at+(e.duration_minutes||' minutes')::interval);
  if now()>deadline then
    update public.exam_attempts set status='expired',submitted_at=now() where id=a.id;
    raise exception 'EXAM_TIME_ENDED';
  end if;

  return jsonb_build_object('attempt_id',a.id,'status',a.status,'deadline',deadline,'server_now',now());
end
$$;

create or replace function public.get_exam_content(p_exam uuid,p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.exams;
  a public.exam_attempts;
  deadline timestamptz;
  questions jsonb;
begin
  select * into e from public.exams where id=p_exam and published;
  if not found then raise exception 'EXAM_NOT_AVAILABLE'; end if;
  select * into a from public.exam_attempts where id=p_attempt and exam_id=e.id and student_id=auth.uid();
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  deadline:=least(e.end_at,a.started_at+(e.duration_minutes||' minutes')::interval);
  if a.status<>'in_progress' or now()>deadline then raise exception 'EXAM_TIME_ENDED'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',q.id,
      'type',q.question_type,
      'text',q.question_text,
      'score',eq.score,
      'sort_order',eq.sort_order,
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'text',o.option_text,'sort_order',o.sort_order) order by o.sort_order)
        from public.question_options o where o.question_id=q.id
      ),'[]'::jsonb)
    ) order by eq.sort_order
  ),'[]'::jsonb)
  into questions
  from public.exam_questions eq
  join public.question_bank q on q.id=eq.question_id
  where eq.exam_id=e.id;

  return jsonb_build_object(
    'exam',jsonb_build_object('id',e.id,'title',e.title,'description',e.description,'max_score',e.max_score),
    'attempt_id',a.id,
    'deadline',deadline,
    'server_now',now(),
    'questions',questions
  );
end
$$;

create or replace function public.submit_exam(
  p_attempt uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.exam_attempts;
  e public.exams;
  deadline timestamptz;
  item jsonb;
  qid uuid;
  selected uuid;
  answer_text text;
  auto_total numeric:=0;
  qtype public.question_type;
  qscore numeric;
  correct_option uuid;
begin
  select * into a from public.exam_attempts where id=p_attempt and student_id=auth.uid() for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  if a.status<>'in_progress' then raise exception 'ATTEMPT_ALREADY_SUBMITTED'; end if;
  select * into e from public.exams where id=a.exam_id;
  deadline:=least(e.end_at,a.started_at+(e.duration_minutes||' minutes')::interval);
  if now()>deadline then
    update public.exam_attempts set status='expired',submitted_at=now() where id=a.id;
    raise exception 'EXAM_TIME_ENDED';
  end if;
  if jsonb_typeof(p_answers)<>'array' then raise exception 'INVALID_DATA'; end if;

  for item in select value from jsonb_array_elements(p_answers)
  loop
    qid:=(item->>'question_id')::uuid;
    selected:=nullif(item->>'selected_option_id','')::uuid;
    answer_text:=nullif(item->>'answer_text','');

    select q.question_type,eq.score into qtype,qscore
    from public.exam_questions eq join public.question_bank q on q.id=eq.question_id
    where eq.exam_id=e.id and q.id=qid;
    if not found then raise exception 'QUESTION_NOT_IN_EXAM'; end if;

    if selected is not null and not exists(
      select 1 from public.question_options o where o.id=selected and o.question_id=qid
    ) then raise exception 'INVALID_OPTION'; end if;

    insert into public.exam_answers(attempt_id,question_id,selected_option_id,answer_text)
    values(a.id,qid,selected,answer_text)
    on conflict(attempt_id,question_id) do update
    set selected_option_id=excluded.selected_option_id,answer_text=excluded.answer_text,updated_at=now();

    if qtype in ('multiple_choice','true_false') then
      select o.id into correct_option from public.question_options o where o.question_id=qid and o.is_correct limit 1;
      if selected is not null and selected=correct_option then auto_total:=auto_total+qscore; end if;
    end if;
  end loop;

  update public.exam_attempts
  set status='submitted',submitted_at=now(),auto_score=auto_total,total_score=auto_total
  where id=a.id;

  return jsonb_build_object(
    'auto_score',auto_total,
    'show_result',e.show_result_after_submit,
    'total_score',case when e.show_result_after_submit then auto_total else null end
  );
end
$$;

create or replace function public.grade_exam_attempt(
  p_attempt uuid,
  p_manual_score numeric
) returns public.exam_attempts
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.exam_attempts;
  e public.exams;
begin
  select * into a from public.exam_attempts where id=p_attempt for update;
  if not found then raise exception 'ATTEMPT_NOT_FOUND'; end if;
  select * into e from public.exams where id=a.exam_id;
  if not (public.is_manager() or e.teacher_id=auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  if p_manual_score<0 or a.auto_score+p_manual_score>e.max_score then raise exception 'INVALID_SCORE'; end if;

  update public.exam_attempts
  set manual_score=p_manual_score,total_score=auto_score+p_manual_score,status='graded',graded_by=auth.uid(),graded_at=now()
  where id=a.id returning * into a;
  return a;
end
$$;

grant select,insert,update,delete on public.question_bank,public.question_options,public.exams,public.exam_questions to authenticated;
grant select on public.exam_attempts,public.exam_answers to authenticated;
grant execute on function public.start_exam(uuid) to authenticated;
grant execute on function public.get_exam_content(uuid,uuid) to authenticated;
grant execute on function public.submit_exam(uuid,jsonb) to authenticated;
grant execute on function public.grade_exam_attempt(uuid,numeric) to authenticated;

select public.attach_audit_trigger('public.exams'::regclass);

-- اعلان آزمون پس از انتشار
create or replace function public.notify_exam_published()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.published and (tg_op='INSERT' or old.published is distinct from new.published) then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select cs.student_id,'exam_new','آزمون جدید',new.title,'exams','exam',new.id,'exam:new:'||new.id::text
    from public.class_students cs where cs.class_id=new.class_id
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_exam_published on public.exams;
create trigger trg_notify_exam_published after insert or update on public.exams
for each row execute function public.notify_exam_published();
