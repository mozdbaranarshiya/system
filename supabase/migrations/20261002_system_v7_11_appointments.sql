-- v7 / مرحله ۱۱: نوبت‌دهی ملاقات
set role postgres;

create table if not exists public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  location text,
  capacity integer not null default 1 check(capacity>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check(end_time>start_time)
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
  reviewed_by uuid references public.profiles(id),
  unique(slot_id,requester_id)
);

create index if not exists idx_appointment_slots_staff_date on public.appointment_slots(staff_id,date,start_time);
create index if not exists idx_appointment_slots_active_date on public.appointment_slots(active,date);
create index if not exists idx_appointments_requester on public.appointments(requester_id,status,created_at desc);
create index if not exists idx_appointments_slot on public.appointments(slot_id,status);

alter table public.appointment_slots enable row level security;
alter table public.appointments enable row level security;

drop policy if exists appointment_slots_read on public.appointment_slots;
create policy appointment_slots_read on public.appointment_slots for select to authenticated
using(public.password_change_complete() and (active or public.is_manager() or staff_id=auth.uid()));

drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
using(
  requester_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.appointment_slots s where s.id=appointments.slot_id and s.staff_id=auth.uid())
);

create or replace function public.save_appointment_slot(
  p_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_location text,
  p_capacity integer
) returns public.appointment_slots
language plpgsql security definer set search_path=public as $$
declare sid uuid:=auth.uid(); result public.appointment_slots;
begin
  if public.current_role() not in ('manager','teacher') then raise exception 'STAFF_ONLY'; end if;
  if p_end<=p_start or p_capacity<1 then raise exception 'INVALID_SLOT'; end if;
  if p_date<current_date then raise exception 'PAST_SLOT'; end if;
  if exists(
    select 1 from public.appointment_slots s
    where s.staff_id=sid and s.date=p_date and s.active
      and (p_id is null or s.id<>p_id)
      and p_start<s.end_time and p_end>s.start_time
  ) then raise exception 'APPOINTMENT_SLOT_CONFLICT'; end if;

  if p_id is null then
    insert into public.appointment_slots(staff_id,date,start_time,end_time,location,capacity)
    values(sid,p_date,p_start,p_end,nullif(trim(p_location),''),p_capacity)
    returning * into result;
  else
    update public.appointment_slots
    set date=p_date,start_time=p_start,end_time=p_end,location=nullif(trim(p_location),''),capacity=p_capacity
    where id=p_id and staff_id=sid returning * into result;
    if not found then raise exception 'SLOT_NOT_FOUND'; end if;
  end if;
  return result;
end
$$;

create or replace function public.request_appointment(
  p_slot uuid,p_subject text,p_description text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare s public.appointment_slots; used integer; aid uuid;
begin
  select * into s from public.appointment_slots where id=p_slot for update;
  if not found or not s.active then raise exception 'SLOT_NOT_AVAILABLE'; end if;
  if s.date<current_date or (s.date=current_date and s.end_time<=localtime) then raise exception 'SLOT_PASSED'; end if;
  if auth.uid()=s.staff_id then raise exception 'CANNOT_BOOK_SELF'; end if;
  select count(*) into used from public.appointments a where a.slot_id=s.id and a.status in ('pending','approved');
  if used>=s.capacity then raise exception 'SLOT_FULL'; end if;
  if exists(
    select 1 from public.appointments a
    join public.appointment_slots x on x.id=a.slot_id
    where a.requester_id=auth.uid() and a.status in ('pending','approved')
      and x.date=s.date and s.start_time<x.end_time and s.end_time>x.start_time
  ) then raise exception 'APPOINTMENT_CONFLICT'; end if;

  insert into public.appointments(slot_id,requester_id,subject,description)
  values(s.id,auth.uid(),trim(p_subject),nullif(trim(p_description),''))
  on conflict(slot_id,requester_id) do update
  set subject=excluded.subject,description=excluded.description,status='pending',created_at=now(),approved_at=null,reviewed_by=null
  returning id into aid;
  return aid;
end
$$;

create or replace function public.review_appointment(p_appointment uuid,p_status text)
returns public.appointments
language plpgsql security definer set search_path=public as $$
declare a public.appointments;s public.appointment_slots;
begin
  if p_status not in ('approved','rejected','cancelled','completed') then raise exception 'INVALID_STATUS'; end if;
  select * into a from public.appointments where id=p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  select * into s from public.appointment_slots where id=a.slot_id;
  if p_status='cancelled' and a.requester_id=auth.uid() then
    update public.appointments set status='cancelled',reviewed_by=null where id=a.id returning * into a;return a;
  end if;
  if not (public.is_manager() or s.staff_id=auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  update public.appointments set status=p_status,reviewed_by=auth.uid(),approved_at=case when p_status='approved' then now() else approved_at end where id=a.id returning * into a;
  return a;
end
$$;

grant select on public.appointment_slots,public.appointments to authenticated;
grant execute on function public.save_appointment_slot(uuid,date,time,time,text,integer) to authenticated;
grant execute on function public.request_appointment(uuid,text,text) to authenticated;
grant execute on function public.review_appointment(uuid,text) to authenticated;

select public.attach_audit_trigger('public.appointments'::regclass);

create or replace function public.notify_appointment_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare staff uuid;
begin
  select staff_id into staff from public.appointment_slots where id=new.slot_id;
  if tg_op='INSERT' then
    perform public.push_notification(staff,'appointment','درخواست ملاقات جدید',new.subject,'appointments','appointment',new.id,'appointment:new:'||new.id::text);
  elsif new.status is distinct from old.status then
    perform public.push_notification(new.requester_id,'appointment','وضعیت ملاقات تغییر کرد','وضعیت درخواست ملاقات شما: '||new.status,'appointments','appointment',new.id,'appointment:'||new.id::text||':'||new.status);
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_appointment_change on public.appointments;
create trigger trg_notify_appointment_change after insert or update on public.appointments for each row execute function public.notify_appointment_change();
