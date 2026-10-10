import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { database } from './database-setup.mjs';
import { seed, seedOAuthSessions, ids, uuid } from './fixtures.mjs';
import { generateSourceOAuthSetup } from '../supabase/prepare-source-oauth.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const setup = await generateSourceOAuthSetup();
const digest = text => createHash('sha256').update(text).digest('hex');

async function fixture() {
  const db = await database();
  await db.exec(`
    alter table auth.users add column banned_until timestamptz;
    alter table auth.users add column deleted_at timestamptz;
    alter table auth.users add column email_confirmed_at timestamptz default now();
    alter table auth.users add column created_at timestamptz default now();
    create table auth.identities(id uuid primary key,user_id uuid references auth.users,provider text,identity_data jsonb);
  `);
  await seed(db);
  await db.exec("insert into auth.identities select id,id,'email',jsonb_build_object('email',email) from auth.users");
  for (const file of ['20261002_system_v7_01_core.sql', '20261002_system_v7_02_exams.sql', '20261002_system_v7_03_community.sql', '20261002_system_v7_04_integrations.sql']) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  await db.exec(`
    create function public.oauth_postgrest_guard() returns void language plpgsql as $guard$
      begin if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'OAUTH_DIRECT_DATABASE_DENIED'; end if; end
    $guard$;
    revoke all on function public.oauth_postgrest_guard() from public,anon,authenticated,service_role;
    grant execute on function public.oauth_postgrest_guard() to anon,authenticated;
    create table public.partner_exam_runs(id uuid primary key,owner uuid references auth.users,title text);
    insert into public.partner_exam_runs values('${uuid(9700)}','${ids.teacher}','Existing partner exam content');
  `);
  const sessions = await seedOAuthSessions(db);
  return { db, sessions };
}

async function role(db, name, fn, claims = {}) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: name, ...claims })]);
  await db.exec('set role ' + name);
  try { return await fn(); }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','{}',false)"); }
}

async function snapshot(db) {
  const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    result['public.' + tablename] = (await db.query(`select to_jsonb(t) row from public."${tablename}" t order by to_jsonb(t)::text`)).rows;
  }
  for (const table of ['users', 'identities', 'mfa_factors', 'sessions']) {
    result['auth.' + table] = (await db.query(`select to_jsonb(t) row from auth.${table} t order by to_jsonb(t)::text`)).rows;
  }
  result.guard = (await db.query("select pg_get_functiondef('public.oauth_postgrest_guard()'::regprocedure) definition")).rows;
  return result;
}

async function refuse(db) {
  await assert.rejects(() => db.exec(setup.sql));
  await db.exec('rollback');
}

