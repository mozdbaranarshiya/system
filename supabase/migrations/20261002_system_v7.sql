-- system v7 - complete school suite
-- Safe upgrade from v6.1.0. Existing data is preserved.
create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

alter table public.school_settings
  add column if not exists passing_score numeric(5,2) not null default 10 check (passing_score between 0 and 20),
  add column if not exists school_display_name text;

create or replace function public.v7_account_ready()
returns boolean
language sql stable security definer set search_path=public
as $$
  select coalesce((select not must_change_password from public.profiles where id=auth.uid()), false)
$$;

create or replace function public.v7_teacher_has_class(p_class uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.teacher_assignments
    where teacher_id=auth.uid() and class_id=p_class
  )
$$;

create or replace function public.v7_target_visible(
  p_target_type text,
  p_target_role text default null,
  p_grade uuid default null,
  p_class uuid default null,
  p_user uuid default null
)
returns boolean
language sql stable security definer set search_path=public
as $$
  select
    public.is_manager()
    or p_target_type='all'
    or (p_target_type='role' and public.current_role()::text=p_target_role)
    or (p_target_type='user' and p_user=auth.uid())
    or (p_target_type='class' and p_class is not null and (
      public.student_in_class(p_class) or public.v7_teacher_has_class(p_class)
    ))
    or (p_target_type='grade' and p_grade is not null and (
      exists(
        select 1 from public.class_students cs
        join public.classes c on c.id=cs.class_id
        where cs.student_id=auth.uid() and c.grade_id=p_grade
      )
      or exists(
        select 1 from public.teacher_assignments ta
        join public.classes c on c.id=ta.class_id
        where ta.teacher_id=auth.uid() and c.grade_id=p_grade
      )
    ))
$$;

-- Weekly periods and timetable
create table if not exists public.school_periods (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_order int not null check(period_order > 0),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check(end_time > start_time),
  unique(period_order)
);

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check(weekday between 0 and 5),
  period_id uuid not null references public.school_periods(id) on delete cascade,
  academic_year text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id,weekday,period_id,academic_year),
  unique(teacher_id,weekday,period_id,academic_year)
);

-- Attendance
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  schedule_entry_id uuid references public.timetable_entries(id) on delete set null,
  attendance_date date not null default current_date,
  status text not null check(status in ('present','absent','excused','unexcused','late','early_leave')),
  delay_minutes int not null default 0 check(delay_minutes between 0 and 600),
  note text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists attendance_unique_session
on public.attendance_records(
  student_id,class_id,attendance_date,
  coalesce(schedule_entry_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid)
);
create index if not exists attendance_student_date_idx on public.attendance_records(student_id,attendance_date desc);
create index if not exists attendance_class_date_idx on public.attendance_records(class_id,attendance_date desc);

-- Behavior and encouragement
create table if not exists public.behavior_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  default_type text not null default 'neutral' check(default_type in ('positive','negative','neutral')),
  default_points int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.behavior_categories(title,default_type,default_points)
values
  ('تشویق علمی','positive',5),
  ('همکاری در کلاس','positive',3),
  ('پیشرفت تحصیلی','positive',4),
  ('فعالیت فرهنگی','positive',3),
  ('مسئولیت‌پذیری','positive',3),
  ('تأخیر','negative',-1),
  ('بی‌نظمی','negative',-2),
  ('تذکر','negative',-1),
  ('انجام ندادن تکلیف','negative',-2),
  ('سایر','neutral',0)
on conflict(title) do nothing;

create table if not exists public.behavior_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  event_date date not null default current_date,
  category_id uuid references public.behavior_categories(id) on delete set null,
  event_type text not null check(event_type in ('positive','negative','neutral')),
  title text not null,
  description text,
  points int not null default 0 check(points between -100 and 100),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists behavior_student_date_idx on public.behavior_events(student_id,event_date desc);

-- Exam bank
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  question_type text not null check(question_type in ('multiple_choice','true_false','short_answer','essay')),
  question_text text not null,
  correct_text text,
  default_score numeric(6,2) not null default 1 check(default_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.question_bank(id) on delete cascade,
  option_text text not null,
  is_correct boolean not null default false,
  sort_order int not null default 0
);
create index if not exists question_options_question_idx on public.question_options(question_id,sort_order);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_minutes int not null check(duration_minutes between 1 and 1440),
  max_score numeric(6,2) not null default 20 check(max_score > 0),
  published boolean not null default false,
  show_result_after_submit boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at > start_at)
);

create table if not exists public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete restrict,
  score numeric(6,2) not null default 1 check(score >= 0),
  sort_order int not null default 0,
  primary key(exam_id,question_id)
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status text not null default 'in_progress' check(status in ('in_progress','submitted','graded','expired')),
  auto_score numeric(7,2) not null default 0,
  manual_score numeric(7,2) not null default 0,
  total_score numeric(7,2) not null default 0,
  unique(exam_id,student_id)
);

create table if not exists public.exam_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  selected_option_id uuid references public.question_options(id) on delete set null,
  answer_text text,
  awarded_score numeric(7,2),
  feedback text,
  updated_at timestamptz not null default now(),
  unique(attempt_id,question_id)
);

-- Calendar
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null default 'other' check(event_type in ('exam','holiday','parent_meeting','trip','competition','cultural','school_meeting','deadline','other')),
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role text check(target_role in ('manager','teacher','student')),
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists calendar_start_idx on public.calendar_events(start_at);

-- Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);
create unique index if not exists notifications_dedupe_idx on public.notifications(user_id,dedupe_key) where dedupe_key is not null;

