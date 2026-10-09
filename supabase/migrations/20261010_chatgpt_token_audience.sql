-- Apply after 20261009_chatgpt_oauth.sql.
-- This installs a custom access token hook FUNCTION only. Enable it in
-- Supabase Auth > Hooks > Custom Access Token after review and set the config
-- with the exact registered client_id and MCP resource URL.
begin;
create table system_private.chatgpt_oauth_config (
  singleton boolean primary key default true check(singleton),
  client_id text not null check(length(client_id) between 1 and 200),
  audience text not null check(audience ~ '^https://[A-Za-z0-9.-]+/functions/v1/chatgpt-mcp$')
);
alter table system_private.chatgpt_oauth_config enable row level security;
revoke all on system_private.chatgpt_oauth_config from public,anon,authenticated;
create or replace function system_private.chatgpt_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  cid text := nullif(coalesce(event->'claims'->>'client_id',''),'');
  cfg record;
  payload jsonb := event->'claims';
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'INVALID_AUTH_CLAIMS';
  end if;
  if cid is null then return event; end if;
  select client_id,audience into cfg
    from system_private.chatgpt_oauth_config where singleton;
  -- Unknown OAuth clients retain stock claims but receive no API access.
  if cfg.client_id is null or cid <> cfg.client_id then return event; end if;
  -- Defense in depth after the mandatory Auth email/identity migration.
  -- Required claim "email" stays present, but is a pseudonymous identifier.
  payload := jsonb_set(payload,'{aud}',to_jsonb(cfg.audience),true);
  payload := payload - 'user_metadata' - 'app_metadata';
  return jsonb_set(event,'{claims}',payload,true);
end $$;
revoke all on function system_private.chatgpt_access_token_hook(jsonb) from public,anon,authenticated;
do $$
begin
  if exists(select 1 from pg_roles where rolname='supabase_auth_admin') then
    execute 'grant usage on schema system_private to supabase_auth_admin';
    execute 'grant execute on function system_private.chatgpt_access_token_hook(jsonb) to supabase_auth_admin';
  end if;
end $$;
commit;
