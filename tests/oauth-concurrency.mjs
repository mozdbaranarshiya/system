// Opt-in: node tests/oauth-concurrency.mjs --docker
// Genuine PostgreSQL sessions, verified blocking locks, and real repository SQL.
// PGlite is deliberately not used here: its single connection cannot prove races.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { seed, migrate, seedOAuthSessions, ids, uuid } from './fixtures.mjs';

if (!process.argv.includes('--docker')) {
  console.log('Not run: node tests/oauth-concurrency.mjs --docker requires Docker and postgres:17-alpine.');
  process.exit(0);
}
const docker = promisify(execFile), suffix = randomBytes(6).toString('hex');
const container = 'system-oauth-concurrency-' + suffix;
const directory = await mkdtemp(path.join(tmpdir(), 'system-oauth-concurrency-'));
const sessions = [];
let created = false, passed = 0, serial = 8000, authSessions;
const hash = value => createHash('sha256').update(value).digest('hex');
const callback = 'https://chatgpt.com/aip/concurrency-fixture/oauth/callback';
const clientId = 'concurrency-chatgpt-client';
const challenge = createHash('sha256').update('a'.repeat(43)).digest('base64url');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = async (...args) => (await docker('docker', args, { timeout: 60000, maxBuffer: 1024 * 1024 })).stdout.trim();
const literal = value => value === null ? 'null' : typeof value === 'number' ? String(value) : typeof value === 'boolean' ? String(value)
  : "'" + (Array.isArray(value) ? '{' + value.map(x => '"' + String(x).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"').join(',') + '}' : typeof value === 'object' ? JSON.stringify(value) : String(value)).replaceAll("'", "''") + "'";

class Session {
  constructor(name) {
    this.name = container + '-' + name;
    this.process = spawn('docker', ['exec', '-i', '--env', 'PGAPPNAME=' + this.name, container,
      'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = ''; this.stderr = ''; this.current = null;
    this.process.stdout.on('data', chunk => {
      this.buffer += chunk;
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n'), line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!this.current) continue;
        if (line === this.current.marker) { const current = this.current; this.current = null; clearTimeout(current.timeout); current.resolve(current.lines); }
        else this.current.lines.push(line);
      }
    });
    this.process.stderr.on('data', chunk => { this.stderr += chunk; });
    this.process.on('exit', code => { if (this.current) { clearTimeout(this.current.timeout); this.current.reject(new Error('psql exited ' + code + ': ' + this.stderr)); this.current = null; } });
    sessions.push(this);
  }
  raw(sql) {
    assert.equal(this.current, null, 'One command per PostgreSQL connection');
    const marker = 'done_' + randomBytes(8).toString('hex');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('PostgreSQL command timed out: ' + this.name)); this.process.kill(); }, 20000);
      this.current = { marker, lines: [], resolve, reject, timeout };
      this.process.stdin.write(sql + ";\nselect '" + marker + "';\n");
    });
  }
  async exec(sql) { await this.raw(sql); }
  async query(sql, values = []) {
    const rendered = sql.replace(/\$(\d+)/g, (_, n) => literal(values[Number(n) - 1]));
    if (!/^\s*select\b/i.test(rendered)) { await this.raw(rendered); return { rows: [] }; }
    const lines = await this.raw("select coalesce(json_agg(q),'[]'::json)::text from (" + rendered + ') q');
    return { rows: JSON.parse(lines.join('\n')) };
  }
  async op(action, data) {
    const { rows } = await this.query('select public.oauth_operation($1,$2::jsonb) value', [action, data]);
    return rows[0].value;
  }
  async api(token) { return (await this.query("select public.oauth_api($1,'me') value", [token])).rows[0].value; }
  close() { this.process.stdin.end(); this.process.kill(); }
}