-- Form builder
create table if not exists public.forms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role text check(target_role in ('manager','teacher','student')),
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  opens_at timestamptz,
  closes_at timestamptz,
  active boolean not null default true,
  one_response boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  field_type text not null check(field_type in ('short_text','long_text','number','date','time','single_choice','multi_choice','yes_no')),
  label text not null,
  placeholder text,
  required boolean not null default false,
  options jsonb,
  sort_order int not null default 0
);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  unique(form_id,user_id)
);

create table if not exists public.form_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.form_submissions(id) on delete cascade,
  field_id uuid not null references public.form_fields(id) on delete cascade,
  answer jsonb not null,
  unique(submission_id,field_id)
);

-- Polls
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role text check(target_role in ('manager','teacher','student')),
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  anonymous boolean not null default false,
  show_results boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_text text not null,
  sort_order int not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  voter_hash text not null,
  created_at timestamptz not null default now(),
  unique(poll_id,voter_hash)
);

-- Extracurricular classes
create table if not exists public.extracurricular_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'other',
  teacher_id uuid references public.profiles(id) on delete set null,
  capacity int not null check(capacity > 0),
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_start timestamptz,
  registration_end timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.extracurricular_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  check(ends_at > starts_at)
);

create table if not exists public.extracurricular_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id,student_id)
);

-- Appointments
create table if not exists public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  capacity int not null default 1 check(capacity between 1 and 50),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check(ends_at > starts_at)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.appointment_slots(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  description text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled','completed')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique(slot_id,requester_id)
);

-- Audit log
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_table_record_idx on public.audit_logs(table_name,record_id);

-- RLS
alter table public.school_periods enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.attendance_records enable row level security;
alter table public.behavior_categories enable row level security;
alter table public.behavior_events enable row level security;
alter table public.question_bank enable row level security;
alter table public.question_options enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_answers enable row level security;
alter table public.calendar_events enable row level security;
alter table public.notifications enable row level security;
alter table public.forms enable row level security;
alter table public.form_fields enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_answers enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.extracurricular_classes enable row level security;
alter table public.extracurricular_sessions enable row level security;
alter table public.extracurricular_enrollments enable row level security;
alter table public.appointment_slots enable row level security;
alter table public.appointments enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists v7_period_read on public.school_periods;
create policy v7_period_read on public.school_periods for select to authenticated using (public.v7_account_ready());
drop policy if exists v7_period_manager on public.school_periods;
create policy v7_period_manager on public.school_periods for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_timetable_read on public.timetable_entries;
create policy v7_timetable_read on public.timetable_entries for select to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or teacher_id=auth.uid() or public.student_in_class(class_id)
  )
);
drop policy if exists v7_timetable_manager on public.timetable_entries;
create policy v7_timetable_manager on public.timetable_entries for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_attendance_read on public.attendance_records;
create policy v7_attendance_read on public.attendance_records for select to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or student_id=auth.uid() or public.v7_teacher_has_class(class_id)
  )
);
drop policy if exists v7_attendance_write on public.attendance_records;
create policy v7_attendance_write on public.attendance_records for all to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or (public.current_role()='teacher' and public.v7_teacher_has_class(class_id))
  )
) with check(
  public.v7_account_ready() and (
    public.is_manager() or (public.current_role()='teacher' and public.v7_teacher_has_class(class_id))
  )
);

drop policy if exists v7_behavior_category_read on public.behavior_categories;
create policy v7_behavior_category_read on public.behavior_categories for select to authenticated using(public.v7_account_ready());
drop policy if exists v7_behavior_category_manager on public.behavior_categories;
create policy v7_behavior_category_manager on public.behavior_categories for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_behavior_read on public.behavior_events;
create policy v7_behavior_read on public.behavior_events for select to authenticated using(
  public.v7_account_ready() and (public.is_manager() or student_id=auth.uid() or public.v7_teacher_has_class(class_id))
);
drop policy if exists v7_behavior_write on public.behavior_events;
create policy v7_behavior_write on public.behavior_events for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or (public.current_role()='teacher' and public.v7_teacher_has_class(class_id)))
) with check(
  public.v7_account_ready() and (public.is_manager() or (public.current_role()='teacher' and public.v7_teacher_has_class(class_id)))
);

drop policy if exists v7_question_bank on public.question_bank;
create policy v7_question_bank on public.question_bank for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or teacher_id=auth.uid())
) with check(public.v7_account_ready() and (public.is_manager() or teacher_id=auth.uid()));

drop policy if exists v7_question_options on public.question_options;
create policy v7_question_options on public.question_options for all to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.question_bank q where q.id=question_id and q.teacher_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.question_bank q where q.id=question_id and q.teacher_id=auth.uid())
  )
);

drop policy if exists v7_exams_read on public.exams;
create policy v7_exams_read on public.exams for select to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or teacher_id=auth.uid() or (published and public.student_in_class(class_id))
  )
);
drop policy if exists v7_exams_write on public.exams;
create policy v7_exams_write on public.exams for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or teacher_id=auth.uid())
) with check(
  public.v7_account_ready() and (
    public.is_manager() or (teacher_id=auth.uid() and public.teacher_has_access(class_id,subject_id))
  )
);

drop policy if exists v7_exam_questions_staff on public.exam_questions;
create policy v7_exam_questions_staff on public.exam_questions for all to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
  )
);

drop policy if exists v7_attempt_read on public.exam_attempts;
create policy v7_attempt_read on public.exam_attempts for select to authenticated using(
  public.v7_account_ready() and (
    student_id=auth.uid() or public.is_manager() or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
  )
);
drop policy if exists v7_attempt_staff_update on public.exam_attempts;
create policy v7_attempt_staff_update on public.exam_attempts for update to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.exams e where e.id=exam_id and e.teacher_id=auth.uid())
  )
);

