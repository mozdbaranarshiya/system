-- v8 / 02: Weekly timetable, attendance, educational calendar and notification center
set role postgres;

create table if not exists public.school_periods (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_order integer not null check(period_order>0),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_periods_time_check check(end_time>start_time),
  constraint school_periods_order_unique unique(period_order)
);

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  weekday smallint not null check(weekday between 0 and 5),
  period_id uuid not null references public.school_periods(id) on delete restrict,
  academic_year text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_class_slot_unique unique(class_id,weekday,period_id,academic_year),
  constraint timetable_teacher_slot_unique unique(teacher_id,weekday,period_id,academic_year)
);

create index if not exists idx_timetable_teacher on public.timetable_entries(teacher_id,weekday,period_id);
create index if not exists idx_timetable_class on public.timetable_entries(class_id,weekday,period_id);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  schedule_entry_id uuid not null references public.timetable_entries(id) on delete cascade,
  attendance_date date not null default current_date,
  status text not null check(status in (
    'present','absent','excused_absent','unexcused_absent','late','early_leave'
  )),
  delay_minutes integer not null default 0 check(delay_minutes between 0 and 600),
  note text,
  recorded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_one_per_session unique(student_id,schedule_entry_id,attendance_date),
  constraint attendance_delay_check check(
    (status in ('late','early_leave') and delay_minutes>=0)
    or (status not in ('late','early_leave') and delay_minutes=0)
  )
);

create index if not exists idx_attendance_student_date on public.attendance_records(student_id,attendance_date desc);
create index if not exists idx_attendance_class_date on public.attendance_records(class_id,attendance_date desc);
create index if not exists idx_attendance_status_date on public.attendance_records(status,attendance_date desc);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null check(event_type in (
    'exam','holiday','parent_meeting','trip','competition','cultural','school_meeting','deadline','other'
  )),
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_time_check check(end_at is null or end_at>=start_at),
  constraint calendar_target_check check(
    target_type='all'
    or (target_type='role' and target_role is not null)
    or (target_type='grade' and target_grade_id is not null)
    or (target_type='class' and target_class_id is not null)
    or (target_type='user' and target_user_id is not null)
  )
);

create index if not exists idx_calendar_events_start on public.calendar_events(start_at);
create index if not exists idx_calendar_events_target_class on public.calendar_events(target_class_id,start_at);

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

create unique index if not exists idx_notifications_dedupe
  on public.notifications(user_id,dedupe_key)
  where dedupe_key is not null;
create index if not exists idx_notifications_unread
  on public.notifications(user_id,created_at desc)
  where read_at is null;

alter table public.school_periods enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.attendance_records enable row level security;
alter table public.calendar_events enable row level security;
alter table public.notifications enable row level security;

