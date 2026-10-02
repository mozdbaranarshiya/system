-- v7 / مرحله ۴: تقویم آموزشی و رویدادها
set role postgres;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null check(event_type in (
    'exam','holiday','parents_meeting','trip','competition','cultural',
    'school_meeting','deadline','other'
  )),
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  target_type text not null check(target_type in ('all','role','grade','class','user')),
  target_role public.user_role,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at is null or end_at>=start_at),
  check(
    target_type='all'
    or (target_type='role' and target_role is not null)
    or (target_type='grade' and target_grade_id is not null)
    or (target_type='class' and target_class_id is not null)
    or (target_type='user' and target_user_id is not null)
  )
);

create index if not exists idx_calendar_events_start on public.calendar_events(start_at);
create index if not exists idx_calendar_events_target_class on public.calendar_events(target_class_id) where target_class_id is not null;
create index if not exists idx_calendar_events_target_user on public.calendar_events(target_user_id) where target_user_id is not null;

drop trigger if exists trg_calendar_events_updated_at on public.calendar_events;
create trigger trg_calendar_events_updated_at
before update on public.calendar_events
for each row execute function public.touch_updated_at();

alter table public.calendar_events enable row level security;

create or replace function public.can_read_calendar_event(
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
  select
    public.is_manager()
    or p_target_type='all'
    or (p_target_type='role' and p_role=public.current_role())
    or (p_target_type='user' and p_user=auth.uid())
    or (
      p_target_type='class'
      and (
        public.student_in_class(p_class)
        or exists(select 1 from public.teacher_assignments ta where ta.teacher_id=auth.uid() and ta.class_id=p_class)
      )
    )
    or (
      p_target_type='grade'
      and (
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

grant execute on function public.can_read_calendar_event(text,public.user_role,uuid,uuid,uuid) to authenticated;

drop policy if exists calendar_events_read on public.calendar_events;
create policy calendar_events_read on public.calendar_events
for select to authenticated
using(
  public.password_change_complete()
  and public.can_read_calendar_event(target_type,target_role,target_grade_id,target_class_id,target_user_id)
);

drop policy if exists calendar_events_manager_write on public.calendar_events;
create policy calendar_events_manager_write on public.calendar_events
for all to authenticated
using(public.is_manager())
with check(public.is_manager() and created_by=auth.uid());

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
    'assignment'::text,a.id,a.title,a.description,a.due_at,a.due_at,false,'homework'::text,
    a.class_id,a.subject_id
  from public.assignments a
  where a.due_at between p_from and p_to
$$;

grant select,insert,update,delete on public.calendar_events to authenticated;
grant execute on function public.calendar_feed(timestamptz,timestamptz) to authenticated;

select public.attach_audit_trigger('public.calendar_events'::regclass);
