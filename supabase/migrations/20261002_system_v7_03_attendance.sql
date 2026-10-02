-- v7 / مرحله ۳: حضور و غیاب حرفه‌ای
set role postgres;

do $$ begin
  create type public.attendance_status as enum (
    'present','absent','excused_absence','unexcused_absence','late','early_leave'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  schedule_entry_id uuid references public.timetable_entries(id) on delete set null,
  attendance_date date not null,
  status public.attendance_status not null default 'present',
  delay_minutes integer not null default 0 check(delay_minutes between 0 and 600),
  note text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (status in ('late','early_leave') and delay_minutes >= 0)
    or (status not in ('late','early_leave') and delay_minutes = 0)
  )
);

create unique index if not exists uq_attendance_student_session
  on public.attendance_records(
    student_id,class_id,attendance_date,
    coalesce(schedule_entry_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_attendance_class_date
  on public.attendance_records(class_id,attendance_date desc);
create index if not exists idx_attendance_student_date
  on public.attendance_records(student_id,attendance_date desc);
create index if not exists idx_attendance_status_date
  on public.attendance_records(status,attendance_date desc);

drop trigger if exists trg_attendance_updated_at on public.attendance_records;
create trigger trg_attendance_updated_at
before update on public.attendance_records
for each row execute function public.touch_updated_at();

alter table public.attendance_records enable row level security;

drop policy if exists attendance_read on public.attendance_records;
create policy attendance_read on public.attendance_records
for select to authenticated
using(
  public.password_change_complete()
  and (
    public.is_manager()
    or student_id=auth.uid()
    or public.teacher_has_access(class_id,subject_id)
  )
);

drop policy if exists attendance_manager_write on public.attendance_records;
create policy attendance_manager_write on public.attendance_records
for all to authenticated
using(public.is_manager())
with check(public.is_manager());

-- دبیر برای کلاس/درس خودش می‌تواند رکورد را اصلاح کند.
drop policy if exists attendance_teacher_update on public.attendance_records;
create policy attendance_teacher_update on public.attendance_records
for update to authenticated
using(public.teacher_has_access(class_id,subject_id))
with check(
  public.teacher_has_access(class_id,subject_id)
  and recorded_by=auth.uid()
);

create or replace function public.save_attendance_bulk(
  p_class uuid,
  p_subject uuid,
  p_schedule uuid,
  p_date date,
  p_records jsonb
) returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  item jsonb;
  sid uuid;
  st public.attendance_status;
  mins integer;
  note_text text;
  affected integer:=0;
begin
  if not (
    public.is_manager()
    or public.teacher_has_access(p_class,p_subject)
  ) then raise exception 'ACCESS_DENIED'; end if;

  if p_date is null then raise exception 'INVALID_ATTENDANCE_DATE'; end if;
  if jsonb_typeof(p_records)<>'array' then raise exception 'INVALID_DATA'; end if;

  if p_schedule is not null and not exists(
    select 1 from public.timetable_entries t
    where t.id=p_schedule and t.class_id=p_class and t.subject_id=p_subject
      and (public.is_manager() or t.teacher_id=auth.uid())
  ) then
    raise exception 'INVALID_SCHEDULE_ENTRY';
  end if;

  for item in select value from jsonb_array_elements(p_records)
  loop
    sid := (item->>'student_id')::uuid;
    st := coalesce((item->>'status')::public.attendance_status,'present');
    mins := coalesce((item->>'delay_minutes')::integer,0);
    note_text := nullif(trim(item->>'note'),'');

    if not exists(
      select 1 from public.class_students cs
      where cs.class_id=p_class and cs.student_id=sid
    ) then
      raise exception 'STUDENT_NOT_IN_CLASS';
    end if;

    if st not in ('late','early_leave') then mins:=0; end if;
    if mins<0 or mins>600 then raise exception 'INVALID_DELAY_MINUTES'; end if;

    insert into public.attendance_records(
      student_id,class_id,subject_id,schedule_entry_id,attendance_date,
      status,delay_minutes,note,recorded_by
    ) values(
      sid,p_class,p_subject,p_schedule,p_date,st,mins,note_text,auth.uid()
    )
    on conflict(
      student_id,class_id,attendance_date,
      (coalesce(schedule_entry_id,'00000000-0000-0000-0000-000000000000'::uuid)),
      (coalesce(subject_id,'00000000-0000-0000-0000-000000000000'::uuid))
    )
    do update set
      status=excluded.status,
      delay_minutes=excluded.delay_minutes,
      note=excluded.note,
      recorded_by=auth.uid(),
      updated_at=now();

    affected:=affected+1;
  end loop;

  return affected;
end
$$;

create or replace function public.attendance_summary(
  p_from date,
  p_to date,
  p_class uuid default null
) returns table(
  student_id uuid,
  present_count bigint,
  absent_count bigint,
  excused_count bigint,
  unexcused_count bigint,
  late_count bigint,
  early_leave_count bigint,
  delay_minutes bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    a.student_id,
    count(*) filter(where a.status='present') as present_count,
    count(*) filter(where a.status='absent') as absent_count,
    count(*) filter(where a.status='excused_absence') as excused_count,
    count(*) filter(where a.status='unexcused_absence') as unexcused_count,
    count(*) filter(where a.status='late') as late_count,
    count(*) filter(where a.status='early_leave') as early_leave_count,
    coalesce(sum(a.delay_minutes),0)::bigint as delay_minutes
  from public.attendance_records a
  where a.attendance_date between p_from and p_to
    and (p_class is null or a.class_id=p_class)
  group by a.student_id
$$;

grant select on public.attendance_records to authenticated;
grant update on public.attendance_records to authenticated;
grant execute on function public.save_attendance_bulk(uuid,uuid,uuid,date,jsonb) to authenticated;
grant execute on function public.attendance_summary(date,date,uuid) to authenticated;

select public.attach_audit_trigger('public.attendance_records'::regclass);

select
  has_table_privilege('authenticated','public.attendance_records','SELECT') as attendance_select,
  has_function_privilege('authenticated','public.save_attendance_bulk(uuid,uuid,uuid,date,jsonb)','EXECUTE') as attendance_bulk_exec;
