// Generate reviewed SQL for a second application on a shared Supabase project.
// This command never connects to a database. The original public migrations
// remain unchanged, and their hashes are checked before any SQL is emitted.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const sources = Object.freeze([
  ['supabase/schema.sql', 'b3bbb65fd29219246415d2c4c737bdc90a03299f62b4eff96a0c01182b09cbab'],
  ['supabase/migrations/20261002_system_v7_01_core.sql', 'ea7f7134288e34a415160f90f0f4f117b31ff15746ec4df7f5c8c75116af74e2'],
  ['supabase/migrations/20261002_system_v7_02_exams.sql', 'f082693e82c71606205389cd41b10c4dc4f5daf7711ad919056d118f183bda64'],
  ['supabase/migrations/20261002_system_v7_03_community.sql', '8767b83c71b50283498799e7c1b4ea650b4e625bd343cb314ed35372a4a1f2ab'],
  ['supabase/migrations/20261002_system_v7_04_integrations.sql', '97f8d1626b4154cfd9b7b7407056b1836834701257ca1a18ce99cb6363739ae3'],
  ['supabase/migrations/20261007_oauth_connector.sql', '60168e1071c71f912f95f1cce16fabe9829a4b7ec88d62bc8ce8c5a6a21b78f7'],
  ['supabase/migrations/20261009_manager_session_guard.sql', '3304b22a56a6d3cea271a9370f2fe3e8a5a4a5190251bc90d686d94730d94a81'],
].map(([file, hash]) => Object.freeze({ file, sha256: hash })));

const preflight = `
do $school_preflight$
declare ns text; required text; cron_collision boolean;
begin
  -- This is a fresh installation, not a repair or overwrite operation.
  foreach ns in array array['school','school_private','school_oauth'] loop
    if exists(select 1 from pg_namespace where nspname=ns) then
      raise exception 'SCHOOL_INSTALL_NOT_EMPTY: %', ns;
    end if;
  end loop;
  if exists(select 1 from storage.buckets where id='school-assignment-files')
    or exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'school\\_%' escape '\\')
    or exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='school_oauth_auth_security') then
    raise exception 'SCHOOL_INSTALL_SHARED_NAME_COLLISION';
  end if;
  foreach required in array array['anon','authenticated','service_role'] loop
    if not exists(select 1 from pg_roles where rolname=required) then raise exception 'SCHOOL_INSTALL_ROLE_MISSING: %', required; end if;
  end loop;
  if not exists(select 1 from pg_extension where extname='pgcrypto') then
    raise exception 'SCHOOL_INSTALL_REQUIRES_PGCRYPTO';
  end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'select exists(select 1 from cron.job where jobname in (''school-v7-reminders'',''school-oauth-cleanup''))' into cron_collision;
    if cron_collision then raise exception 'SCHOOL_INSTALL_CRON_NAME_COLLISION'; end if;
  end if;
  if to_regclass('auth.users') is null or to_regclass('auth.sessions') is null or to_regclass('auth.mfa_factors') is null
    or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null
    or to_regprocedure('auth.role()') is null or to_regprocedure('storage.foldername(text)') is null
    or to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'SCHOOL_INSTALL_REQUIRES_NATIVE_AUTH_STORAGE';
  end if;
  if exists(select 1 from (values
    ('users','id'),('users','encrypted_password'),
    ('sessions','id'),('sessions','user_id'),('sessions','aal'),('sessions','factor_id'),('sessions','not_after'),
    ('mfa_factors','id'),('mfa_factors','user_id'),('mfa_factors','status'),('mfa_factors','factor_type')
    ) as needed(table_name,column_name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='auth' and c.table_name=needed.table_name and c.column_name=needed.column_name)) then
    raise exception 'SCHOOL_INSTALL_NATIVE_AUTH_VERSION_UNSUPPORTED';
  end if;
end $school_preflight$;
create schema school;
revoke all on schema school from public,anon,authenticated,service_role;
grant usage on schema school to authenticated,service_role;
`;

const cryptoPasswordGate = `
-- pgcrypto can already belong to public or extensions. Do not relocate it or
-- add an unrelated application's public schema to SECURITY DEFINER paths.
do $school_crypto$
declare crypto_schema text;
begin
  select n.nspname into crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if crypto_schema is null then raise exception 'SCHOOL_INSTALL_REQUIRES_PGCRYPTO'; end if;
  execute format('update school.profiles p set must_change_password=true
    from auth.users u where u.id=p.id and u.encrypted_password<>''''
    and u.encrypted_password=%I.crypt(p.national_id,u.encrypted_password)', crypto_schema);
end $school_crypto$;
`;