drop policy if exists v7_answer_read on public.exam_answers;
create policy v7_answer_read on public.exam_answers for select to authenticated using(
  public.v7_account_ready() and exists(
    select 1 from public.exam_attempts a
    join public.exams e on e.id=a.exam_id
    where a.id=attempt_id and (a.student_id=auth.uid() or public.is_manager() or e.teacher_id=auth.uid())
  )
);
drop policy if exists v7_answer_staff_update on public.exam_answers;
create policy v7_answer_staff_update on public.exam_answers for update to authenticated using(
  public.v7_account_ready() and exists(
    select 1 from public.exam_attempts a join public.exams e on e.id=a.exam_id
    where a.id=attempt_id and (public.is_manager() or e.teacher_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and exists(
    select 1 from public.exam_attempts a join public.exams e on e.id=a.exam_id
    where a.id=attempt_id and (public.is_manager() or e.teacher_id=auth.uid())
  )
);

drop policy if exists v7_calendar_read on public.calendar_events;
create policy v7_calendar_read on public.calendar_events for select to authenticated using(
  public.v7_account_ready() and public.v7_target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id)
);
drop policy if exists v7_calendar_write on public.calendar_events;
create policy v7_calendar_write on public.calendar_events for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or created_by=auth.uid())
) with check(
  public.v7_account_ready() and (
    public.is_manager() or (
      public.current_role()='teacher' and created_by=auth.uid() and target_type='class' and public.v7_teacher_has_class(target_class_id)
    )
  )
);

drop policy if exists v7_notifications_read on public.notifications;
create policy v7_notifications_read on public.notifications for select to authenticated using(public.v7_account_ready() and user_id=auth.uid());
drop policy if exists v7_notifications_update on public.notifications;
create policy v7_notifications_update on public.notifications for update to authenticated using(public.v7_account_ready() and user_id=auth.uid()) with check(public.v7_account_ready() and user_id=auth.uid());
drop policy if exists v7_notifications_delete on public.notifications;
create policy v7_notifications_delete on public.notifications for delete to authenticated using(public.v7_account_ready() and user_id=auth.uid());

drop policy if exists v7_forms_read on public.forms;
create policy v7_forms_read on public.forms for select to authenticated using(
  public.v7_account_ready() and (public.is_manager() or (active and public.v7_target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id)))
);
drop policy if exists v7_forms_manager on public.forms;
create policy v7_forms_manager on public.forms for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_form_fields_read on public.form_fields;
create policy v7_form_fields_read on public.form_fields for select to authenticated using(
  public.v7_account_ready() and exists(select 1 from public.forms f where f.id=form_id)
);
drop policy if exists v7_form_fields_manager on public.form_fields;
create policy v7_form_fields_manager on public.form_fields for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_submission_read on public.form_submissions;
create policy v7_submission_read on public.form_submissions for select to authenticated using(
  public.v7_account_ready() and (user_id=auth.uid() or public.is_manager())
);
drop policy if exists v7_submission_insert on public.form_submissions;
create policy v7_submission_insert on public.form_submissions for insert to authenticated with check(
  public.v7_account_ready() and user_id=auth.uid() and exists(
    select 1 from public.forms f where f.id=form_id and f.active
      and (f.opens_at is null or now()>=f.opens_at) and (f.closes_at is null or now()<=f.closes_at)
      and public.v7_target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id)
  )
);
drop policy if exists v7_form_answers_read on public.form_answers;
create policy v7_form_answers_read on public.form_answers for select to authenticated using(
  public.v7_account_ready() and exists(select 1 from public.form_submissions s where s.id=submission_id and (s.user_id=auth.uid() or public.is_manager()))
);
drop policy if exists v7_form_answers_insert on public.form_answers;
create policy v7_form_answers_insert on public.form_answers for insert to authenticated with check(
  public.v7_account_ready() and exists(select 1 from public.form_submissions s where s.id=submission_id and s.user_id=auth.uid())
);

drop policy if exists v7_polls_read on public.polls;
create policy v7_polls_read on public.polls for select to authenticated using(
  public.v7_account_ready() and (public.is_manager() or (active and public.v7_target_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id)))
);
drop policy if exists v7_polls_manager on public.polls;
create policy v7_polls_manager on public.polls for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());
drop policy if exists v7_poll_options_read on public.poll_options;
create policy v7_poll_options_read on public.poll_options for select to authenticated using(public.v7_account_ready() and exists(select 1 from public.polls p where p.id=poll_id));
drop policy if exists v7_poll_options_manager on public.poll_options;
create policy v7_poll_options_manager on public.poll_options for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());
drop policy if exists v7_poll_votes_manager on public.poll_votes;
create policy v7_poll_votes_manager on public.poll_votes for select to authenticated using(public.is_manager() and public.v7_account_ready());

drop policy if exists v7_extra_read on public.extracurricular_classes;
create policy v7_extra_read on public.extracurricular_classes for select to authenticated using(public.v7_account_ready() and (active or public.is_manager() or teacher_id=auth.uid()));
drop policy if exists v7_extra_manager on public.extracurricular_classes;
create policy v7_extra_manager on public.extracurricular_classes for all to authenticated using(public.is_manager() and public.v7_account_ready()) with check(public.is_manager() and public.v7_account_ready());
drop policy if exists v7_extra_sessions_read on public.extracurricular_sessions;
create policy v7_extra_sessions_read on public.extracurricular_sessions for select to authenticated using(public.v7_account_ready() and exists(select 1 from public.extracurricular_classes c where c.id=class_id));
drop policy if exists v7_extra_sessions_staff on public.extracurricular_sessions;
create policy v7_extra_sessions_staff on public.extracurricular_sessions for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid()))
) with check(
  public.v7_account_ready() and (public.is_manager() or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid()))
);
drop policy if exists v7_extra_enroll_read on public.extracurricular_enrollments;
create policy v7_extra_enroll_read on public.extracurricular_enrollments for select to authenticated using(
  public.v7_account_ready() and (
    student_id=auth.uid() or public.is_manager() or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
  )
);
drop policy if exists v7_extra_enroll_staff_update on public.extracurricular_enrollments;
create policy v7_extra_enroll_staff_update on public.extracurricular_enrollments for update to authenticated using(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and (
    public.is_manager() or exists(select 1 from public.extracurricular_classes c where c.id=class_id and c.teacher_id=auth.uid())
  )
);