await test('Generated source setup is deterministic, pinned and matches the shipped SQL', async () => {
  assert.equal((await generateSourceOAuthSetup()).sql, setup.sql);
  assert.equal(await readFile('supabase/source-oauth-setup.sql', 'utf8'), setup.sql);
  assert.equal((setup.sql.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((setup.sql.match(/^commit;$/gmi) || []).length, 1);
  assert.ok(setup.manifest && typeof setup.manifest === 'object');
  assert.equal(setup.manifest.atomic_sha256, digest(setup.sql));
  assert.equal(setup.manifest.project_ref, 'efibfevyiepkwpnobaro');
  assert.equal(setup.manifest.migrations.length, 2);
  for (const source of setup.manifest.migrations) {
    assert.equal(source.sha256, digest(await readFile(source.file, 'utf8')));
  }
  assert.match(setup.sql, /grant execute on function public\.oauth_postgrest_guard\(\) to service_role/i);
  assert.doesNotMatch(setup.sql, /insert\s+into\s+auth\.(users|identities)/i);
});

const success = await fixture();
try {
  const { db, sessions } = success;
  const before = await snapshot(db);
  await test('Atomic source setup preserves existing school, Auth, identities, partner exams and guard body', async () => {
    assert.equal((await db.query("select has_function_privilege('service_role','public.oauth_postgrest_guard()','EXECUTE') allowed")).rows[0].allowed, false);
    await db.exec(setup.sql);
    assert.deepEqual(await snapshot(db), before);
  });
  await test('Seven private OAuth tables have RLS and no default clients or credentials', async () => {
    const tables = (await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='system_oauth' and c.relkind='r' order by c.relname")).rows;
    assert.equal(tables.length, 7); assert.ok(tables.every(row => row.relrowsecurity));
    assert.equal((await db.query('select count(*)::int count from system_oauth.clients')).rows[0].count, 0);
    for (const actor of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query("select has_schema_privilege($1,'system_oauth','USAGE') allowed", [actor])).rows[0].allowed, false);
    }
  });
  await test('The service role can execute the existing PostgREST guard without changing its body', async () => {
    assert.equal((await db.query("select has_function_privilege('service_role','public.oauth_postgrest_guard()','EXECUTE') allowed")).rows[0].allowed, true);
    await role(db, 'service_role', () => db.query('select public.oauth_postgrest_guard()'));
  });
  await test('Native OAuth client sessions remain blocked from direct Data API use', async () => {
    await role(db, 'authenticated', () => assert.rejects(() => db.query('select public.oauth_postgrest_guard()'), /OAUTH_DIRECT_DATABASE_DENIED/), { sub: ids.manager, aal: 'aal2', client_id: 'native-client' });
  });
  await test('Ordinary native login keeps existing student and manager account readiness', async () => {
    for (const [sub, aal, ready] of [[ids.student, 'aal1', true], [ids.initial, 'aal1', false], [ids.manager, 'aal1', false], [ids.manager, 'aal2', true]]) {
      await role(db, 'authenticated', async () => {
        await db.query('select public.oauth_postgrest_guard()');
        assert.equal((await db.query('select public.account_ready() ready')).rows[0].ready, ready);
      }, { sub, aal });
    }
  });
  await test('Manager session RPC accepts the actual current native TOTP session only', async () => {
    const good = sessions[ids.manager].session_id;
    const check = session => role(db, 'service_role', () => db.query('select public.assert_manager_session($1,$2) allowed', [ids.manager, session]));
    assert.equal((await check(good)).rows[0].allowed, true);
    for (const bad of [null, uuid(99999), sessions[ids.student].session_id]) await assert.rejects(() => check(bad), /MFA_REQUIRED/);
    await db.query("update auth.sessions set aal='aal1' where id=$1", [good]);
    await assert.rejects(() => check(good), /MFA_REQUIRED/);
    await db.query("update auth.sessions set aal='aal2',not_after=now()-interval '1 second' where id=$1", [good]);
    await assert.rejects(() => check(good), /MFA_REQUIRED/);
    await db.query('update auth.sessions set not_after=null where id=$1', [good]);
    await db.query("update auth.mfa_factors set status='unverified' where id=$1", [sessions[ids.manager].factor_id]);
    await assert.rejects(() => check(good), /MFA_REQUIRED/);
    await db.query("update auth.mfa_factors set status='verified' where id=$1", [sessions[ids.manager].factor_id]);
  });
  await test('Only the trusted service role can invoke the new security RPCs', async () => {
    for (const actor of ['anon', 'authenticated']) {
      for (const signature of ['public.oauth_operation(text,jsonb)', 'public.oauth_api(text,text,jsonb)', 'public.assert_manager_session(uuid,uuid)']) {
        assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [actor, signature])).rows[0].allowed, false);
      }
      await role(db, actor, () => assert.rejects(() => db.query('select public.assert_manager_session($1,$2)', [ids.manager, sessions[ids.manager].session_id]), /permission denied/));
    }
  });
  await test('Repeating installation refuses without changing any existing data or grants', async () => {
    const beforeRetry = await snapshot(db);
    await refuse(db);
    assert.deepEqual(await snapshot(db), beforeRetry);
    assert.equal((await db.query('select count(*)::int count from system_oauth.clients')).rows[0].count, 0);
  });
} finally { await success.db.close(); }