// Existing permissive Storage policies must never grant access to this bucket.
// Restrictive policies pass through every other bucket unchanged.
const sharedBoundaries = `
-- Policy evaluation checks function ACLs even for branches that do not run.
-- Keep anonymous access to unrelated buckets working through this boolean-only
-- definer helper, instead of granting anonymous callers school RPC privileges.
create function school_private.can_access_school_bucket(p_operation text,p_path text) returns boolean
language plpgsql stable security definer set search_path=school,pg_catalog
as $school_storage$
begin
  if auth.role() is distinct from 'authenticated' or not school.account_ready() then return false; end if;
  if p_operation='read' then
    if (storage.foldername(p_path))[1]=auth.uid()::text or school.is_manager() then return true; end if;
    -- Historical assignment ownership is insufficient after teacher access
    -- changes. Every submission read also follows the current assignment.
    return exists(select 1 from school.assignment_submissions s join school.assignments a on a.id=s.assignment_id
      where s.file_path=p_path and ((school.current_role()='student' and s.student_id=auth.uid())
        or (school.current_role()='teacher' and a.teacher_id=auth.uid() and school.teacher_has_access(a.class_id,a.subject_id))));
  end if;
  if p_operation in ('insert','delete') then return (storage.foldername(p_path))[1]=auth.uid()::text; end if;
  return false;
end $school_storage$;
-- The private schema has no browser USAGE. Storage policies reference this
-- helper by OID; it cannot be exposed as a PostgREST school API endpoint.
grant execute on function school_private.can_access_school_bucket(text,text) to public;
create policy school_bucket_select_boundary on storage.objects as restrictive for select to public
using(bucket_id<>'school-assignment-files' or
  school_private.can_access_school_bucket('read',name));
create policy school_bucket_insert_boundary on storage.objects as restrictive for insert to public
with check(bucket_id<>'school-assignment-files' or
  school_private.can_access_school_bucket('insert',name));
create policy school_bucket_delete_boundary on storage.objects as restrictive for delete to public
using(bucket_id<>'school-assignment-files' or
  school_private.can_access_school_bucket('delete',name));
create policy school_bucket_update_boundary on storage.objects as restrictive for update to public
using(bucket_id<>'school-assignment-files') with check(bucket_id<>'school-assignment-files');

-- The verified admin-user Edge Function supplies p_actor; browser roles cannot
-- call this boundary. Remove only school access, never a shared Auth identity.
create function school.remove_profile_access(p_user uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=school,pg_catalog
as $school_remove$
declare claims_before text; audit_before text;
begin
  if p_user is null or p_actor is null or p_user=p_actor then raise exception 'ACCESS_DENIED'; end if;
  -- Same sorted profile locks as the security writers; no shared Auth mutation.
  perform id from school.profiles where id in (p_user,p_actor) order by id for update;
  if not exists(select 1 from school.profiles where id=p_actor and role='manager' and active and not must_change_password)
    or not school_oauth.live_user(p_actor) then raise exception 'ACCESS_DENIED'; end if;
  if not exists(select 1 from school.profiles where id=p_user and role in ('teacher','student')) then raise exception 'ACCESS_DENIED'; end if;
  claims_before:=current_setting('request.jwt.claims',true);
  audit_before:=current_setting('system.audit_actor',true);
  -- AAL2 was verified by the service-only Edge boundary, as for profile edits.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','aal','aal2')::text,true);
  perform set_config('system.audit_actor',p_actor::text,true);
  insert into school.audit_logs(user_id,action,table_name,record_id)
    values(p_actor,'SCHOOL_ACCESS_REMOVED','profiles',p_user::text);
  -- Historical records retain their original user reference. A hard DELETE
  -- fails for ordinary notification/exam/attendance history; disabling access
  -- always reaches the existing revocation trigger without deleting Auth.
  update school.profiles set active=false where id=p_user;
  perform set_config('request.jwt.claims',coalesce(claims_before,''),true);
  perform set_config('system.audit_actor',coalesce(audit_before,''),true);
end $school_remove$;
revoke execute on function school.remove_profile_access(uuid,uuid) from public,anon,authenticated;
grant execute on function school.remove_profile_access(uuid,uuid) to service_role;
notify pgrst,'reload schema';
`;

