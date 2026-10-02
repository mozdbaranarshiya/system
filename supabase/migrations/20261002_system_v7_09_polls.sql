-- v7 / مرحله ۹: نظرسنجی و رأی‌گیری
set role postgres;

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'all' check(target_type in ('all','role','grade','class')),
  target_role public.user_role,
  target_class_id uuid references public.classes(id) on delete cascade,
  target_grade_id uuid references public.grade_levels(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  anonymous boolean not null default false,
  show_results boolean not null default true,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check(ends_at is null or starts_at is null or ends_at>starts_at)
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_text text not null,
  sort_order integer not null default 0
);

create table if not exists public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  option_id uuid not null references public.poll_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(poll_id,user_id)
);

create index if not exists idx_polls_active_time on public.polls(active,starts_at,ends_at);
create index if not exists idx_poll_options_poll on public.poll_options(poll_id,sort_order);
create index if not exists idx_poll_votes_poll on public.poll_votes(poll_id,option_id);

create or replace function public.can_access_poll(p_poll uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.polls p
    where p.id=p_poll and (
      public.is_manager()
      or auth.uid() in (
        select t.user_id from public.target_user_ids(p.target_type,p.target_role,p.target_grade_id,p.target_class_id) t
      )
    )
  )
$$;
grant execute on function public.can_access_poll(uuid) to authenticated;

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select to authenticated
using(public.password_change_complete() and public.can_access_poll(id));

drop policy if exists polls_manager on public.polls;
create policy polls_manager on public.polls for all to authenticated
using(public.is_manager()) with check(public.is_manager() and created_by=auth.uid());

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options for select to authenticated
using(public.can_access_poll(poll_id));

drop policy if exists poll_options_manager on public.poll_options;
create policy poll_options_manager on public.poll_options for all to authenticated
using(public.is_manager()) with check(public.is_manager());

drop policy if exists poll_votes_read on public.poll_votes;
create policy poll_votes_read on public.poll_votes for select to authenticated
using(
  user_id=auth.uid()
  or (
    public.is_manager()
    and exists(select 1 from public.polls p where p.id=poll_votes.poll_id and not p.anonymous)
  )
);

create or replace function public.cast_poll_vote(p_poll uuid,p_option uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare p public.polls; vid uuid;
begin
  select * into p from public.polls where id=p_poll;
  if not found or not p.active then raise exception 'POLL_NOT_ACTIVE'; end if;
  if p.starts_at is not null and now()<p.starts_at then raise exception 'POLL_NOT_STARTED'; end if;
  if p.ends_at is not null and now()>p.ends_at then raise exception 'POLL_CLOSED'; end if;
  if not public.can_access_poll(p.id) then raise exception 'ACCESS_DENIED'; end if;
  if not exists(select 1 from public.poll_options o where o.id=p_option and o.poll_id=p.id) then raise exception 'INVALID_OPTION'; end if;
  if exists(select 1 from public.poll_votes v where v.poll_id=p.id and v.user_id=auth.uid()) then raise exception 'POLL_ALREADY_VOTED'; end if;
  insert into public.poll_votes(poll_id,option_id,user_id) values(p.id,p_option,auth.uid()) returning id into vid;
  return vid;
end
$$;

create or replace function public.poll_results(p_poll uuid)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.polls; result jsonb; total bigint;
begin
  select * into p from public.polls where id=p_poll;
  if not found then raise exception 'POLL_NOT_FOUND'; end if;
  if not public.can_access_poll(p.id) then raise exception 'ACCESS_DENIED'; end if;
  if not public.is_manager() and not p.show_results then raise exception 'POLL_RESULTS_HIDDEN'; end if;
  select count(*) into total from public.poll_votes where poll_id=p.id;
  select jsonb_build_object(
    'anonymous',p.anonymous,
    'participants',total,
    'options',coalesce(jsonb_agg(jsonb_build_object(
      'id',o.id,'text',o.option_text,'votes',coalesce(v.cnt,0),
      'percent',case when total=0 then 0 else round(coalesce(v.cnt,0)*100.0/total,1) end
    ) order by o.sort_order),'[]'::jsonb)
  ) into result
  from public.poll_options o
  left join (
    select option_id,count(*) cnt from public.poll_votes where poll_id=p.id group by option_id
  ) v on v.option_id=o.id
  where o.poll_id=p.id;
  return result;
end
$$;

grant select,insert,update,delete on public.polls,public.poll_options to authenticated;
grant select on public.poll_votes to authenticated;
grant execute on function public.cast_poll_vote(uuid,uuid) to authenticated;
grant execute on function public.poll_results(uuid) to authenticated;

create or replace function public.notify_poll_created()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.active then
    insert into public.notifications(user_id,type,title,body,link,entity_type,entity_id,dedupe_key)
    select t.user_id,'poll','نظرسنجی جدید',new.title,'polls','poll',new.id,'poll:new:'||new.id::text
    from public.target_user_ids(new.target_type,new.target_role,new.target_grade_id,new.target_class_id) t
    where t.user_id<>new.created_by
    on conflict(user_id,dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists trg_notify_poll_created on public.polls;
create trigger trg_notify_poll_created after insert on public.polls for each row execute function public.notify_poll_created();
