// The production HTTP handler and all repository PostgreSQL functions run here.
// Only Supabase Auth's /user signature/session validation is a test double;
// genuine password/TOTP behavior is exercised by auth-live.mjs --docker.
// No hosted database, config.js, production credentials or external network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { database } from './database-setup.mjs';
import { seed, migrate, rpc, ids, uuid } from './fixtures.mjs';

globalThis.crypto ??= webcrypto;
const source = stripTypeScriptTypes(await readFile('supabase/functions/oauth-connector/handler.ts', 'utf8'), { mode: 'transform' });
const { makeHandler } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const db = await database();
const base = 'https://auth.integration.invalid', site = 'https://school.integration.invalid';
const endpoint = base + '/functions/v1/oauth-connector';
const callback = 'https://chatgpt.com/aip/integration-fixture/oauth/callback';
const allScopes = ['profile.read', 'classes.read', 'grades.read', 'assignments.read'];
const hash = text => createHash('sha256').update(text).digest('hex');
const challenge = text => createHash('sha256').update(text).digest('base64url');
const authSessions = new Map();
const persistedSessions = new Map();
const importedSessions = new Set(), importedFactors = new Set();
let serial = 5000, passed = 0, app, publicApp;
function session(user, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user, session_id: uuid(serial++), role: 'authenticated', aud: 'authenticated',
    iss: base + '/auth/v1', exp: now + 3600, aal: 'aal1', amr: [{ method: 'password', timestamp: now }], ...overrides };
  const token = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' +
    Buffer.from(JSON.stringify(claims)).toString('base64url') + '.auth-test-double-' + randomBytes(12).toString('hex');
  authSessions.set(token, { id: user });
  const factorId = claims.aal === 'aal2' ? uuid(serial++) : null;
  persistedSessions.set(claims.session_id, { user, aal: claims.aal, factorId });
  return token;
}
const studentSession = session(ids.student), teacherSession = session(ids.teacher), classmateSession = session(ids.classmate);
const managerPassword = session(ids.manager);
const managerSession = session(ids.manager, { session_id: JSON.parse(Buffer.from(managerPassword.split('.')[1], 'base64url').toString()).session_id,
  aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }] });