drop policy if exists v7_slots_read on public.appointment_slots;
create policy v7_slots_read on public.appointment_slots for select to authenticated using(public.v7_account_ready() and (active or public.is_manager() or staff_id=auth.uid()));
drop policy if exists v7_slots_staff on public.appointment_slots;
create policy v7_slots_staff on public.appointment_slots for all to authenticated using(
  public.v7_account_ready() and (public.is_manager() or staff_id=auth.uid())
) with check(
  public.v7_account_ready() and (public.is_manager() or staff_id=auth.uid())
);
drop policy if exists v7_appointments_read on public.appointments;
create policy v7_appointments_read on public.appointments for select to authenticated using(
  public.v7_account_ready() and (
    requester_id=auth.uid() or public.is_manager() or exists(select 1 from public.appointment_slots s where s.id=slot_id and s.staff_id=auth.uid())
  )
);
drop policy if exists v7_appointments_update on public.appointments;
create policy v7_appointments_update on public.appointments for update to authenticated using(
  public.v7_account_ready() and (
    requester_id=auth.uid() or public.is_manager() or exists(select 1 from public.appointment_slots s where s.id=slot_id and s.staff_id=auth.uid())
  )
) with check(
  public.v7_account_ready() and (
    requester_id=auth.uid() or public.is_manager() or exists(select 1 from public.appointment_slots s where s.id=slot_id and s.staff_id=auth.uid())
  )
);

drop policy if exists v7_audit_manager on public.audit_logs;
create policy v7_audit_manager on public.audit_logs for select to authenticated using(public.is_manager() and public.v7_account_ready());

