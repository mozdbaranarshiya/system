// Reproduce the reviewed, additive SQL Editor release for the existing school.
// This generator never connects to Supabase or changes accounts or data.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sources } from './install-school.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const sourceMigrations = Object.freeze(sources.filter(source =>
  source.file.endsWith('/20261007_oauth_connector.sql') ||
  source.file.endsWith('/20261009_manager_session_guard.sql')));

const preflight = `
do $source_oauth_preflight$
declare required text; collision boolean;
begin
  if current_user not in ('postgres','supabase_admin') then
    raise exception 'SOURCE_OAUTH_REQUIRES_DATABASE_OWNER';
  end if;
  foreach required in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=required) then
      raise exception 'SOURCE_OAUTH_ROLE_MISSING: %', required;
    end if;
  end loop;
  foreach required in array array['public.profiles','public.audit_logs',
    'public.classes','public.grade_levels','public.subjects','public.class_students',
    'public.teacher_assignments','public.scores','public.school_settings','public.assignments',
    'auth.users','auth.sessions','auth.mfa_factors'] loop
    if to_regclass(required) is null then
      raise exception 'SOURCE_OAUTH_EXISTING_TABLE_MISSING: %', required;
    end if;
  end loop;
  foreach required in array array['public.account_ready()','public.is_manager()',
    'public.teacher_has_access(uuid,uuid)','public.can_read_class(uuid)',
    'public.can_read_student(uuid)','public.oauth_postgrest_guard()',
    'pg_catalog.gen_random_uuid()'] loop
    if to_regprocedure(required) is null then
      raise exception 'SOURCE_OAUTH_EXISTING_FUNCTION_MISSING: %', required;
    end if;
  end loop;
  if exists(select 1 from (values
    ('users','id'),('users','encrypted_password'),
    ('sessions','id'),('sessions','user_id'),('sessions','aal'),('sessions','factor_id'),('sessions','not_after'),
    ('mfa_factors','id'),('mfa_factors','user_id'),('mfa_factors','status'),('mfa_factors','factor_type')
    ) as needed(table_name,column_name)
    where not exists(select 1 from information_schema.columns c
      where c.table_schema='auth' and c.table_name=needed.table_name and c.column_name=needed.column_name)) then
    raise exception 'SOURCE_OAUTH_NATIVE_AUTH_VERSION_UNSUPPORTED';
  end if;
  if exists(select 1 from (values ('must_change_password'),('password_changed_at')) as needed(column_name)
    where not exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='profiles' and c.column_name=needed.column_name)) then
    raise exception 'SOURCE_OAUTH_REQUIRES_EXISTING_V7_PROFILES';
  end if;
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.role='manager' and p.active and not p.must_change_password
      and (nullif(to_jsonb(u)->>'banned_until','') is null
        or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
      and nullif(to_jsonb(u)->>'deleted_at','') is null) then
    raise exception 'SOURCE_OAUTH_REQUIRES_EXISTING_READY_MANAGER';
  end if;
  if exists(select 1 from pg_namespace where nspname='system_oauth')
    or to_regprocedure('public.oauth_operation(text,jsonb)') is not null
    or to_regprocedure('public.oauth_api(text,text,jsonb)') is not null
    or to_regprocedure('public.oauth_cleanup()') is not null
    or to_regprocedure('public.assert_manager_session(uuid,uuid)') is not null
    or exists(select 1 from pg_trigger where
      (tgrelid='public.profiles'::regclass and tgname='oauth_profile_security')
      or (tgrelid='auth.users'::regclass and tgname='oauth_auth_security')) then
    raise exception 'SOURCE_OAUTH_ALREADY_INSTALLED_OR_NAME_COLLISION';
  end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'select exists(select 1 from cron.job where jobname=''system-oauth-cleanup'')' into collision;
    if collision then raise exception 'SOURCE_OAUTH_CLEANUP_JOB_COLLISION'; end if;
  end if;
end $source_oauth_preflight$;
`;

const stripTransaction = sql => sql.replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '');

export async function generateSourceOAuthSetup({ root = repository } = {}) {
  if (sourceMigrations.length !== 2) throw new Error('Expected exactly two reviewed source migrations');
  const additions = [];
  for (const source of sourceMigrations) {
    const sql = await readFile(path.join(root, source.file), 'utf8');
    if (sha256(sql) !== source.sha256) throw new Error('Unreviewed migration source: '+source.file);
    additions.push(`-- Source: ${source.file}\n-- SHA-256: ${source.sha256}\n${stripTransaction(sql)}`);
  }
  const sql = `-- GENERATED by supabase/prepare-source-oauth.mjs; do not edit this bundle.
-- Run ONCE as postgres in efibfevyiepkwpnobaro SQL Editor.
-- Requires the existing v7 school and its real manager; creates no accounts.
-- Existing educational data, login, TOTP and native OAuth guard are preserved.
-- All additions and the service permission fix commit together or roll back.
begin;
${preflight}
${additions.join('\n')}
-- Allow trusted Edge service requests to execute the existing pre-request guard.
-- Keep the guard itself and its restrictions on native OAuth JWTs unchanged.
grant execute on function public.oauth_postgrest_guard() to service_role;
notify pgrst,'reload schema';
commit;

-- Success output contains status only, never identity details or secrets.
select
  (select count(*) from pg_tables where schemaname='system_oauth') as oauth_tables,
  (select count(*) from pg_tables where schemaname='system_oauth' and rowsecurity) as oauth_rls_tables,
  has_function_privilege('service_role','public.oauth_postgrest_guard()','EXECUTE') as service_guard_allowed,
  to_regprocedure('public.assert_manager_session(uuid,uuid)') is not null as manager_session_guard_ready;
`;
  const manifest = {
    format_version: 1, project_ref: 'efibfevyiepkwpnobaro', application_schema: 'public',
    private_schema: 'system_oauth', atomic_file: 'source-oauth.sql', atomic_sha256: sha256(sql),
    native_auth: 'existing accounts and factors unchanged',
    migrations: sourceMigrations.map(source => ({ ...source })),
  };
  return { sql, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--out')) {
    throw new Error('Usage: node supabase/prepare-source-oauth.mjs [--out DIRECTORY]');
  }
  const setup = await generateSourceOAuthSetup();
  if (args.length) {
    const directory = path.resolve(args[1]);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory,'source-oauth.sql'), setup.sql, { flag: 'wx' });
    await writeFile(path.join(directory,'manifest.json'), JSON.stringify(setup.manifest,null,2)+'\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(setup.manifest,null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
