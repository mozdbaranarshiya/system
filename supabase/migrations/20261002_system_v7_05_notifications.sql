-- v7 / مرحله ۵: مرکز اعلان‌ها
set role postgres;

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

create index if not exists idx_notifications_user_unread
  on public.notifications(user_id,created_at desc)
  where read_at is null;
create index if not exists idx_notifications_user_created
  on public.notifications(user_id,created_at desc);
create unique index if not exists uq_notifications_dedupe
  on public.notifications(user_id,dedupe_key)
  where dedupe_key is not null;

alter table public.notifications enable row level security;

drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications
for select to authenticated
using(public.password_change_complete() and user_id=auth.uid());

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications
for update to authenticated
using(public.password_change_complete() and user_id=auth.uid())
with check(public.password_change_complete() and user_id=auth.uid());

grant select,update on public.notifications to authenticated;

create or replace function public.push_notification(
  p_user uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_key text
) returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.notifications(
    user_id,type,title,body,link,entity_type,entity_id,dedupe_key
  ) values(
    p_user,p_type,p_title,p_body,p_link,p_entity_type,p_entity_id,p_dedupe_key
  )
  on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
end
$$;

revoke all on function public.push_notification(uuid,text,text,text,text,text,uuid,text) from public;

create or replace function public.notify_assignment_created()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.group_id is null then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select cs.student_id,'homework_new','تکلیف جدید',new.title,'homework','assignment',new.id,
           'assignment:new:'||new.id::text
    from public.class_students cs
    where cs.class_id=new.class_id
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  else
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select gm.student_id,'homework_new','تکلیف جدید',new.title,'homework','assignment',new.id,
           'assignment:new:'||new.id::text
    from public.student_group_members gm
    where gm.group_id=new.group_id
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_assignment_created on public.assignments;
create trigger trg_notify_assignment_created
after insert on public.assignments
for each row execute function public.notify_assignment_created();

create or replace function public.notify_submission_reviewed()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status is distinct from old.status and new.status in ('graded','needs_revision') then
    perform public.push_notification(
      new.student_id,
      case when new.status='graded' then 'homework_result' else 'homework_revision' end,
      case when new.status='graded' then 'نتیجه تکلیف' else 'تکلیف نیاز به اصلاح دارد' end,
      coalesce(new.feedback,''),
      'homework','assignment_submission',new.id,
      'submission:'||new.id::text||':'||new.status||':'||new.attempt::text
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_submission_reviewed on public.assignment_submissions;
create trigger trg_notify_submission_reviewed
after update on public.assignment_submissions
for each row execute function public.notify_submission_reviewed();

create or replace function public.notify_objection_result()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    perform public.push_notification(
      new.student_id,'objection_result','پاسخ اعتراض',
      case when new.status='approved' then 'اعتراض شما تأیید شد.' else 'اعتراض شما رد شد.' end,
      'objections','objection',new.id,
      'objection:'||new.id::text||':'||new.status
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_objection_result on public.objections;
create trigger trg_notify_objection_result
after update on public.objections
for each row execute function public.notify_objection_result();

create or replace function public.notify_score_changed()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='INSERT'
     or new.continuous_score is distinct from old.continuous_score
     or new.final_score is distinct from old.final_score then
    perform public.push_notification(
      new.student_id,'score_changed','نمره جدید یا ویرایش‌شده',
      'نمره یکی از دروس شما تغییر کرده است.',
      'report','score',new.id,
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
  if new.status<>'present' and (tg_op='INSERT' or new.status is distinct from old.status) then
    perform public.push_notification(
      new.student_id,'attendance','ثبت حضور و غیاب',
      'برای شما وضعیت حضور و غیاب جدیدی ثبت شده است.',
      'attendance','attendance',new.id,
      'attendance:'||new.id::text||':'||new.status::text
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_notify_attendance_changed on public.attendance_records;
create trigger trg_notify_attendance_changed
after insert or update on public.attendance_records
for each row execute function public.notify_attendance_changed();

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare n integer;
begin
  update public.notifications
  set read_at=now()
  where user_id=auth.uid() and read_at is null;
  get diagnostics n=row_count;
  return n;
end
$$;

grant execute on function public.mark_all_notifications_read() to authenticated;