-- Password gate for existing core data. Profiles remains readable so the password screen can load.
do $$
declare t text;
begin
  foreach t in array array[
    'grade_levels','classes','subjects','class_students','teacher_assignments','class_representatives',
    'scores','announcements','objections','discipline_scores','student_groups','student_group_members',
    'assignments','assignment_submissions','group_score_fields','group_score_entries','homework_grades','group_score_archives'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists v7_password_gate on public.%I',t);
      execute format(
        'create policy v7_password_gate on public.%I as restrictive for all to authenticated using (public.v7_account_ready()) with check (public.v7_account_ready())',
        t
      );
    end if;
  end loop;
end $$;

-- Audit trigger
create or replace function public.v7_audit_change()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_record text;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_record := coalesce(v_new->>'id',v_old->>'id',v_new->>'student_id',v_old->>'student_id',v_new->>'class_id',v_old->>'class_id');
  insert into public.audit_logs(user_id,action,table_name,record_id,old_data,new_data)
  values(auth.uid(),tg_op,tg_table_name,v_record,v_old,v_new);
  return coalesce(new,old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','scores','attendance_records','teacher_assignments','class_students','timetable_entries',
    'exams','discipline_scores','behavior_events','school_settings','forms','extracurricular_enrollments'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists v7_audit_trigger on public.%I',t);
      execute format('create trigger v7_audit_trigger after insert or update or delete on public.%I for each row execute function public.v7_audit_change()',t);
    end if;
  end loop;
end $$;

-- Notification helpers
create or replace function public.v7_notify(
  p_user uuid,p_type text,p_title text,p_body text default null,p_link text default null,
  p_entity_type text default null,p_entity_id uuid default null,p_dedupe_key text default null
)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
  values(p_user,p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_dedupe_key)
  on conflict (user_id,dedupe_key) where dedupe_key is not null do nothing;
end $$;

create or replace function public.v7_notify_target(
  p_target_type text,p_target_role text,p_grade uuid,p_class uuid,p_user uuid,
  p_type text,p_title text,p_body text,p_link text,p_entity_type text,p_entity_id uuid,p_suffix text
)
returns void
language plpgsql security definer set search_path=public
as $$
declare r record;
begin
  for r in
    select distinct p.id
    from public.profiles p
    where p.active
      and (
        p.id=p_user
        or p_target_type='all'
        or (p_target_type='role' and p.role::text=p_target_role)
        or (p_target_type='class' and exists(select 1 from public.class_students cs where cs.class_id=p_class and cs.student_id=p.id))
        or (p_target_type='grade' and exists(
          select 1 from public.class_students cs join public.classes c on c.id=cs.class_id
          where cs.student_id=p.id and c.grade_id=p_grade
        ))
      )
  loop
    perform public.v7_notify(r.id,p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_type||':'||p_entity_id::text||':'||coalesce(p_suffix,'0'));
  end loop;
end $$;

create or replace function public.v7_calendar_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  perform public.v7_notify_target(new.target_type,new.target_role,new.target_grade_id,new.target_class_id,new.target_user_id,
    'calendar','رویداد جدید: '||new.title,new.description,'calendar', 'calendar_event',new.id,'created');
  return new;
end $$;
drop trigger if exists v7_calendar_notify on public.calendar_events;
create trigger v7_calendar_notify after insert on public.calendar_events for each row execute function public.v7_calendar_notify_trigger();

create or replace function public.v7_exam_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
declare r record;
begin
  if new.published and (tg_op='INSERT' or old.published is distinct from new.published) then
    for r in select student_id from public.class_students where class_id=new.class_id loop
      perform public.v7_notify(r.student_id,'exam','آزمون جدید: '||new.title,new.description,'exams','exam',new.id,'exam:'||new.id::text||':published');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists v7_exam_notify on public.exams;
create trigger v7_exam_notify after insert or update of published on public.exams for each row execute function public.v7_exam_notify_trigger();

create or replace function public.v7_attendance_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.status<>'present' then
    perform public.v7_notify(new.student_id,'attendance','ثبت وضعیت حضور','وضعیت حضور شما ثبت یا اصلاح شد.','attendance','attendance',new.id,
      'attendance:'||new.id::text||':'||new.status);
  end if;
  return new;
end $$;
drop trigger if exists v7_attendance_notify on public.attendance_records;
create trigger v7_attendance_notify after insert or update of status on public.attendance_records for each row execute function public.v7_attendance_notify_trigger();

create or replace function public.v7_appointment_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_staff uuid;
begin
  select staff_id into v_staff from public.appointment_slots where id=new.slot_id;
  perform public.v7_notify(new.requester_id,'appointment','وضعیت ملاقات: '||new.status,new.subject,'appointments','appointment',new.id,
    'appointment:'||new.id::text||':'||new.status);
  if v_staff is distinct from new.requester_id then
    perform public.v7_notify(v_staff,'appointment','درخواست ملاقات',new.subject,'appointments','appointment',new.id,
      'appointment-staff:'||new.id::text||':'||new.status);
  end if;
  return new;
end $$;
drop trigger if exists v7_appointment_notify on public.appointments;
create trigger v7_appointment_notify after insert or update of status on public.appointments for each row execute function public.v7_appointment_notify_trigger();

create or replace function public.v7_assignment_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
declare r record;
begin
  for r in
    select distinct cs.student_id
    from public.class_students cs
    where cs.class_id=new.class_id
      and (new.group_id is null or exists(
        select 1 from public.student_group_members gm where gm.group_id=new.group_id and gm.student_id=cs.student_id
      ))
  loop
    perform public.v7_notify(r.student_id,'assignment','تکلیف جدید: '||new.title,new.description,'homework','assignment',new.id,
      'assignment:'||new.id::text||':created');
  end loop;
  return new;
end $$;
drop trigger if exists v7_assignment_notify on public.assignments;
create trigger v7_assignment_notify after insert on public.assignments for each row execute function public.v7_assignment_notify_trigger();

create or replace function public.v7_objection_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='UPDATE' and old.status is distinct from new.status then
    perform public.v7_notify(new.student_id,'objection','پاسخ اعتراض شما',coalesce(new.teacher_response,'وضعیت اعتراض تغییر کرد.'),'objections','objection',new.id,
      'objection:'||new.id::text||':'||new.status);
  end if;
  return new;
end $$;
drop trigger if exists v7_objection_notify on public.objections;
create trigger v7_objection_notify after update of status on public.objections for each row execute function public.v7_objection_notify_trigger();

create or replace function public.v7_score_notify_trigger()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if tg_op='UPDATE' and (
    old.continuous_score is distinct from new.continuous_score or old.final_score is distinct from new.final_score
  ) then
    perform public.v7_notify(new.student_id,'score','نمره شما تغییر کرد','یکی از نمرات ثبت‌شده شما اصلاح شد.','report','score',new.id,
      'score:'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text);
  end if;
  return new;
end $$;
drop trigger if exists v7_score_notify on public.scores;
create trigger v7_score_notify after update on public.scores for each row execute function public.v7_score_notify_trigger();

-- Complete password-change flag after Supabase Auth password update
create or replace function public.complete_initial_password_change()
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
  update public.profiles set must_change_password=false where id=auth.uid();
  return found;
end $$;
grant execute on function public.complete_initial_password_change() to authenticated;

-- Extracurricular enrollment with capacity check
create or replace function public.enroll_extracurricular(p_class uuid)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  c public.extracurricular_classes;
  n int;
  eid uuid;
begin
  if public.current_role()<>'student' or not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  select * into c from public.extracurricular_classes where id=p_class and active;
  if not found then raise exception 'CLASS_NOT_AVAILABLE'; end if;
  if c.registration_start is not null and now()<c.registration_start then raise exception 'REGISTRATION_NOT_STARTED'; end if;
  if c.registration_end is not null and now()>c.registration_end then raise exception 'REGISTRATION_CLOSED'; end if;
  select count(*) into n from public.extracurricular_enrollments where class_id=p_class and status in ('pending','approved');
  if n>=c.capacity then raise exception 'CLASS_FULL'; end if;
  insert into public.extracurricular_enrollments(class_id,student_id,status)
  values(p_class,auth.uid(),'pending')
  on conflict(class_id,student_id) do update set status='pending',updated_at=now()
  returning id into eid;
  return eid;
end $$;
grant execute on function public.enroll_extracurricular(uuid) to authenticated;

-- Appointment booking with overlap/capacity checks
create or replace function public.book_appointment(p_slot uuid,p_subject text,p_description text default null)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  s public.appointment_slots;
  n int;
  aid uuid;
begin
  if not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  select * into s from public.appointment_slots where id=p_slot and active and starts_at>now();
  if not found then raise exception 'SLOT_NOT_AVAILABLE'; end if;
  select count(*) into n from public.appointments where slot_id=p_slot and status in ('pending','approved');
  if n>=s.capacity then raise exception 'SLOT_FULL'; end if;
  if exists(
    select 1 from public.appointments a
    join public.appointment_slots x on x.id=a.slot_id
    where a.requester_id=auth.uid() and a.status in ('pending','approved')
      and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(s.starts_at,s.ends_at,'[)')
  ) then raise exception 'APPOINTMENT_OVERLAP'; end if;
  insert into public.appointments(slot_id,requester_id,subject,description)
  values(p_slot,auth.uid(),trim(p_subject),nullif(trim(p_description),''))
  on conflict(slot_id,requester_id) do update set subject=excluded.subject,description=excluded.description,status='pending',created_at=now()
  returning id into aid;
  return aid;
end $$;
grant execute on function public.book_appointment(uuid,text,text) to authenticated;

-- Anonymous-safe poll voting
create or replace function public.vote_poll(p_poll uuid,p_option uuid)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare
  p public.polls;
  h text;
begin
  if not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  select * into p from public.polls where id=p_poll and active;
  if not found or not public.v7_target_visible(p.target_type,p.target_role,p.target_grade_id,p.target_class_id,p.target_user_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if p.starts_at is not null and now()<p.starts_at then raise exception 'POLL_NOT_STARTED'; end if;
  if p.ends_at is not null and now()>p.ends_at then raise exception 'POLL_CLOSED'; end if;
  if not exists(select 1 from public.poll_options where id=p_option and poll_id=p_poll) then raise exception 'INVALID_OPTION'; end if;
  h:=encode(digest(auth.uid()::text||':'||p_poll::text,'sha256'),'hex');
  insert into public.poll_votes(poll_id,option_id,user_id,voter_hash)
  values(p_poll,p_option,case when p.anonymous then null else auth.uid() end,h);
  return true;
exception when unique_violation then
  raise exception 'ALREADY_VOTED';
end $$;
grant execute on function public.vote_poll(uuid,uuid) to authenticated;

create or replace function public.poll_results(p_poll uuid)
returns table(option_id uuid,option_text text,votes bigint,percent numeric)
language plpgsql security definer set search_path=public
as $$
declare p public.polls; total bigint;
begin
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.is_manager() and not p.show_results then raise exception 'RESULTS_HIDDEN'; end if;
  select count(*) into total from public.poll_votes where poll_id=p_poll;
  return query
    select o.id,o.option_text,count(v.id),
      case when total=0 then 0 else round(count(v.id)::numeric*100/total,1) end
    from public.poll_options o left join public.poll_votes v on v.option_id=o.id
    where o.poll_id=p_poll
    group by o.id,o.option_text,o.sort_order
    order by o.sort_order,o.option_text;
end $$;
grant execute on function public.poll_results(uuid) to authenticated;

-- Student exam flow: no answer key is exposed
create or replace function public.start_exam(p_exam uuid)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare e public.exams; a uuid;
begin
  if public.current_role()<>'student' or not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  select * into e from public.exams where id=p_exam and published;
  if not found or not public.student_in_class(e.class_id) then raise exception 'ACCESS_DENIED'; end if;
  if now()<e.start_at then raise exception 'EXAM_NOT_STARTED'; end if;
  if now()>e.end_at then raise exception 'EXAM_ENDED'; end if;
  insert into public.exam_attempts(exam_id,student_id)
  values(p_exam,auth.uid())
  on conflict(exam_id,student_id) do update set exam_id=excluded.exam_id
  returning id into a;
  return a;
end $$;
grant execute on function public.start_exam(uuid) to authenticated;

create or replace function public.get_exam_for_student(p_exam uuid)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare e public.exams; a public.exam_attempts; deadline timestamptz; questions jsonb;
begin
  if public.current_role()<>'student' or not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  select * into e from public.exams where id=p_exam and published;
  if not found or not public.student_in_class(e.class_id) then raise exception 'ACCESS_DENIED'; end if;
  select * into a from public.exam_attempts where exam_id=p_exam and student_id=auth.uid();
  if not found then raise exception 'EXAM_NOT_STARTED'; end if;
  deadline:=least(e.end_at,a.started_at + make_interval(mins=>e.duration_minutes));
  if a.status='in_progress' and now()>deadline then
    update public.exam_attempts set status='expired',submitted_at=coalesce(submitted_at,now()) where id=a.id;
    a.status:='expired';
  end if;
  if a.status='in_progress' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',q.id,'type',q.question_type,'text',q.question_text,'score',eq.score,'sort_order',eq.sort_order,
        'options',case when q.question_type in ('multiple_choice','true_false') then (
          select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'text',o.option_text,'sort_order',o.sort_order) order by o.sort_order),'[]'::jsonb)
          from public.question_options o where o.question_id=q.id
        ) else '[]'::jsonb end
      ) order by eq.sort_order
    ),'[]'::jsonb) into questions
    from public.exam_questions eq join public.question_bank q on q.id=eq.question_id
    where eq.exam_id=p_exam;
  else
    questions:='[]'::jsonb;
  end if;
  return jsonb_build_object(
    'exam',jsonb_build_object('id',e.id,'title',e.title,'description',e.description,'end_at',e.end_at,'duration_minutes',e.duration_minutes,'max_score',e.max_score),
    'attempt',jsonb_build_object('id',a.id,'status',a.status,'started_at',a.started_at,'submitted_at',a.submitted_at,'total_score',a.total_score,'deadline',deadline),
    'questions',questions
  );