async function blocked(db, session) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = (await db.query("select wait_event_type from pg_stat_activity where application_name=$1", [session.name])).rows;
    if (rows.some(row => row.wait_event_type === 'Lock')) return;
    await delay(10);
  }
  throw new Error(session.name + ' did not actually wait on a PostgreSQL lock');
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function pending(user = ids.student) {
  const n = serial++;
  return { client_id: clientId, redirect_uri: callback, scopes: ['profile.read'], state: 'state-' + n,
    code_challenge: challenge, session_id: authSessions[user].session_id, user_id: user, csrf_hash: hash('csrf-' + n), request_id: uuid(n),
    mfa_time: user === ids.manager ? Date.now() / 1000 : null };
}
function consent(request) { return { request_id: request.request_id, user_id: request.user_id, session_id: request.session_id,
  csrf_hash: request.csrf_hash, approve: true, code_hash: hash('code-' + request.request_id), mfa_time: request.mfa_time }; }
async function prepared(db, user) { const request = pending(user); assert.ok((await db.op('prepare', request)).request_id); return request; }
async function grant(db, user) {
  const request = await prepared(db, user), data = consent(request); assert.equal((await db.op('decide', data)).approved, true);
  const access = hash('access-' + request.request_id), refresh = hash('refresh-' + request.request_id);
  const exchange = { client_id: clientId, code_hash: data.code_hash, redirect_uri: callback, code_challenge: challenge, access_hash: access, refresh_hash: refresh };
  assert.equal((await db.op('exchange', exchange)).expires_in, 900);
  const grantId = (await db.query('select grant_id from system_oauth.codes where code_hash=$1', [data.code_hash])).rows[0].grant_id;
  return { request, data, access, refresh, exchange, grantId };
}

