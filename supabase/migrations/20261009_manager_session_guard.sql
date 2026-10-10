-- Additional service-only boundary for existing manager Edge Functions.
-- Run after the v7 profile migrations. The original Login/MFA implementation
-- remains Supabase Auth; no parallel identity or factor records are created.
begin;
create or replace function public.assert_manager_session(p_user uuid,p_session uuid) returns boolean
language plpgsql volatile security definer set search_path=public,pg_catalog
as $manager_session$
declare current_session auth.sessions;
begin
  -- Only the Edge Function can supply these IDs after validating the exact JWT
  -- through native Auth and checking its subject/session/issuer/audience/AAL.
  if p_user is null or p_session is null or not exists(
    select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_user and p.role='manager' and p.active
      and (nullif(to_jsonb(u)->>'banned_until','') is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
      and nullif(to_jsonb(u)->>'deleted_at','') is null
  ) then raise exception 'MFA_REQUIRED'; end if;
  -- Do not wait on a session while another native Auth flow can hold the
  -- opposite identity lock. A busy session fails closed and can be retried.
  select * into current_session from auth.sessions where id=p_session and user_id=p_user for share nowait;
  if not found or (current_session.not_after is not null and current_session.not_after<=clock_timestamp())
    or current_session.aal is distinct from 'aal2' or not exists(
      select 1 from auth.mfa_factors f where f.id=current_session.factor_id and f.user_id=p_user
        and f.status='verified' and f.factor_type='totp'
    ) then raise exception 'MFA_REQUIRED'; end if;
  -- Initial manager password change must remain possible after real TOTP.
  -- Ordinary admin operations separately require must_change_password=false.
  -- The connector's additional ten-minute step-up policy remains independent.
  return true;
exception when lock_not_available then raise exception 'MFA_REQUIRED';
end $manager_session$;
revoke execute on function public.assert_manager_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_manager_session(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