end $$;
grant execute on function public.get_exam_for_student(uuid) to authenticated;

create or replace function public.save_exam_answer(p_attempt uuid,p_question uuid,p_option uuid default null,p_text text default null)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare a public.exam_attempts; e public.exams; deadline timestamptz;
begin
  select * into a from public.exam_attempts where id=p_attempt and student_id=auth.uid();
  if not found or a.status<>'in_progress' then raise exception 'EXAM_CLOSED'; end if;
  select * into e from public.exams where id=a.exam_id;
  deadline:=least(e.end_at,a.started_at + make_interval(mins=>e.duration_minutes));
  if now()>deadline then raise exception 'EXAM_ENDED'; end if;
  if not exists(select 1 from public.exam_questions where exam_id=a.exam_id and question_id=p_question) then raise exception 'INVALID_QUESTION'; end if;
  if p_option is not null and not exists(select 1 from public.question_options where id=p_option and question_id=p_question) then raise exception 'INVALID_OPTION'; end if;
  insert into public.exam_answers(attempt_id,question_id,selected_option_id,answer_text,updated_at)
  values(p_attempt,p_question,p_option,nullif(p_text,''),now())
  on conflict(attempt_id,question_id) do update set selected_option_id=excluded.selected_option_id,answer_text=excluded.answer_text,updated_at=now();
  return true;
