-- v7 / مرحله ۱۰: کلاس‌های فوق‌برنامه
set role postgres;

create table if not exists public.extracurricular_classes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'other' check(category in ('remedial','sports','art','cultural','language','olympiad','laboratory','other')),
  teacher_id uuid references public.profiles(id) on delete set null,
  capacity integer not null check(capacity>0),
  location text,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_start timestamptz,
  registration_end timestamptz,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at>starts_at),
  check(registration_end is null or registration_start is null or registration_end>registration_start)
);

create table if not exists public.extracurricular_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  note text,
  created_at timestamptz not null default now(),
  check(ends_at>starts_at)
);

create table if not exists public.extracurricular_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.extracurricular_classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  registered_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  unique(class_id,student_id)
);

create index if not exists idx_extra_active_reg on public.extracurricular_classes(active,registration_start,registration_end);
create index if not exists idx_extra_teacher on public.extracurricular_classes(teacher_id);
create index if not exists idx_extra_sessions on public.extracurricular_sessions(class_id,starts_at);
create index if not exists idx_extra_enrollments_class on public.extracurricular_enrollments(class_id,status);
create index if not exists idx_extra_enrollments_student on public.extracurricular_enrollments(student_id,status);

drop trigger if exists trg_extra_updated_at on public.extracurricular_classes;
create trigger trg_extra_updated_at before update on public.extracurricular_classes for each row execute function public.touch_updated_at();

alter table public.extracurricular_classes enable row level security;
alter table public.extracurricular_sessions enable row level security;
alter table public.extracurricular_enrollments enable row level security;

drop policy if exists extra_classes_read on public.extracurricular_classes;
create policy extra_classes_read on public.extracurricular_classes for select to authenticated
using(public.password_change_complete() and (active or public.is_manager() or teacher_id=auth.uid()));

drop policy if exists extra_classes_manager on public.extracurricular_classes;
create policy extra_classes_manager on public.extracurricular_classes for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists extra_sessions_read on public.extracurricular_sessions;
create policy extra_sessions_read on public.extracurricular_sessions for select to authenticated
using(exists(select 1 from public.extracurricular_classes c where c.id=extracurricular_sessions.class_id));

drop policy if exists extra_sessions_staff on public.extracurricular_sessions;
create policy extra_sessions_staff on public.extracurricular_sessions for all to authenticated
using(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=extracurricular_sessions.class_id and c.teacher_id=auth.uid())
)
with check(
  public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=extracurricular_sessions.class_id and c.teacher_id=auth.uid())
);

drop policy if exists extra_enrollments_read on public.extracurricular_enrollments;
create policy extra_enrollments_read on public.extracurricular_enrollments for select to authenticated
using(
  student_id=auth.uid()
  or public.is_manager()
  or exists(select 1 from public.extracurricular_classes c where c.id=extracurricular_enrollments.class_id and c.teacher_id=auth.uid())
);

create or replace function public.register_extracurricular(p_class uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare c public.extracurricular_classes; eid uuid; used integer;
begin
  select * into c from public.extracurricular_classes where id=p_class for update;
  if not found or not c.active then raise exception 'EXTRA_NOT_ACTIVE'; end if;
  if public.current_role()<>'student' then raise exception 'STUDENT_ONLY'; end if;
  if c.registration_start is not null and now()<c.registration_start then raise exception 'REGISTRATION_NOT_STARTED'; end if;
  if c.registration_end is not null and now()>c.registration_end then raise exception 'REGISTRATION_CLOSED'; end if;
  if exists(select 1 from public.extracurricular_enrollments e where e.class_id=c.id and e.student_id=auth.uid() and e.status in ('pending','approved')) then raise exception 'ALREADY_REGISTERED'; end if;
  select count(*) into used from public.extracurricular_enrollments e where e.class_id=c.id and e.status in ('pending','approved');
  if used>=c.capacity then raise exception 'CLASS_FULL'; end if;
  insert into public.extracurricular_enrollments(class_id,student_id,status) values(c.id,auth.uid(),'pending')
  on conflict(class_id,student_id) do update set status='pending',registered_at=now(),reviewed_by=null,reviewed_at=null
  returning id into eid;
  return eid;
end
$$;

create or replace function public.review_extracurricular(p_enrollment uuid,p_status text)
returns public.extracurricular_enrollments
language plpgsql security definer set search_path=public as $$
declare e public.extracurricular_enrollments;c public.extracurricular_classes;used integer;
begin
  if p_status not in ('approved','rejected','cancelled') then raise exception 'INVALID_STATUS'; end if;
  select * into e from public.extracurricular_enrollments where id=p_enrollment for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  select * into c from public.extracurricular_classes where id=e.class_id for update;
  if not (public.is_manager() or c.teacher_id=auth.uid() or (e.student_id=auth.uid() and p_status='cancelled')) then raise exception 'ACCESS_DENIED'; end if;
  if p_status='approved' then
    select count(*) into used from public.extracurricular_enrollments x where x.class_id=c.id and x.status='approved' and x.id<>e.id;
    if used>=c.capacity then raise exception 'CLASS_FULL'; end if;
  end if;
  update public.extracurricular_enrollments set status=p_status,reviewed_by=case when e.student_id=auth.uid() then null else auth.uid() end,reviewed_at=now() where id=e.id returning * into e;
  return e;
end
$$;

grant select,insert,update,delete on public.extracurricular_classes,public.extracurricular_sessions to authenticated;
grant select on public.extracurricular_enrollments to authenticated;
grant execute on function public.register_extracurricular(uuid) to authenticated;
grant execute on function public.review_extracurricular(uuid,text) to authenticated;

select public.attach_audit_trigger('public.extracurricular_enrollments'::regclass);

create or replace function public.notify_extra_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select p.id,'extracurricular','فوق‌برنامه جدید',new.title,'extracurricular','extracurricular',new.id,'extra:new:'||new.id::text
    from public.profiles p where p.role='student' and p.active
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_extra_created on public.extracurricular_classes;
create trigger trg_notify_extra_created after insert on public.extracurricular_classes for each row execute function public.notify_extra_created();
