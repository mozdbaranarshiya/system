-- v7 / مرحله ۲: برنامه هفتگی و زنگ‌های مدرسه
set role postgres;

create table if not exists public.school_periods (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  period_order integer not null check(period_order > 0),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_order),
  check(end_time > start_time)
);

create table if not exists public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check(weekday between 0 and 5),
  period_id uuid not null references public.school_periods(id) on delete restrict,
  academic_year text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(class_id,weekday,period_id,academic_year),
  unique(teacher_id,weekday,period_id,academic_year)
);

create index if not exists idx_timetable_class_day
  on public.timetable_entries(class_id,weekday,period_id);
create index if not exists idx_timetable_teacher_day
  on public.timetable_entries(teacher_id,weekday,period_id);
create index if not exists idx_timetable_year
  on public.timetable_entries(academic_year);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end
$$;

drop trigger if exists trg_periods_updated_at on public.school_periods;
create trigger trg_periods_updated_at
before update on public.school_periods
for each row execute function public.touch_updated_at();

drop trigger if exists trg_timetable_updated_at on public.timetable_entries;
create trigger trg_timetable_updated_at
before update on public.timetable_entries
for each row execute function public.touch_updated_at();

alter table public.school_periods enable row level security;
alter table public.timetable_entries enable row level security;

drop policy if exists periods_read on public.school_periods;
create policy periods_read on public.school_periods
for select to authenticated
using(public.password_change_complete());

drop policy if exists periods_manager_write on public.school_periods;
create policy periods_manager_write on public.school_periods
for all to authenticated
using(public.is_manager())
with check(public.is_manager());

drop policy if exists timetable_read on public.timetable_entries;
create policy timetable_read on public.timetable_entries
for select to authenticated
using(
  public.password_change_complete()
  and (
    public.is_manager()
    or teacher_id=auth.uid()
    or public.student_in_class(class_id)
  )
);

drop policy if exists timetable_manager_write on public.timetable_entries;
create policy timetable_manager_write on public.timetable_entries
for all to authenticated
using(public.is_manager())
with check(public.is_manager());

create or replace function public.save_timetable_entry(
  p_id uuid,
  p_class uuid,
  p_subject uuid,
  p_teacher uuid,
  p_weekday smallint,
  p_period uuid,
  p_academic_year text
) returns public.timetable_entries
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.timetable_entries;
begin
  if not public.is_manager() then raise exception 'MANAGER_ONLY'; end if;
  if p_weekday < 0 or p_weekday > 5 then raise exception 'INVALID_WEEKDAY'; end if;
  if coalesce(trim(p_academic_year),'')='' then raise exception 'INVALID_ACADEMIC_YEAR'; end if;

  if not exists(
    select 1 from public.teacher_assignments ta
    where ta.teacher_id=p_teacher and ta.class_id=p_class and ta.subject_id=p_subject
  ) then
    raise exception 'TEACHER_NOT_ASSIGNED';
  end if;

  if exists(
    select 1 from public.timetable_entries t
    where t.class_id=p_class
      and t.weekday=p_weekday
      and t.period_id=p_period
      and t.academic_year=p_academic_year
      and (p_id is null or t.id<>p_id)
  ) then
    raise exception 'TIMETABLE_CLASS_CONFLICT';
  end if;

  if exists(
    select 1 from public.timetable_entries t
    where t.teacher_id=p_teacher
      and t.weekday=p_weekday
      and t.period_id=p_period
      and t.academic_year=p_academic_year
      and (p_id is null or t.id<>p_id)
  ) then
    raise exception 'TIMETABLE_TEACHER_CONFLICT';
  end if;

  if p_id is null then
    insert into public.timetable_entries(
      class_id,subject_id,teacher_id,weekday,period_id,academic_year
    ) values(
      p_class,p_subject,p_teacher,p_weekday,p_period,p_academic_year
    )
    returning * into result;
  else
    update public.timetable_entries
    set class_id=p_class,
        subject_id=p_subject,
        teacher_id=p_teacher,
        weekday=p_weekday,
        period_id=p_period,
        academic_year=p_academic_year
    where id=p_id
    returning * into result;

    if not found then raise exception 'TIMETABLE_NOT_FOUND'; end if;
  end if;

  return result;
end
$$;

grant select on public.school_periods,public.timetable_entries to authenticated;
grant insert,update,delete on public.school_periods,public.timetable_entries to authenticated;
grant execute on function public.save_timetable_entry(uuid,uuid,uuid,uuid,smallint,uuid,text) to authenticated;

select public.attach_audit_trigger('public.timetable_entries'::regclass);

select
  has_table_privilege('authenticated','public.timetable_entries','SELECT') as timetable_select,
  has_function_privilege('authenticated','public.save_timetable_entry(uuid,uuid,uuid,uuid,smallint,uuid,text)','EXECUTE') as timetable_save_exec;