end $$;
grant execute on function public.save_exam_answer(uuid,uuid,uuid,text) to authenticated;

create or replace function public.submit_exam_attempt(p_attempt uuid)
returns numeric
language plpgsql security definer set search_path=public
as $$
declare a public.exam_attempts; auto_total numeric:=0;
begin
  select * into a from public.exam_attempts where id=p_attempt and student_id=auth.uid();
  if not found or a.status<>'in_progress' then raise exception 'EXAM_CLOSED'; end if;
  select coalesce(sum(eq.score),0) into auto_total
  from public.exam_answers ans
  join public.exam_questions eq on eq.exam_id=a.exam_id and eq.question_id=ans.question_id
  join public.question_bank q on q.id=ans.question_id
  join public.question_options o on o.id=ans.selected_option_id and o.question_id=q.id
  where ans.attempt_id=p_attempt and q.question_type in ('multiple_choice','true_false') and o.is_correct;
  update public.exam_attempts
  set auto_score=auto_total,total_score=auto_total+manual_score,status='submitted',submitted_at=now()
  where id=p_attempt;
  return auto_total;
end $$;
grant execute on function public.submit_exam_attempt(uuid) to authenticated;

create or replace function public.recalculate_exam_attempt(p_attempt uuid)
returns numeric
language plpgsql security definer set search_path=public
as $$
declare a public.exam_attempts; e public.exams; auto_total numeric:=0; manual_total numeric:=0;
begin
  select * into a from public.exam_attempts where id=p_attempt;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into e from public.exams where id=a.exam_id;
  if not (public.is_manager() or e.teacher_id=auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  select coalesce(sum(eq.score),0) into auto_total
  from public.exam_answers ans
  join public.exam_questions eq on eq.exam_id=a.exam_id and eq.question_id=ans.question_id
  join public.question_bank q on q.id=ans.question_id
  join public.question_options o on o.id=ans.selected_option_id and o.question_id=q.id
  where ans.attempt_id=p_attempt and q.question_type in ('multiple_choice','true_false') and o.is_correct;
  select coalesce(sum(coalesce(ans.awarded_score,0)),0) into manual_total
  from public.exam_answers ans join public.question_bank q on q.id=ans.question_id
  where ans.attempt_id=p_attempt and q.question_type in ('short_answer','essay');
  update public.exam_attempts set auto_score=auto_total,manual_score=manual_total,total_score=auto_total+manual_total,
    status=case when status='submitted' then 'graded' else status end
  where id=p_attempt;
  return auto_total+manual_total;
end $$;
grant execute on function public.recalculate_exam_attempt(uuid) to authenticated;

-- Calendar feed merges manual events, assignments, exams, approved appointments and extracurricular sessions.
create or replace function public.get_calendar_feed(p_from timestamptz,p_to timestamptz)
returns table(id text,title text,start_at timestamptz,end_at timestamptz,event_type text,route text)
language plpgsql security definer set search_path=public
as $$
begin
  if not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  return query
  select 'event:'||c.id::text,c.title,c.start_at,c.end_at,c.event_type,'calendar'
  from public.calendar_events c
  where c.start_at between p_from and p_to
    and public.v7_target_visible(c.target_type,c.target_role,c.target_grade_id,c.target_class_id,c.target_user_id)
  union all
  select 'assignment:'||a.id::text,'تکلیف: '||a.title,a.due_at,a.due_at,'assignment','homework'
  from public.assignments a
  where a.due_at between p_from and p_to and (
    public.is_manager() or a.teacher_id=auth.uid() or public.student_can_access_assignment(a.id)
  )
  union all
  select 'exam:'||e.id::text,'آزمون: '||e.title,e.start_at,e.end_at,'exam','exams'
  from public.exams e
  where e.start_at between p_from and p_to and (
    public.is_manager() or e.teacher_id=auth.uid() or (e.published and public.student_in_class(e.class_id))
  )
  union all
  select 'appointment:'||a.id::text,'ملاقات: '||a.subject,s.starts_at,s.ends_at,'appointment','appointments'
  from public.appointments a join public.appointment_slots s on s.id=a.slot_id
  where a.status='approved' and s.starts_at between p_from and p_to
    and (public.is_manager() or a.requester_id=auth.uid() or s.staff_id=auth.uid())
  union all
  select 'extra:'||x.id::text,'فوق‌برنامه: '||c.title,x.starts_at,x.ends_at,'extracurricular','extracurricular'
  from public.extracurricular_sessions x join public.extracurricular_classes c on c.id=x.class_id
  where x.starts_at between p_from and p_to and (
    public.is_manager() or c.teacher_id=auth.uid() or exists(
      select 1 from public.extracurricular_enrollments ee where ee.class_id=c.id and ee.student_id=auth.uid() and ee.status='approved'
    )
  )
  order by start_at;
end $$;
grant execute on function public.get_calendar_feed(timestamptz,timestamptz) to authenticated;

-- Due reminders are created lazily when a signed-in user opens the app.
create or replace function public.refresh_due_notifications()
returns int
language plpgsql security definer set search_path=public
as $$
declare n int:=0; r record;
begin
  if not public.v7_account_ready() then return 0; end if;
  if public.current_role()='student' then
    for r in
      select a.id,a.title,a.due_at from public.assignments a
      where a.due_at between now() and now()+interval '24 hours' and public.student_can_access_assignment(a.id)
    loop
      perform public.v7_notify(auth.uid(),'assignment_reminder','مهلت تکلیف نزدیک است',r.title,'homework','assignment',r.id,'assignment:'||r.id::text||':24h');
      n:=n+1;
    end loop;
    for r in
      select e.id,e.title,e.start_at from public.exams e
      where e.published and e.start_at between now() and now()+interval '24 hours' and public.student_in_class(e.class_id)
    loop
      perform public.v7_notify(auth.uid(),'exam_reminder','آزمون نزدیک است',r.title,'exams','exam',r.id,'exam:'||r.id::text||':24h');
      n:=n+1;
    end loop;
  end if;
  return n;
end $$;
grant execute on function public.refresh_due_notifications() to authenticated;

-- Dashboard summary
create or replace function public.get_v7_dashboard()
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare result jsonb;
begin
  if not public.v7_account_ready() then raise exception 'ACCESS_DENIED'; end if;
  if public.is_manager() then
    select jsonb_build_object(
      'students',(select count(*) from public.profiles where role='student' and active),
      'teachers',(select count(*) from public.profiles where role='teacher' and active),
      'classes',(select count(*) from public.classes),
      'absent_today',(select count(*) from public.attendance_records where attendance_date=current_date and status in ('absent','unexcused','excused')),
      'upcoming_exams',(select count(*) from public.exams where published and start_at between now() and now()+interval '7 days'),
      'active_forms',(select count(*) from public.forms where active and (closes_at is null or closes_at>=now())),
      'pending_appointments',(select count(*) from public.appointments where status='pending')
    ) into result;
  elsif public.current_role()='teacher' then
    select jsonb_build_object(
      'teaching',(select count(*) from public.teacher_assignments where teacher_id=auth.uid()),
      'upcoming_exams',(select count(*) from public.exams where teacher_id=auth.uid() and start_at>=now()),
      'pending_appointments',(select count(*) from public.appointments a join public.appointment_slots s on s.id=a.slot_id where s.staff_id=auth.uid() and a.status='pending'),
      'today_periods',(select count(*) from public.timetable_entries t where t.teacher_id=auth.uid() and t.weekday=((extract(dow from now())::int+1)%7))
    ) into result;
  else
    select jsonb_build_object(
      'absences',(select count(*) from public.attendance_records where student_id=auth.uid() and status in ('absent','unexcused','excused')),
      'unread_notifications',(select count(*) from public.notifications where user_id=auth.uid() and read_at is null),
      'upcoming_exams',(select count(*) from public.exams where published and start_at between now() and now()+interval '7 days' and public.student_in_class(class_id)),
      'active_forms',(select count(*) from public.forms f where f.active and public.v7_target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id))
    ) into result;
  end if;
  return result;