-- Shared visibility helper. SECURITY DEFINER prevents policy recursion while still
-- returning only role-relevant class membership.
create or replace function public.can_read_class(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or exists(select 1 from public.class_students cs where cs.class_id=p_class and cs.student_id=auth.uid())
    or exists(select 1 from public.teacher_assignments ta where ta.class_id=p_class and ta.teacher_id=auth.uid())
$$;

create or replace function public.can_teach_class_subject(p_class uuid,p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or exists(
      select 1 from public.teacher_assignments ta
      where ta.class_id=p_class and ta.subject_id=p_subject and ta.teacher_id=auth.uid()
    )
$$;

grant execute on function public.can_read_class(uuid) to authenticated;
grant execute on function public.can_teach_class_subject(uuid,uuid) to authenticated;

drop policy if exists school_periods_read on public.school_periods;
create policy school_periods_read on public.school_periods for select to authenticated using(true);
drop policy if exists school_periods_manager on public.school_periods;
create policy school_periods_manager on public.school_periods for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists timetable_read on public.timetable_entries;
create policy timetable_read on public.timetable_entries for select to authenticated
using(
  public.is_manager()
  or teacher_id=auth.uid()
  or public.student_in_class(class_id)
);
drop policy if exists timetable_manager on public.timetable_entries;
create policy timetable_manager on public.timetable_entries for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records for select to authenticated
using(
  public.is_manager()
  or student_id=auth.uid()
  or public.teacher_has_access(class_id,subject_id)
);
drop policy if exists attendance_manager on public.attendance_records;
create policy attendance_manager on public.attendance_records for all to authenticated
using(public.is_manager()) with check(public.is_manager());

create or replace function public.save_attendance_batch(
  p_schedule uuid,
  p_date date,
  p_records jsonb
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  t public.timetable_entries;
  item jsonb;
  sid uuid;
  st text;
  mins integer;
  n text;
  saved integer:=0;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into t from public.timetable_entries where id=p_schedule;
  if not found then raise exception 'SCHEDULE_NOT_FOUND'; end if;
  if not public.can_teach_class_subject(t.class_id,t.subject_id) then
    raise exception 'ACCESS_DENIED';
  end if;
  if jsonb_typeof(p_records)<>'array' then raise exception 'INVALID_DATA'; end if;

  for item in select value from jsonb_array_elements(p_records)
  loop
    sid:=(item->>'student_id')::uuid;
    st:=coalesce(item->>'status','present');
    mins:=greatest(0,coalesce((item->>'delay_minutes')::integer,0));
    n:=nullif(trim(item->>'note'),'');

    if st not in ('present','absent','excused_absent','unexcused_absent','late','early_leave') then
      raise exception 'INVALID_ATTENDANCE_STATUS';
    end if;
    if st not in ('late','early_leave') then mins:=0; end if;
    if not exists(
      select 1 from public.class_students cs
      where cs.class_id=t.class_id and cs.student_id=sid
    ) then
      raise exception 'STUDENT_NOT_IN_CLASS';
    end if;

    insert into public.attendance_records(
      student_id,class_id,subject_id,schedule_entry_id,attendance_date,
      status,delay_minutes,note,recorded_by,updated_at
    ) values(
      sid,t.class_id,t.subject_id,t.id,p_date,st,mins,n,auth.uid(),now()
    )
    on conflict(student_id,schedule_entry_id,attendance_date)
    do update set
      status=excluded.status,
      delay_minutes=excluded.delay_minutes,
      note=excluded.note,
      recorded_by=auth.uid(),
      updated_at=now();

    saved:=saved+1;
  end loop;
  return saved;
end
$$;
grant execute on function public.save_attendance_batch(uuid,date,jsonb) to authenticated;

create or replace function public.calendar_event_visible(
  p_target_type text,
  p_role public.user_role,
  p_grade uuid,
  p_class uuid,
  p_user uuid
) returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_manager()
    or p_target_type='all'
    or (p_target_type='role' and p_role=public.current_role())
    or (p_target_type='user' and p_user=auth.uid())
    or (
      p_target_type='class' and (
        exists(select 1 from public.class_students cs where cs.student_id=auth.uid() and cs.class_id=p_class)
        or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=p_class)
      )
    )
    or (
      p_target_type='grade' and (
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
      )
    )
$$;
grant execute on function public.calendar_event_visible(text,public.user_role,uuid,uuid,uuid) to authenticated;

drop policy if exists calendar_events_read on public.calendar_events;
create policy calendar_events_read on public.calendar_events for select to authenticated
using(public.calendar_event_visible(target_type,target_role,target_grade_id,target_class_id,target_user_id));
drop policy if exists calendar_events_manager on public.calendar_events;
create policy calendar_events_manager on public.calendar_events for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
using(user_id=auth.uid());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());

revoke insert, delete on public.notifications from authenticated;
grant select,update on public.notifications to authenticated;

create or replace function public.notify_user(
  p_user uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_dedupe_key text default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
  values(p_user,p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_dedupe_key)
  on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
end
$$;
revoke all on function public.notify_user(uuid,text,text,text,text,text,uuid,text) from public;
grant execute on function public.notify_user(uuid,text,text,text,text,text,uuid,text) to postgres,service_role;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare n integer;
begin
  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=auth.uid() and read_at is null;
  get diagnostics n=row_count;
  return n;
end
$$;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- Automatic notification triggers for existing v6 entities.
create or replace function public.notify_assignment_created()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare sid uuid;
begin
  if new.group_id is null then
    for sid in select cs.student_id from public.class_students cs where cs.class_id=new.class_id
    loop
      perform public.notify_user(
        sid,'homework_new','تکلیف جدید',new.title,'homework',
        'assignment',new.id,'homework:new:'||new.id::text
      );
    end loop;
  else
    for sid in select gm.student_id from public.student_group_members gm where gm.group_id=new.group_id
    loop
      perform public.notify_user(
        sid,'homework_new','تکلیف جدید',new.title,'homework',
        'assignment',new.id,'homework:new:'||new.id::text
      );
    end loop;
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_assignment_created on public.assignments;
create trigger trg_notify_assignment_created
after insert on public.assignments
for each row execute function public.notify_assignment_created();

create or replace function public.notify_score_changed()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT'
     or old.continuous_score is distinct from new.continuous_score
     or old.final_score is distinct from new.final_score then
    perform public.notify_user(
      new.student_id,'score_changed','نمره شما به‌روزرسانی شد',
      null,'report','score',new.id,
      'score:'||new.id::text||':'||extract(epoch from new.updated_at)::bigint::text
    );
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_score_changed on public.scores;
create trigger trg_notify_score_changed
after insert or update on public.scores
for each row execute function public.notify_score_changed();

create or replace function public.notify_attendance_changed()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status<>'present' then
    perform public.notify_user(
      new.student_id,'attendance','وضعیت حضور و غیاب ثبت شد',
      case new.status
        when 'late' then 'تأخیر'
        when 'early_leave' then 'خروج زودهنگام'
        when 'excused_absent' then 'غیبت موجه'
        when 'unexcused_absent' then 'غیبت غیرموجه'
        else 'غیبت'
      end,
      'attendance','attendance',new.id,
      'attendance:'||new.id::text||':'||new.updated_at::text
    );
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_attendance_changed on public.attendance_records;
create trigger trg_notify_attendance_changed
after insert or update on public.attendance_records
for each row execute function public.notify_attendance_changed();

create or replace function public.notify_objection_status()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='UPDATE' and old.status is distinct from new.status then
    perform public.notify_user(
      new.student_id,'objection','اعتراض شما بررسی شد',
      coalesce(new.response,'وضعیت اعتراض تغییر کرد.'),'objections',
      'objection',new.id,'objection:'||new.id::text||':'||new.status::text
    );
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_objection_status on public.objections;
create trigger trg_notify_objection_status
after update on public.objections
for each row execute function public.notify_objection_status();

select public.attach_audit_trigger(x)
from unnest(array['timetable_entries','attendance_records']) as x;