const failureCases = [
  ['Existing OAuth schema collision', db => db.exec('create schema system_oauth')],
  ['Existing OAuth RPC collision', db => db.exec('create function public.oauth_operation(text,jsonb) returns jsonb language sql as $$select null::jsonb$$')],
  ['Missing persisted Auth session AAL', db => db.exec('alter table auth.sessions drop column aal')],
  ['Missing existing PostgREST guard', db => db.exec('drop function public.oauth_postgrest_guard()')],
  ['No active manager', db => db.query('update profiles set active=false where id=$1', [ids.manager])],
  ['Manager still using an initial password', db => db.query('update profiles set must_change_password=true where id=$1', [ids.manager])],
  ['Deleted native manager', db => db.query('update auth.users set deleted_at=now() where id=$1', [ids.manager])],
  ['Banned native manager', db => db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [ids.manager])],
];
for (const [name, mutate] of failureCases) {
  await test(name + ' refuses atomically before new security objects', async () => {
    const { db } = await fixture();
    try {
      await mutate(db);
      const before = (await db.query('select id,active,must_change_password from profiles order by id')).rows;
      await refuse(db);
      assert.deepEqual((await db.query('select id,active,must_change_password from profiles order by id')).rows, before);
      assert.equal((await db.query("select to_regprocedure('public.assert_manager_session(uuid,uuid)') present")).rows[0].present, null);
      if (!name.startsWith('Existing OAuth schema')) assert.equal((await db.query("select to_regnamespace('system_oauth') present")).rows[0].present, null);
    } finally { await db.close(); }
  });
}

await test('Unexpected DDL failure after successful preflight rolls back the new schema, tables and grants', async () => {
  const { db } = await fixture();
  try {
    // The preflight's existing tables, helpers, Auth columns and ready manager
    // remain available, but adding the new requests FK must fail inside DDL.
    await db.exec('alter table public.profiles drop constraint profiles_pkey cascade');
    const before = await snapshot(db);
    await assert.rejects(() => db.exec(setup.sql), error =>
      ['42704', '42830'].includes(error.code) && /(?:no primary key|no unique constraint).*profiles|no unique constraint matching given keys/.test(error.message));
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db), before);
    assert.equal((await db.query("select to_regnamespace('system_oauth') present")).rows[0].present, null);
    assert.equal((await db.query("select to_regprocedure('public.assert_manager_session(uuid,uuid)') present")).rows[0].present, null);
    assert.equal((await db.query("select has_function_privilege('service_role','public.oauth_postgrest_guard()','EXECUTE') allowed")).rows[0].allowed, false);
  } finally { await db.close(); }
});

for (const actor of ['anon', 'authenticated', 'service_role']) {
  await test(actor + ' cannot run owner-only source setup', async () => {
    const { db } = await fixture();
    try {
      await db.exec('set role ' + actor);
      await refuse(db);
      await db.exec('reset role');
      assert.equal((await db.query("select to_regnamespace('system_oauth') present")).rows[0].present, null);
    } finally { await db.close(); }
  });
}

await test('Reviewed migration hash drift prevents source bundle generation', async () => {
  const root = await mkdtemp('/tmp/system-source-oauth-test-');
  try {
    await mkdir(path.join(root, 'supabase/migrations'), { recursive: true });
    for (const filename of ['20261007_oauth_connector.sql', '20261009_manager_session_guard.sql']) {
      await writeFile(path.join(root, 'supabase/migrations', filename), await readFile('supabase/migrations/' + filename));
    }
    const filename = path.join(root, 'supabase/migrations/20261007_oauth_connector.sql');
    await writeFile(filename, (await readFile(filename, 'utf8')) + '\n-- unreviewed source drift\n');
    await assert.rejects(() => generateSourceOAuthSetup({ root }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

console.log(`${passed} source OAuth setup checks passed; generated SHA-256 ${digest(setup.sql)}`);