const handler = makeHandler({
  env: name => ({ SUPABASE_URL: base, OAUTH_SITE_URL: site,
    SUPABASE_ANON_KEY: 'integration-public-key', SUPABASE_SERVICE_ROLE_KEY: 'integration-service-key' })[name],
  fetch: async (url, init = {}) => {
    if (url === base + '/auth/v1/user') {
      assert.equal(init.headers.apikey, 'integration-public-key');
      const user = authSessions.get((init.headers.Authorization || '').slice(7));
      return new Response(JSON.stringify(user || { error: 'invalid_token' }), { status: user ? 200 : 401 });
    }
    assert.match(url, /^https:\/\/auth\.integration\.invalid\/rest\/v1\/rpc\/(oauth_operation|oauth_api)$/);
    assert.equal(init.headers.apikey, 'integration-service-key');
    assert.equal(init.headers.Authorization, 'Bearer integration-service-key');
    const name = url.split('/').at(-1), args = JSON.parse(init.body);
    // Explicit Auth test-double state is independent of request JWT claims;
    // existing rows are never reset, so downgrade/deletion remains authoritative.
    for (const [sessionId, state] of persistedSessions) {
      if (state.factorId && !importedFactors.has(state.factorId)) {
        await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp') on conflict(id) do nothing", [state.factorId, state.user]);
        importedFactors.add(state.factorId);
      }
      if (!importedSessions.has(sessionId)) {
        await db.query('insert into auth.sessions(id,user_id,aal,factor_id) values($1,$2,$3,$4) on conflict(id) do nothing', [sessionId, state.user, state.aal, state.factorId]);
        importedSessions.add(sessionId);
      }
    }
    await db.exec('set role service_role');
    try {
      return new Response(JSON.stringify(await rpc(db, name, args)), { status: 200,
        headers: { 'Content-Type': 'application/json' } });
    } finally { await db.exec('reset role'); }
  },
});
async function invoke(path, { token, data, query, method = data === undefined ? 'GET' : 'POST', form = false, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (path.startsWith('/account/') || ['/oauth/prepare', '/oauth/decision'].includes(path)) headers.Origin = origin ?? site;
  else if (origin) headers.Origin = origin;
  if (data !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
  const response = await handler(new Request(endpoint + path + (query ? '?' + new URLSearchParams(query) : ''), {
    method, headers, body: data === undefined ? undefined : form ? new URLSearchParams(data).toString() : JSON.stringify(data),
  }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}
function error(result, code, status = 400) {
  assert.equal(result.status, status); assert.deepEqual(result.body, { error: code });
}
function authorization(scopes = allScopes, client = app) {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, input: { client_id: client.client_id, redirect_uri: callback, response_type: 'code',
    scope: scopes.join(' '), state: 'fixture-state-+&' + serial++, code_challenge: challenge(verifier), code_challenge_method: 'S256' } };
}
async function prepare(token = studentSession, auth = authorization()) {
  const result = await invoke('/oauth/prepare', { token, data: auth.input });
  assert.equal(result.status, 200); assert.ok(result.body.request_id && result.body.csrf_token);
  return { ...auth, ...result.body };
}
async function decide(prepared, token = studentSession, approve = true) {
  return invoke('/oauth/decision', { token, data: { request_id: prepared.request_id, csrf_token: prepared.csrf_token, approve } });
}
async function consent(token = studentSession, auth = authorization()) {
  const prepared = await prepare(token, auth), result = await decide(prepared, token);
  assert.equal(result.status, 200);
  const redirect = new URL(result.body.redirect_url);
  assert.equal(redirect.searchParams.get('state'), auth.input.state); assert.equal(redirect.origin, new URL(callback).origin);
  const code = redirect.searchParams.get('code'); assert.match(code, /^soc_[A-Za-z0-9_-]{43}$/);
  return { ...prepared, code };
}
async function exchange(approved, overrides = {}, client = app) {
  return invoke('/oauth/token', { form: true, data: { grant_type: 'authorization_code', client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}), code: approved.code,
    redirect_uri: callback, code_verifier: approved.verifier, ...overrides } });
}
async function grant(token = studentSession, scopes = allScopes, client = app) {
  const approved = await consent(token, authorization(scopes, client)), result = await exchange(approved, {}, client);
  assert.equal(result.status, 200); assert.equal(result.body.expires_in, 900); assert.equal(result.body.token_type, 'Bearer');
  assert.match(result.body.access_token, /^soa_[A-Za-z0-9_-]{43}$/); assert.match(result.body.refresh_token, /^sor_[A-Za-z0-9_-]{43}$/);
  const grantId = (await db.query('select grant_id from system_oauth.codes where code_hash=$1', [hash(approved.code)])).rows[0].grant_id;
  return { ...result.body, grantId, approved };
}
const api = (tokens, resource = 'me', query) => invoke('/api/' + resource, { token: tokens.access_token, query });
const refresh = (tokens, overrides = {}, client = app) => invoke('/oauth/token', { form: true, data: {
  grant_type: 'refresh_token', client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}),
  refresh_token: tokens.refresh_token, ...overrides,
} });
const revoke = (token, client = app) => invoke('/oauth/revoke', { form: true, data: {
  client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}), token,
} });
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS HTTP + PostgreSQL: ' + name); }
  catch (failure) { throw new Error(name, { cause: failure }); }
  finally { await db.query('delete from system_oauth.rate_limits'); }
}