function transform(sql, file) {
  // Qualified identifiers are also used inside trusted dollar-quoted functions,
  // dynamic SQL and regprocedure literals. PUBLIC the role stays PUBLIC.
  let output = sql.replace(/\bpublic\./g, 'school.')
    .replace(/\bsystem_private\b/g, 'school_private')
    .replace(/\bsystem_oauth\b/g, 'school_oauth')
    .replace(/\bset\s+search_path\s*=\s*public(?:\s*,\s*pg_catalog)?\b/gi, 'set search_path=school,pg_catalog')
    .replace(/\bon\s+schema\s+public\b/gi, 'on schema school')
    .replace(/\bn\.nspname\s*=\s*'public'/g, "n.nspname='school'")
    .replaceAll("'assignment-files'", "'school-assignment-files'")
    .replaceAll("'system-v7-reminders'", "'school-v7-reminders'")
    .replaceAll("'system-oauth-cleanup'", "'school-oauth-cleanup'")
    .replace(/\b(create\s+policy|drop\s+policy\s+if\s+exists)\s+([a-z_][a-z0-9_]*)/gi, '$1 school_$2')
    .replace(/\bcreate\s+trigger\s+oauth_auth_security\b/gi, 'create trigger school_oauth_auth_security')
    // All emitted transactions keep the actual caller/owner. No SET ROLE side
    // effect is inherited by later Management API calls.
    .replace(/^set role postgres;\s*$/gm, '');
  if (file === 'supabase/schema.sql') {
    output = output.replace('create extension if not exists pgcrypto;', '-- Existing pgcrypto is verified by the installation preflight.');
  }
  if (file.endsWith('_01_core.sql')) {
    const old = `update school.profiles p set must_change_password=true
from auth.users u where u.id=p.id and u.encrypted_password<>''
and u.encrypted_password=crypt(p.national_id,u.encrypted_password);`;
    if (!output.includes(old)) throw new Error('Reviewed password-gate SQL changed');
    output = output.replace(old, cryptoPasswordGate);
  }
  if (/\bpublic\.|\bsearch_path\s*=\s*public|\bon\s+schema\s+public\b|\bn\.nspname\s*=\s*'public'|\bsystem_(?:oauth|private)\b/.test(output)) {
    throw new Error('Unconverted application namespace in '+file);
  }
  return output;
}

const stripTransaction = sql => sql.replace(/^begin;\s*$/gmi, '').replace(/^commit;\s*$/gmi, '');

export async function generateSchoolInstallation({ root = repository } = {}) {
  const steps = [];
  for (const source of sources) {
    const original = await readFile(path.join(root, source.file), 'utf8');
    if (sha256(original) !== source.sha256) throw new Error('Unreviewed migration source: '+source.file);
    let sql = transform(original, source.file);
    if (steps.length === 0) sql = 'begin;\n'+preflight+sql+'\ncommit;\n';
    const name = String(steps.length+1).padStart(2,'0')+'_'+path.basename(source.file);
    steps.push({ name, source: source.file, source_sha256: source.sha256, sha256: sha256(sql), sql });
  }
  const sql = 'begin;\n'+sharedBoundaries+'\ncommit;\n';
  steps.push({ name: String(steps.length+1).padStart(2,'0')+'_shared_boundaries.sql', source: null, source_sha256: null, sha256: sha256(sql), sql });
  // Applying this reviewed artifact is atomic across every application object.
  // It still makes no external connection; the caller must inspect the target.
  const atomicSql = 'begin;\n'+steps.map(step => stripTransaction(step.sql)).join('\n')+'\ncommit;\n';
  const manifest = {
    format_version: 1, schema: 'school', private_schemas: ['school_private','school_oauth'],
    bucket: 'school-assignment-files', native_auth: 'shared, unchanged',
    prerequisites: ['Clean school/school_private/school_oauth namespaces', 'PostgreSQL 13+ with native Supabase Auth and Storage', 'pgcrypto already installed', 'Database owner privileges', 'Expose school separately in PostgREST after installation'],
    atomic_file: 'install.sql', atomic_sha256: sha256(atomicSql),
    steps: steps.map(({ sql: _sql, ...metadata }) => metadata),
  };
  return { manifest, steps, sql: atomicSql };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length===2 && args[0]==='--out')) throw new Error('Usage: node supabase/install-school.mjs [--out DIRECTORY]');
  const installation = await generateSchoolInstallation();
  if (args.length) {
    const directory = path.resolve(args[1]);
    // Never overwrite SQL from a previous review/install attempt.
    await mkdir(directory, { recursive: true });
    for (const step of installation.steps) await writeFile(path.join(directory,step.name), step.sql, { flag:'wx' });
    await writeFile(path.join(directory,'install.sql'), installation.sql, { flag:'wx' });
    await writeFile(path.join(directory,'manifest.json'), JSON.stringify(installation.manifest,null,2)+'\n', { flag:'wx' });
  }
  console.log(JSON.stringify(installation.manifest,null,2));
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