try {
  await run('image', 'inspect', 'postgres:17-alpine');
  await writeFile(path.join(directory, 'postgres.env'), 'POSTGRES_PASSWORD=' + randomBytes(32).toString('base64url') + '\n', { mode: 0o600 });
  await run('run', '--detach', '--name', container, '--label', 'system.oauth.concurrency-test=true', '--env-file', path.join(directory, 'postgres.env'), 'postgres:17-alpine'); created = true;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { if ((await run('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')).includes('accepting connections')) break; } catch {} await delay(100); }
  const db = new Session('control'), a = new Session('a'), b = new Session('b');
  await db.exec(`create extension pgcrypto; create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create table auth.users(id uuid primary key,email text,encrypted_password text default '',banned_until timestamptz,deleted_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users on delete cascade,status text not null,factor_type text not null);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,aal text not null,factor_id uuid,not_after timestamptz);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,service_role; grant all on storage.objects to authenticated;`);
  await db.exec(await readFile('supabase/schema.sql', 'utf8')); await seed(db); await migrate(db); authSessions = await seedOAuthSessions(db);
  await db.exec(await readFile('supabase/migrations/20261007_oauth_connector.sql', 'utf8'));
  await db.query('insert into system_oauth.clients(client_id,name,redirect_uris,allowed_scopes,public_client) values($1,$2,$3,$4,true)',
    [clientId, 'Concurrent ChatGPT test', [callback], ['profile.read']]);
  for (const session of [a, b]) await session.exec("set statement_timeout='15s'; set lock_timeout='12s'");

  await test('Disconnect wins: blocked consent is cancelled and cannot create a new grant', async () => {
    const existing = await grant(db), request = await prepared(db);
    await a.exec('begin'); assert.equal((await a.op('disconnect', { actor: ids.student, grant_id: existing.grantId })).ok, true);
    const result = b.op('decide', consent(request)); await blocked(db, b); await a.exec('commit');
    assert.equal((await result).error, 'invalid_request'); assert.equal((await db.api(existing.access)).error, 'invalid_token');
  });
  await test('Consent wins: disconnect waits and revokes the newly issued grant as well', async () => {
    const existing = await grant(db), request = await prepared(db);
    await a.exec('begin'); assert.equal((await a.op('decide', consent(request))).approved, true);
    const result = b.op('disconnect', { actor: ids.student, grant_id: existing.grantId }); await blocked(db, b); await a.exec('commit'); assert.equal((await result).ok, true);
    const connected = (await db.query('select count(*)::int n from system_oauth.grants where user_id=$1 and client_id=$2 and revoked_at is null', [ids.student, clientId])).rows[0].n;
    assert.equal(connected, 0);
  });
  await test('Concurrent disconnects selecting different grants finish without deadlock', async () => {
    const first = await grant(db), second = await grant(db);
    await a.exec('begin'); assert.equal((await a.op('disconnect', { actor: ids.student, grant_id: first.grantId })).ok, true);
    const result = b.op('disconnect', { actor: ids.student, grant_id: second.grantId }); await blocked(db, b); await a.exec('commit'); assert.equal((await result).ok, true);
  });
  for (const [name, update, restore] of [
    ['profile disabled', 'update public.profiles set active=false where id=' + literal(ids.student), 'update public.profiles set active=true where id=' + literal(ids.student)],
    ['role changed', "update public.profiles set role='teacher' where id=" + literal(ids.student), "update public.profiles set role='student' where id=" + literal(ids.student)],
    ['password changed', "update auth.users set encrypted_password=crypt('NewConcurrencyPassword!',gen_salt('bf')) where id=" + literal(ids.student), null],
    ['auth banned', "update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=" + literal(ids.student), 'update auth.users set banned_until=null where id=' + literal(ids.student)],
  ]) {
    await test(name + ' wins: consent waits on identity and cannot survive the security change', async () => {
      const request = await prepared(db); await a.exec('begin'); await a.exec(update);
      const result = b.op('decide', consent(request)); await blocked(db, b); await a.exec('commit'); assert.equal((await result).error, 'invalid_request');
      if (restore) await db.exec(restore);
    });
    await test('Consent wins before ' + name + ': security writer waits then revokes that new grant', async () => {
      const request = await prepared(db); await a.exec('begin'); assert.equal((await a.op('decide', consent(request))).approved, true);
      const result = b.exec(update); await blocked(db, b); await a.exec('commit'); await result;
      assert.ok((await db.query('select revoked_at from system_oauth.grants where id=(select grant_id from system_oauth.codes where code_hash=$1)', [consent(request).code_hash])).rows[0].revoked_at);
      if (restore) await db.exec(restore);
    });
  }
  await test('Client disable wins: blocked consent sees invalid client and no live request remains', async () => {
    const request = await prepared(db); await a.exec('begin'); assert.equal((await a.op('client_disable', { actor: ids.manager, session_id: authSessions[ids.manager].session_id, mfa_time: Date.now() / 1000, client_id: clientId })).ok, true);
    const result = b.op('decide', consent(request)); await blocked(db, b); await a.exec('commit'); assert.equal((await result).error, 'invalid_client');
    assert.ok((await db.query('select decided_at from system_oauth.requests where id=$1', [request.request_id])).rows[0].decided_at);
    await db.query('update system_oauth.clients set active=true where client_id=$1', [clientId]);
  });
  await test('Consent wins before client disable: disable waits then revokes the new grant', async () => {
    const request = await prepared(db); await a.exec('begin'); assert.equal((await a.op('decide', consent(request))).approved, true);
    const result = b.op('client_disable', { actor: ids.manager, session_id: authSessions[ids.manager].session_id, mfa_time: Date.now() / 1000, client_id: clientId }); await blocked(db, b); await a.exec('commit'); assert.equal((await result).ok, true);
    assert.ok((await db.query('select revoked_at from system_oauth.grants where id=(select grant_id from system_oauth.codes where code_hash=$1)', [consent(request).code_hash])).rows[0].revoked_at);
    await db.query('update system_oauth.clients set active=true where client_id=$1', [clientId]);
  });
  await test('Changed callback is revalidated after a concurrent client row lock', async () => {
    const request = await prepared(db); await a.exec('begin'); await a.query('update system_oauth.clients set redirect_uris=$1 where client_id=$2', [[callback + '/changed'], clientId]);
    const result = b.op('decide', consent(request)); await blocked(db, b); await a.exec('commit'); assert.equal((await result).error, 'invalid_request');
    await db.query('update system_oauth.clients set redirect_uris=$1 where client_id=$2', [[callback], clientId]);
  });
  await test('Consent that expires during a request lock wait cannot issue a code', async () => {
    const request = await prepared(db); await db.query("update system_oauth.requests set expires_at=clock_timestamp()+interval '200 milliseconds' where id=$1", [request.request_id]);
    await a.exec('begin'); await a.query('select id from system_oauth.requests where id=$1 for update', [request.request_id]);
    const result = b.op('decide', consent(request)); await blocked(db, b); await delay(250); await a.exec('commit'); assert.equal((await result).error, 'invalid_request');
  });
  await test('Manager MFA that expires during a lock wait cannot issue a code', async () => {
    const request = await prepared(db, ids.manager); request.mfa_time = Date.now() / 1000 - 599.8;
    await a.exec('begin'); await a.query('select id from system_oauth.requests where id=$1 for update', [request.request_id]);
    const result = b.op('decide', consent(request)); await blocked(db, b); await delay(250); await a.exec('commit'); assert.equal((await result).error, 'mfa_required');
  });
  for (const type of ['code', 'access', 'refresh']) await test(type + ' expiry is rechecked after a grant lock wait', async () => {
    const current = await grant(db);
    const table = { code: 'codes', access: 'access_tokens', refresh: 'refresh_tokens' }[type];
    const column = type === 'code' ? 'code_hash' : 'token_hash', token = type === 'code' ? current.data.code_hash : current[type];
    if (type === 'code') await db.query('update system_oauth.codes set consumed_at=null where code_hash=$1', [token]);
    await db.query('update system_oauth.' + table + " set expires_at=clock_timestamp()+interval '200 milliseconds' where " + column + '=$1', [token]);
    await a.exec('begin'); await a.query('select id from system_oauth.grants where id=$1 for update', [current.grantId]);
    const result = type === 'code' ? b.op('exchange', { ...current.exchange, access_hash: hash('late-' + serial++), refresh_hash: hash('late-refresh-' + serial++) })
      : type === 'access' ? b.api(current.access) : b.op('refresh', { client_id: clientId, refresh_hash: current.refresh, access_hash: hash('late-' + serial++), next_refresh_hash: hash('late-refresh-' + serial++) });
    await blocked(db, b); await delay(250); await a.exec('commit'); assert.equal((await result).error, type === 'access' ? 'invalid_token' : 'invalid_grant');
  });
  await test('Simultaneous code exchange consumes exactly once', async () => {
    const request = await prepared(db), data = consent(request); await db.op('decide', data);
    const exchange = { client_id: clientId, code_hash: data.code_hash, redirect_uri: callback, code_challenge: challenge, access_hash: hash('single-access-' + serial++), refresh_hash: hash('single-refresh-' + serial++) };
    await a.exec('begin'); assert.equal((await a.op('exchange', exchange)).expires_in, 900);
    const result = b.op('exchange', { ...exchange, access_hash: hash('duplicate-access-' + serial++), refresh_hash: hash('duplicate-refresh-' + serial++) });
    await blocked(db, b); await a.exec('commit'); assert.equal((await result).error, 'invalid_grant');
  });
  await test('Simultaneous refresh reuse revokes the freshly rotated family without deadlock', async () => {
    const current = await grant(db), access = hash('rotate-access-' + serial++), refresh = hash('rotate-refresh-' + serial++);
    await a.exec('begin'); assert.equal((await a.op('refresh', { client_id: clientId, refresh_hash: current.refresh, access_hash: access, next_refresh_hash: refresh })).expires_in, 900);
    const result = b.op('refresh', { client_id: clientId, refresh_hash: current.refresh, access_hash: hash('duplicate-' + serial++), next_refresh_hash: hash('duplicate-refresh-' + serial++) });
    await blocked(db, b); await a.exec('commit'); assert.equal((await result).error, 'invalid_grant'); assert.equal((await db.api(access)).error, 'invalid_token');
  });
  async function restoreManagerFactor() {
    const factor = uuid(serial++); authSessions[ids.manager].factor_id = factor;
    await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')", [factor, ids.manager]);
    await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2", [factor, authSessions[ids.manager].session_id]);
  }
  await test('Native factor-delete then session-downgrade wins: old MFA consent is rejected', async () => {
    const request = await prepared(db, ids.manager);
    await a.exec('begin'); await a.query('delete from auth.mfa_factors where id=$1', [authSessions[ids.manager].factor_id]);
    await a.query("update auth.sessions set aal='aal1',factor_id=null where id=$1", [authSessions[ids.manager].session_id]);
    assert.equal((await b.op('decide', consent(request))).error, 'temporarily_unavailable');
    await a.exec('commit'); assert.equal((await b.op('decide', consent(request))).error, 'mfa_required');
    await restoreManagerFactor();
  });
  await test('Native session-before-user update cannot deadlock consent identity-before-session', async () => {
    const request = await prepared(db, ids.manager);
    await a.exec('begin'); await a.query('select id from auth.sessions where id=$1 for update', [authSessions[ids.manager].session_id]);
    await b.exec('begin'); await b.query('select id from auth.users where id=$1 for share', [ids.manager]);
    // The native MFA transaction now waits on consent's auth.users SHARE lock.
    const nativeUserUpdate = a.query('update auth.users set email=email where id=$1', [ids.manager]); await blocked(db, a);
    // The opposite session lock must fail promptly, not complete a wait cycle.
    assert.equal((await b.op('decide', consent(request))).error, 'temporarily_unavailable');
    await b.exec('commit'); await nativeUserUpdate; await a.exec('commit');
    assert.equal((await db.op('decide', consent(request))).approved, true, 'Retry succeeds after the native transaction completes');
  });
  await test('Concurrent native MFA unenrollment waits on consent without deadlock, then invalidates its code', async () => {
    const request = await prepared(db, ids.manager), data = consent(request);
    await a.exec('begin'); await a.query('delete from auth.mfa_factors where id=$1', [authSessions[ids.manager].factor_id]);
    await b.exec('begin'); assert.equal((await b.op('decide', data)).approved, true);
    const downgrade = a.query("update auth.sessions set aal='aal1',factor_id=null where id=$1", [authSessions[ids.manager].session_id]);
    await blocked(db, a); await b.exec('commit'); await downgrade; await a.exec('commit');
    assert.equal((await db.op('exchange', { client_id: clientId, code_hash: data.code_hash, redirect_uri: callback, code_challenge: challenge,
      access_hash: hash('unenrolled-access-' + serial++), refresh_hash: hash('unenrolled-refresh-' + serial++) })).error, 'invalid_grant');
    await restoreManagerFactor();
  });
  await test('Removing the exact MFA factor invalidates existing manager access and refresh credentials', async () => {
    const current = await grant(db, ids.manager);
    await db.query('delete from auth.mfa_factors where id=$1', [authSessions[ids.manager].factor_id]);
    await db.query("update auth.sessions set aal='aal1',factor_id=null where id=$1", [authSessions[ids.manager].session_id]);
    assert.equal((await db.api(current.access)).error, 'invalid_token');
    assert.equal((await db.op('refresh', { client_id: clientId, refresh_hash: current.refresh, access_hash: hash('unenrolled-rotated-' + serial++), next_refresh_hash: hash('unenrolled-rotated-refresh-' + serial++) })).error, 'invalid_grant');
    await restoreManagerFactor(); assert.equal((await db.api(current.access)).error, 'invalid_token', 'A new factor cannot resurrect grants issued to a deleted factor');
  });
  await test('Cleanup and disconnect share grant-before-request ordering without deadlock', async () => {
    const current = await grant(db), request = await prepared(db);
    await db.query("update system_oauth.grants set created_at=clock_timestamp()-interval '32 days' where id=$1", [current.grantId]);
    await db.query("update system_oauth.codes set expires_at=clock_timestamp()-interval '32 days' where grant_id=$1", [current.grantId]);
    await db.query("update system_oauth.access_tokens set expires_at=clock_timestamp()-interval '32 days' where grant_id=$1", [current.grantId]);
    await db.query("update system_oauth.refresh_tokens set expires_at=clock_timestamp()-interval '32 days' where grant_id=$1", [current.grantId]);
    await db.query("update system_oauth.requests set expires_at=clock_timestamp()-interval '1 minute' where id=$1", [request.request_id]);
    await a.exec('begin'); await a.query('select id from system_oauth.grants where id=$1 for update', [current.grantId]);
    const cleanup = b.query('select public.oauth_cleanup() value'); await blocked(db, b);
    assert.equal((await a.op('disconnect', { actor: ids.student, grant_id: current.grantId })).ok, true);
    await a.exec('commit'); assert.ok((await cleanup).rows[0].value.grants >= 1);
  });
  console.log('Real PostgreSQL OAuth concurrency tests: ' + passed + ' passed.');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  for (const session of sessions) session.close();
  if (created) await run('rm', '--force', '--volumes', container).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