try {
  await seed(db); await migrate(db);
  await db.exec(await readFile('supabase/migrations/20261007_oauth_connector.sql', 'utf8'));
  await test('real manager permission and server-derived fresh MFA govern client registration', async () => {
    const data = { name: 'ChatGPT integration', redirect_uris: [callback], allowed_scopes: allScopes, public_client: false, pkce_required: true };
    error(await invoke('/account/admin/clients', { token: teacherSession, data }), 'access_denied', 403);
    error(await invoke('/account/admin/clients', { token: managerPassword, data: { ...data, mfa_verified: true, mfa_time: Date.now(), role: 'manager' } }), 'mfa_required', 403);
    const result = await invoke('/account/admin/clients', { token: managerSession, data }); assert.equal(result.status, 201); app = result.body;
    assert.ok(app.client_id && app.client_secret);
    const stored = (await db.query('select secret_hash,public_client from system_oauth.clients where client_id=$1', [app.client_id])).rows[0];
    assert.equal(stored.secret_hash, hash(app.client_secret)); assert.equal(stored.public_client, false);
    const pub = await invoke('/account/admin/clients', { token: managerSession, data: { ...data, name: 'Public integration', public_client: true } });
    assert.equal(pub.status, 201); assert.ok(!pub.body.client_secret); publicApp = pub.body;
  });
  await test('authorization validates registered exact callback, state, scopes and S256', async () => {
    const auth = authorization(), result = await invoke('/oauth/authorize', { query: auth.input });
    assert.equal(result.status, 302);
    const redirect = new URL(result.headers.get('location'));
    assert.equal(redirect.origin, site); assert.equal(redirect.searchParams.get('oauth'), '1');
    assert.equal(redirect.searchParams.get('state'), auth.input.state);
    for (const [overrides, code, status] of [[{ client_id: uuid(9999) }, 'invalid_client', 401],
      [{ redirect_uri: callback + '/' }, 'invalid_request', 400], [{ state: '' }, 'invalid_request', 400],
      [{ scope: 'students.write' }, 'invalid_scope', 400], [{ code_challenge_method: 'plain' }, 'invalid_request', 400],
      [{ code_challenge: '' }, 'invalid_request', 400]]) {
      const rejected = await invoke('/oauth/authorize', { query: { ...auth.input, ...overrides } });
      if (overrides.client_id || overrides.redirect_uri) error(rejected, code, status);
      else {
        assert.equal(rejected.status, 302);
        const location = new URL(rejected.headers.get('location'));
        assert.equal(location.origin, new URL(callback).origin); assert.equal(location.pathname, new URL(callback).pathname);
        assert.equal(location.searchParams.get('error'), code);
        if (overrides.state !== '') assert.equal(location.searchParams.get('state'), auth.input.state);
      }
    }
  });
  await test('verified current session is required; unknown or forged identities cannot prepare', async () => {
    const auth = authorization();
    error(await invoke('/oauth/prepare', { token: studentSession + '-tampered', data: auth.input }), 'invalid_token', 401);
    const expired = session(ids.student, { exp: 0 });
    error(await invoke('/oauth/prepare', { token: expired, data: auth.input }), 'invalid_token', 401);
    const prepared = await prepare(studentSession, { ...auth, input: { ...auth.input, user_id: ids.manager,
      role: 'manager', session_id: uuid(9998), mfa_verified: true, mfa_time: Date.now() } });
    const row = (await db.query('select user_id,session_id,csrf_hash from system_oauth.requests where id=$1', [prepared.request_id])).rows[0];
    assert.equal(row.user_id, ids.student); assert.equal(row.csrf_hash, hash(prepared.csrf_token));
  });
  await test('manager password-only, expired MFA and untrusted client MFA never issue a code', async () => {
    const auth = authorization();
    error(await invoke('/oauth/prepare', { token: managerPassword, data: { ...auth.input, mfa_verified: true, role: 'student' } }), 'mfa_required', 403);
    const stale = session(ids.manager, { aal: 'aal2', amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - 601 }] });
    error(await invoke('/oauth/prepare', { token: stale, data: auth.input }), 'mfa_required', 403);
    const fresh = await prepare(managerSession, auth);
    error(await decide(fresh, managerPassword), 'mfa_required', 403);
    assert.equal((await db.query('select count(*)::int n from system_oauth.codes c join system_oauth.grants g on c.grant_id=g.id where g.user_id=$1', [ids.manager])).rows[0].n, 0);
    assert.equal((await decide(fresh, managerSession)).status, 200);
  });
  await test('denial preserves state and issues no authorization code', async () => {
    const before = (await db.query('select count(*)::int n from system_oauth.codes')).rows[0].n;
    const prepared = await prepare(), result = await decide(prepared, studentSession, false);
    assert.equal(result.status, 200); const redirect = new URL(result.body.redirect_url);
    assert.equal(redirect.searchParams.get('error'), 'access_denied'); assert.equal(redirect.searchParams.get('state'), prepared.input.state);
    assert.equal(redirect.searchParams.has('code'), false);
    assert.equal((await db.query('select count(*)::int n from system_oauth.codes')).rows[0].n, before);
  });
  await test('consent is bound to user, session and single-use server-side CSRF challenge', async () => {
    const prepared = await prepare();
    error(await invoke('/oauth/decision', { token: studentSession, data: { request_id: prepared.request_id, csrf_token: randomBytes(32).toString('base64url'), approve: true } }), 'invalid_request');
    error(await decide(prepared, classmateSession), 'invalid_request');
    error(await decide(prepared, session(ids.student)), 'invalid_request');
    assert.equal((await decide(prepared)).status, 200); error(await decide(prepared), 'invalid_request');
  });
  await test('expired consent is rejected before code issuance', async () => {
    const prepared = await prepare();
    await db.query("update system_oauth.requests set expires_at=clock_timestamp()-interval '1 second' where id=$1", [prepared.request_id]);
    error(await decide(prepared), 'invalid_request');
  });
  await test('code exchange enforces client authentication, exact redirect, PKCE and one use', async () => {
    const approved = await consent();
    error(await exchange(approved, { client_secret: 'wrong-fixture-secret' }), 'invalid_client', 401);
    error(await exchange(approved, { redirect_uri: callback + '/' }), 'invalid_grant');
    error(await exchange(approved, { code_verifier: randomBytes(32).toString('base64url') }), 'invalid_grant');
    assert.equal((await exchange(approved)).status, 200); error(await exchange(approved), 'invalid_grant');
    const publicGrant = await grant(studentSession, ['profile.read'], publicApp);
    assert.equal((await api(publicGrant)).body.id, ids.student);
  });
  await test('expired authorization code cannot exchange', async () => {
    const approved = await consent();
    await db.query("update system_oauth.codes set expires_at=clock_timestamp()-interval '1 second' where code_hash=$1", [hash(approved.code)]);
    error(await exchange(approved), 'invalid_grant');
  });
  const student = await grant(), teacher = await grant(teacherSession), manager = await grant(managerSession);
  await db.query('delete from system_oauth.rate_limits');
  await test('all three real roles resolve minimal current-user identity', async () => {
    for (const [tokens, id] of [[student, ids.student], [teacher, ids.teacher], [manager, ids.manager]]) {
      const result = await api(tokens); assert.equal(result.status, 200); assert.equal(result.body.id, id);
      assert.deepEqual(Object.keys(result.body).sort(), ['display_name', 'id']);
      assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    }
  });
  await test('scope checks are independent of internal user permission', async () => {
    const narrow = await grant(managerSession, ['profile.read']);
    assert.equal((await api(narrow)).status, 200);
    for (const resource of ['classes', 'grades', 'assignments']) error(await api(narrow, resource), 'insufficient_scope', 403);
  });
  await test('student cannot read another student or unassigned class', async () => {
    assert.deepEqual((await api(student, 'classes')).body.rows.map(x => x.id), [ids.class]);
    assert.ok((await api(student, 'grades')).body.rows.every(x => x.student_id === ids.student));
    error(await api(student, 'classes', { class_id: ids.otherClass }), 'access_denied', 403);
    error(await api(student, 'grades', { student_id: ids.classmate }), 'access_denied', 403);
    error(await api(student, 'grades', { student_id: ids.otherStudent }), 'access_denied', 403);
    error(await api(student, 'assignments', { class_id: ids.otherClass }), 'access_denied', 403);
  });
  await test('teacher authorization checks actual assigned class and subject', async () => {
    await db.query("insert into scores(student_id,class_id,subject_id,period,continuous_score,final_score) values($1,$2,$3,'نوبت اول',17,19)", [ids.student, ids.class, ids.otherSubject]);
    assert.deepEqual((await api(teacher, 'classes')).body.rows.map(x => x.id), [ids.class]);
    const grades = (await api(teacher, 'grades')).body.rows;
    assert.equal(grades.length, 2); assert.ok(grades.every(x => x.subject_id === ids.subject));
    error(await api(teacher, 'classes', { class_id: ids.otherClass }), 'access_denied', 403);
    error(await api(teacher, 'grades', { student_id: ids.otherStudent }), 'access_denied', 403);
    error(await api(teacher, 'assignments', { class_id: ids.otherClass }), 'access_denied', 403);
  });
  await test('manager reads follow repository manager permission and expose no national IDs', async () => {
    assert.equal((await api(manager, 'classes')).body.rows.length, 2);
    const grades = (await api(manager, 'grades')).body; assert.equal(grades.rows.length, 3);
    assert.equal(JSON.stringify(grades).includes('national_id'), false);
  });
  await test('report-card visibility remains authoritative for OAuth students', async () => {
    await db.query('update school_settings set report_cards_open=false where id=true');
    error(await api(student, 'grades'), 'access_denied', 403); assert.equal((await api(teacher, 'grades')).status, 200);
    await db.query('update school_settings set report_cards_open=true where id=true');
  });
  await test('ID filters, unregistered proxy fields and unsafe pagination cannot bypass policies', async () => {
    for (const query of [{ class_id: 'invalid' }, { role: 'manager' }, { table: 'auth.users' }, { limit: '101' }, { limit: '0' }, { offset: '-1' }]) error(await api(student, 'classes', query), 'invalid_request');
    assert.equal((await api(student, 'grades', { limit: '1', offset: '1' })).body.rows.length, 1);
  });
  await test('access expiry and unknown tokens reject protected API calls', async () => {
    const expired = await grant();
    await db.query("update system_oauth.access_tokens set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", [hash(expired.access_token)]);
    error(await api(expired), 'invalid_token', 401);
    error(await api({ access_token: 'soa_' + randomBytes(32).toString('base64url') }), 'invalid_token', 401);
  });
  await test('refresh rotates, preserves family deadline and cannot broaden scopes', async () => {
    const current = await grant();
    const deadline = (await db.query('select expires_at from system_oauth.refresh_tokens where token_hash=$1', [hash(current.refresh_token)])).rows[0].expires_at;
    error(await refresh(current, { scope: 'profile.read reports.read' }), 'invalid_scope');
    const next = await refresh(current, { scope: 'profile.read' }); assert.equal(next.status, 200);
    assert.ok(next.body.refresh_token !== current.refresh_token); assert.ok(next.body.access_token !== current.access_token);
    assert.equal((await api(next.body)).body.id, ids.student); error(await api(next.body, 'grades'), 'insufficient_scope', 403);
    assert.deepEqual((await db.query('select expires_at from system_oauth.refresh_tokens where token_hash=$1', [hash(next.body.refresh_token)])).rows[0].expires_at, deadline);
    error(await refresh(next.body, { scope: allScopes.join(' ') }), 'invalid_scope');
  });
  await test('refresh reuse revokes old and new access plus the whole family', async () => {
    const current = await grant(), next = await refresh(current); assert.equal(next.status, 200);
    error(await refresh(current), 'invalid_grant');
    error(await api(current), 'invalid_token', 401); error(await api(next.body), 'invalid_token', 401);
    error(await refresh(next.body), 'invalid_grant');
    assert.equal((await db.query("select count(*)::int n from audit_logs where action='OAUTH_REFRESH_REUSE' and record_id=$1", [current.grantId])).rows[0].n, 1);
  });
  await test('expired refresh is rejected without issuance', async () => {
    const current = await grant();
    await db.query("update system_oauth.refresh_tokens set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", [hash(current.refresh_token)]);
    error(await refresh(current), 'invalid_grant');
  });
  await test('revocation is idempotent and client-bound and invalidates access plus refresh', async () => {
    const current = await grant();
    assert.equal((await revoke(current.refresh_token, publicApp)).status, 200); assert.equal((await api(current)).status, 200);
    assert.equal((await revoke(current.refresh_token)).status, 200); assert.equal((await revoke(current.refresh_token)).status, 200);
    error(await api(current), 'invalid_token', 401); error(await refresh(current), 'invalid_grant');
  });
  await test('Connected Apps is private and disconnect invalidates every same-client family', async () => {
    const first = await grant(classmateSession), second = await grant(classmateSession);
    const pendingRequest = await prepare(classmateSession);
    const apps = await invoke('/account/connections', { token: classmateSession }); assert.equal(apps.status, 200);
    assert.ok(apps.body.connections.some(x => x.id === first.grantId)); assert.equal(JSON.stringify(apps.body).includes('token_hash'), false);
    error(await invoke('/account/disconnect', { token: studentSession, data: { grant_id: first.grantId, user_id: ids.classmate, admin: true } }), 'access_denied', 403);
    assert.equal((await invoke('/account/disconnect', { token: classmateSession, data: { grant_id: first.grantId } })).status, 200);
    for (const tokens of [first, second]) { error(await api(tokens), 'invalid_token', 401); error(await refresh(tokens), 'invalid_grant'); }
    error(await decide(pendingRequest, classmateSession), 'invalid_request');
    assert.deepEqual((await invoke('/account/connections', { token: classmateSession })).body.connections, []);
  });
  await test('manager administrative revocation still needs real permission and recent MFA', async () => {
    const current = await grant(classmateSession), data = { grant_id: current.grantId };
    error(await invoke('/account/admin/revoke', { token: teacherSession, data }), 'access_denied', 403);
    error(await invoke('/account/admin/revoke', { token: managerPassword, data }), 'mfa_required', 403);
    assert.equal((await invoke('/account/admin/revoke', { token: managerSession, data })).status, 200);
    error(await api(current), 'invalid_token', 401);
  });
  await test('account disable and role change invalidate existing grants immediately', async () => {
    const current = await grant(classmateSession);
    await db.query('update profiles set active=false where id=$1', [ids.classmate]);
    error(await api(current), 'invalid_token', 401); error(await refresh(current), 'invalid_grant');
    error(await invoke('/oauth/prepare', { token: classmateSession, data: authorization().input }), 'account_not_ready', 403);
    await db.query('update profiles set active=true where id=$1', [ids.classmate]); error(await api(current), 'invalid_token', 401);
    const changed = await grant(classmateSession);
    await db.query("update profiles set role='manager' where id=$1", [ids.classmate]);
    error(await api(changed), 'invalid_token', 401);
    error(await invoke('/oauth/prepare', { token: classmateSession, data: authorization().input }), 'mfa_required', 403);
    await db.query("update profiles set role='student' where id=$1", [ids.classmate]);
  });
  await test('removing current teacher assignment removes OAuth access without token replacement', async () => {
    await db.query('delete from teacher_assignments where teacher_id=$1', [ids.teacher]);
    for (const resource of ['classes', 'grades', 'assignments']) assert.deepEqual((await api(teacher, resource)).body.rows, []);
  });
  await test('disabled OAuth client revokes existing grants and blocks authorization', async () => {
    error(await invoke('/account/admin/clients/disable', { token: teacherSession, data: { client_id: app.client_id } }), 'access_denied', 403);
    assert.equal((await invoke('/account/admin/clients/disable', { token: managerSession, data: { client_id: app.client_id } })).status, 200);
    error(await api(student), 'invalid_token', 401); error(await refresh(student), 'invalid_client', 401);
    error(await invoke('/oauth/authorize', { query: authorization().input }), 'invalid_client', 401);
  });
  console.log('OAuth production HTTP + actual PostgreSQL integration: ' + passed + ' passed; Auth /user is explicitly mocked.');
} finally { await db.close(); }
