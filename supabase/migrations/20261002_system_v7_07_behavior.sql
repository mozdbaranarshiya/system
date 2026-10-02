-- v7 / مرحله ۷: رفتار، تشویق و انضباط پیشرفته
set role postgres;

create table if not exists public.behavior_categories (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  default_event_type text not null default 'neutral' check(default_event_type in ('positive','negative','neutral')),
  default_points integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
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
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_behavior_student_date on public.behavior_events(student_id,event_date desc);
create index if not exists idx_behavior_class_date on public.behavior_events(class_id,event_date desc);
create index if not exists idx_behavior_type on public.behavior_events(event_type,event_date desc);

insert into public.behavior_categories(title,default_event_type,default_points)
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

alter table public.behavior_categories enable row level security;
alter table public.behavior_events enable row level security;

drop policy if exists behavior_categories_read on public.behavior_categories;
create policy behavior_categories_read on public.behavior_categories
for select to authenticated
using(public.password_change_complete() and active);

drop policy if exists behavior_categories_manager on public.behavior_categories;
create policy behavior_categories_manager on public.behavior_categories
for all to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists behavior_events_read on public.behavior_events;
create policy behavior_events_read on public.behavior_events
for select to authenticated
using(
  public.password_change_complete()
  and (
    public.is_manager()
    or student_id=auth.uid()
    or exists(
      select 1 from public.teacher_assignments ta
      where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id
    )
  )
);

drop policy if exists behavior_events_staff_insert on public.behavior_events;
create policy behavior_events_staff_insert on public.behavior_events
for insert to authenticated
with check(
  public.is_manager()
  or (
    recorded_by=auth.uid()
    and exists(
      select 1 from public.teacher_assignments ta
      where ta.teacher_id=auth.uid() and ta.class_id=behavior_events.class_id
    )
  )
);

drop policy if exists behavior_events_manager_update on public.behavior_events;
create policy behavior_events_manager_update on public.behavior_events
for update to authenticated using(public.is_manager()) with check(public.is_manager());

drop policy if exists behavior_events_manager_delete on public.behavior_events;
create policy behavior_events_manager_delete on public.behavior_events
for delete to authenticated using(public.is_manager());

grant select on public.behavior_categories,public.behavior_events to authenticated;
grant insert on public.behavior_events to authenticated;
grant insert,update,delete on public.behavior_categories to authenticated;
grant update,delete on public.behavior_events to authenticated;

select public.attach_audit_trigger('public.behavior_events'::regclass);