end $$;
grant execute on function public.get_v7_dashboard() to authenticated;

-- Search respects role visibility.
create or replace function public.global_search(p_query text)
returns table(category text,id uuid,title text,subtitle text,route text)
language plpgsql security definer set search_path=public
as $$
declare q text:='%'||trim(p_query)||'%';
begin
  if length(trim(p_query))<2 or not public.v7_account_ready() then return; end if;

  if public.is_manager() then
    return query
      select 'student',p.id,p.full_name,p.national_id,'studentProfile' from public.profiles p where p.role='student' and (p.full_name ilike q or p.national_id ilike q) limit 8;
    return query
      select 'teacher',p.id,p.full_name,p.national_id,'users' from public.profiles p where p.role='teacher' and (p.full_name ilike q or p.national_id ilike q) limit 8;
  elsif public.current_role()='teacher' then
    return query
      select distinct 'student',p.id,p.full_name,p.national_id,'studentProfile'
      from public.profiles p join public.class_students cs on cs.student_id=p.id
      where exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=cs.class_id)
        and (p.full_name ilike q or p.national_id ilike q) limit 8;
  end if;

  return query
    select 'class',c.id,c.title,c.academic_year,'timetable'
    from public.classes c
    where c.title ilike q and (
      public.is_manager() or public.student_in_class(c.id) or public.v7_teacher_has_class(c.id)
    ) limit 6;

  return query
    select 'subject',s.id,s.title,g.title,'scores'
    from public.subjects s join public.grade_levels g on g.id=s.grade_id
    where s.title ilike q limit 6;

  return query
    select 'assignment',a.id,a.title,coalesce(a.description,''),'homework'
    from public.assignments a
    where a.title ilike q and (
      public.is_manager() or a.teacher_id=auth.uid() or public.student_can_access_assignment(a.id)
    ) limit 6;

  return query
    select 'exam',e.id,e.title,coalesce(e.description,''),'exams'
    from public.exams e
    where e.title ilike q and (
      public.is_manager() or e.teacher_id=auth.uid() or (e.published and public.student_in_class(e.class_id))
    ) limit 6;

  return query
    select 'form',f.id,f.title,coalesce(f.description,''),'forms'
    from public.forms f
    where f.title ilike q and (public.is_manager() or (f.active and public.v7_target_visible(f.target_type,f.target_role,f.target_grade_id,f.target_class_id,f.target_user_id)))
    limit 6;
end $$;
grant execute on function public.global_search(text) to authenticated;

-- Grants for direct browser access. RLS still applies.
grant select,insert,update,delete on
  public.school_periods,public.timetable_entries,public.attendance_records,
  public.behavior_categories,public.behavior_events,public.question_bank,public.question_options,
  public.exams,public.exam_questions,public.exam_attempts,public.exam_answers,
  public.calendar_events,public.notifications,public.forms,public.form_fields,
  public.form_submissions,public.form_answers,public.polls,public.poll_options,public.poll_votes,
  public.extracurricular_classes,public.extracurricular_sessions,public.extracurricular_enrollments,
  public.appointment_slots,public.appointments,public.audit_logs
to authenticated;

-- Anonymous/authenticated clients need sequence access for audit identity only through trigger;
-- direct insert remains blocked by RLS.
grant usage,select on sequence public.audit_logs_id_seq to authenticated;
