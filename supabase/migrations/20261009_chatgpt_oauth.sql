-- Additive ChatGPT OAuth resource-server security, after system v7 migrations.
-- Supabase Auth OAuth 2.1 owns client registration, codes, tokens and grants.
begin;

create table public.oauth_connected_apps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null check (length(client_id) between 1 and 200),
  scopes text[] not null default array['profile.read','classes.read']::text[],
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id,client_id),
  constraint oauth_app_scopes check (
    cardinality(scopes) between 1 and 2
    and scopes <@ array['profile.read','classes.read']::text[]
  )
);
create index oauth_connections_revoked on public.oauth_connected_apps(client_id,revoked_at);
alter table public.oauth_connected_apps enable row level security;
revoke all on public.oauth_connected_apps from public,anon,authenticated;
grant select,insert,update on public.oauth_connected_apps to authenticated;
grant all on public.oauth_connected_apps to service_role;

create policy oauth_apps_self_read on public.oauth_connected_apps
  for select to authenticated using(user_id=(select auth.uid()) and public.account_ready());
create policy oauth_apps_self_insert on public.oauth_connected_apps
  for insert to authenticated with check(user_id=(select auth.uid()) and public.account_ready());
create policy oauth_apps_self_update on public.oauth_connected_apps
  for update to authenticated using(user_id=(select auth.uid()) and public.account_ready())
  with check(user_id=(select auth.uid()) and public.account_ready());

-- OAuth JWTs must not inherit the application's broad authenticated Data API
-- access. The Edge Function explicitly implements a small allowlisted API.
-- Restrictive RLS is defense in depth (including Realtime) for all current tables.
do $$
declare t record;
begin
  for t in
    select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and c.relrowsecurity and not c.relispartition
  loop
    execute format(
      'create policy oauth_no_direct_access on %I.%I as restrictive for all to authenticated using (coalesce(auth.jwt()->>''client_id'','''')='''') with check (coalesce(auth.jwt()->>''client_id'','''')='''')',
      t.nspname,t.relname
    );
  end loop;
end $$;

-- Storage has a separate API and is not protected by pgrst.db_pre_request.
create policy oauth_no_direct_storage on storage.objects as restrictive
  for all to authenticated
  using (coalesce(auth.jwt()->>'client_id','')='')
  with check (coalesce(auth.jwt()->>'client_id','')='');

-- SECURITY DEFINER RPCs bypass RLS. Block all OAuth-issued JWTs at PostgREST
-- before any table or RPC can run. Normal browser JWTs have no client_id.
create function public.oauth_postgrest_guard() returns void
language plpgsql stable set search_path=''
as $$
begin
  if coalesce(auth.jwt()->>'client_id','') <> '' then
    raise exception 'OAUTH_DIRECT_API_DISABLED' using errcode='42501';
  end if;
end $$;
revoke all on function public.oauth_postgrest_guard() from public;
grant execute on function public.oauth_postgrest_guard() to anon,authenticated;

-- Do not silently overwrite an existing hook installed by another feature.
do $$
declare existing_hook text;
begin
  select substring(setting from length('pgrst.db_pre_request=')+1)
    into existing_hook
  from pg_roles r cross join lateral unnest(coalesce(r.rolconfig,array[]::text[])) setting
  where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'
  limit 1;
  if existing_hook is not null and existing_hook <> 'public.oauth_postgrest_guard' then
    raise exception 'Existing pgrst.db_pre_request hook must be composed manually: %',existing_hook;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.oauth_postgrest_guard''';
  end if;
end $$;

create function system_private.audit_oauth_apps() returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  insert into public.audit_logs(user_id,action,table_name,record_id,new_data)
  values(
    new.user_id,
    case when new.revoked_at is null then 'OAUTH_CONNECTED' else 'OAUTH_REVOKED' end,
    'oauth_connected_apps',new.client_id,
    jsonb_build_object('scopes',new.scopes,'revoked',new.revoked_at is not null)
  );
  return new;
end $$;
create trigger oauth_connections_audit after insert or update of revoked_at,scopes
on public.oauth_connected_apps for each row execute function system_private.audit_oauth_apps();
revoke execute on function system_private.audit_oauth_apps() from public,anon,authenticated;

notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
