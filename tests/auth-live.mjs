// Opt-in integration: node tests/auth-live.mjs --docker
// Runs genuine Supabase Auth password/TOTP requests, the production OAuth handler
// and actual repository PostgreSQL RPCs in PGlite. The RPC adapter imports only
// current session/factor metadata from this private Auth PostgreSQL instance;
// it never mocks Auth or imports TOTP seeds into application RPC storage.
// Never uses config.js or hosted credentials.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { database } from './database-setup.mjs';
import { migrate, rpc, uuid } from './fixtures.mjs';

if (!process.argv.includes('--docker')) {
  console.log('Not run: opt in with node tests/auth-live.mjs --docker (Docker and official images required).');
  process.exit(0);
}
const docker = promisify(execFile);
// Auth version is pinned by the official Supabase self-hosted compose file.
// Docker verifies registry TLS and image-layer digests; no insecure registry flags.
const AUTH_IMAGE = 'supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232';
const PG_IMAGE = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const suffix = randomBytes(6).toString('hex');
const network = 'system-oauth-test-' + suffix;
const postgres = network + '-db', authContainer = network + '-auth';
const directory = await mkdtemp(path.join(tmpdir(), 'system-oauth-test-'));
const password = randomBytes(24).toString('base64url');
const jwtSecret = randomBytes(48).toString('base64url');
const encryptionKey = randomBytes(32).toString('base64url');
const base = 'https://auth.test.invalid', site = 'https://system.test.invalid';
let db, count = 0, authURL, createdNetwork = false;
const containers = [];
const run = async (...args) => (await docker('docker', args, { timeout: 300000, maxBuffer: 1024 * 1024 })).stdout.trim();
const check = async (name, fn) => {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (error) { throw new Error(name + ': ' + error.message); }
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(name, fn) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch { /* not ready yet */ }
    await delay(250);
  }
  throw new Error(name + ' did not become ready within 60 seconds');
}
function jwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return header + '.' + payload + '.' + createHmac('sha256', jwtSecret).update(header + '.' + payload).digest('base64url');
}
const adminToken = jwt({ role: 'service_role', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
function verifySigned(token) {
  const [head, body, signature] = token.split('.');
  assert.ok(signature === createHmac('sha256', jwtSecret).update(head + '.' + body).digest('base64url'), 'Auth token signature must verify');
  return claims(token);
}
async function authRequest(route, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(authURL + route, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.toUpperCase().replace(/=+$/, '')) {
    const value = alphabet.indexOf(character); assert.ok(value >= 0, 'Valid standard base32 TOTP secret');
    bits += value.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function cleanup() {
  if (db) await db.close().catch(() => {});
  for (const container of containers.reverse()) await run('rm', '--force', '--volumes', container).catch(() => {});
  if (createdNetwork) await run('network', 'rm', network).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
try {
  await run('version', '--format', '{{.Server.Version}}');
  for (const image of [PG_IMAGE, AUTH_IMAGE]) {
    try { await run('image', 'inspect', image); } catch { await run('pull', image); }
  }
  await writeFile(path.join(directory, 'postgres.env'), 'POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=postgres\n', { mode: 0o600 });
  await writeFile(path.join(directory, 'auth.env'), Object.entries({
    GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: base + '/auth/v1',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://postgres:${password}@${postgres}:5432/postgres`,
    GOTRUE_SITE_URL: site, GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_ISSUER: base + '/auth/v1',
    GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
    GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT: 'true', GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY_ID: 'local',
    GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY: encryptionKey,
    GOTRUE_SECURITY_DB_ENCRYPTION_DECRYPTION_KEYS: 'local:' + encryptionKey,
  }).map(([key, value]) => key + '=' + value).join('\n') + '\n', { mode: 0o600 });
  await run('network', 'create', '--label', 'system.oauth.live-test=true', network); createdNetwork = true;
  await run('run', '--detach', '--name', postgres, '--label', 'system.oauth.live-test=true', '--network', network,
    '--env-file', path.join(directory, 'postgres.env'), PG_IMAGE); containers.push(postgres);
  await waitFor('PostgreSQL', async () => (await run('exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres')).includes('accepting connections'));
  // Plain PostgreSQL does not include the auth namespace present in Supabase's
  // database image; GoTrue owns and migrates this dedicated schema thereafter.
  await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    'create schema auth; alter role postgres set search_path=auth,public');
  await run('run', '--detach', '--name', authContainer, '--label', 'system.oauth.live-test=true', '--network', network,
    '--publish', '127.0.0.1::9999', '--env-file', path.join(directory, 'auth.env'), AUTH_IMAGE); containers.push(authContainer);
  const binding = await run('port', authContainer, '9999/tcp');
  assert.ok(/^127\.0\.0\.1:\d+$/.test(binding), 'Auth exposes only a loopback test port');
  authURL = 'http://' + binding;
  try {
    await waitFor('Supabase Auth', async () => (await fetch(authURL + '/health', { signal: AbortSignal.timeout(1000) })).ok);
  } catch {
    // Report only the startup failure field, with every local credential removed;
    // never print complete container logs, configuration or API responses.
    const logResult = await docker('docker', ['logs', authContainer], { timeout: 15000, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: '', stderr: '' }));
    const logs = logResult.stdout + '\n' + logResult.stderr;
    let diagnosis = 'health endpoint unavailable';
    for (const line of logs.split('\n')) {
      try { const entry = JSON.parse(line); if (entry.level === 'fatal' || entry.level === 'error') diagnosis = String(entry.error || entry.msg || diagnosis).split('\n').at(-1); }
      catch { /* omit unstructured log lines */ }
    }
    for (const secret of [password, jwtSecret, encryptionKey, adminToken]) diagnosis = diagnosis.replaceAll(secret, '[redacted]');
    diagnosis = diagnosis.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]');
    throw new Error('Supabase Auth startup: ' + diagnosis.slice(0, 500));
  }

  const users = {};
  await check('real signup and password hashes for manager and student', async () => {
    for (const role of ['manager', 'student']) {
      const result = await authRequest('/signup', { body: { email: role + '@test.invalid', password } });
      assert.equal(result.status, 200, 'Local test signup succeeds'); assert.ok(result.body.user?.id, 'Real Auth user exists');
      users[role] = { id: result.body.user.id, email: role + '@test.invalid', session: result.body };
    }
    const hashed = await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
      "select count(*)=2 and bool_and(encrypted_password ~ '^\\$2[aby]\\$') from auth.users");
    assert.equal(hashed, 't', 'Passwords stored as bcrypt hashes');
  });
  await check('valid password logs in and invalid password is rejected', async () => {
    const valid = await authRequest('/token?grant_type=password', { body: { email: users.manager.email, password } });
    assert.equal(valid.status, 200); assert.ok(valid.body.access_token, 'Real signed login token'); users.manager.session = valid.body;
    assert.equal(verifySigned(valid.body.access_token).aal, 'aal1');
    const invalid = await authRequest('/token?grant_type=password', { body: { email: users.manager.email, password: password + '-wrong' } });
    assert.equal(invalid.status, 400); assert.ok(!invalid.body.access_token, 'No token on wrong password');
  });
  await check('banned Auth user cannot log in with a correct password', async () => {
    const ban = await authRequest('/admin/users/' + users.student.id, { token: adminToken, method: 'PUT', body: { ban_duration: '1h' } });
    assert.equal(ban.status, 200);
    const login = await authRequest('/token?grant_type=password', { body: { email: users.student.email, password } });
    assert.equal(login.status, 400); assert.ok(!login.body.access_token, 'No token for banned user');
    const unban = await authRequest('/admin/users/' + users.student.id, { token: adminToken, method: 'PUT', body: { ban_duration: 'none' } });
    assert.equal(unban.status, 200);
    const session = await authRequest('/token?grant_type=password', { body: { email: users.student.email, password } });
    assert.equal(session.status, 200); users.student.session = session.body;
  });

  db = await database(); await migrate(db); await db.exec(await readFile('supabase/migrations/20261007_oauth_connector.sql', 'utf8'));
  for (const [role, user] of Object.entries(users)) {
    await db.query('insert into auth.users(id,email) values($1,$2)', [user.id, user.email]);
    // These fixture accounts used a random non-default password at real signup;
    // represent completion of the application's existing first-password policy.
    await db.query('insert into public.profiles(id,national_id,full_name,role,must_change_password,password_changed_at) values($1,$2,$3,$4,false,now())',
      [user.id, role === 'manager' ? '0000000001' : '0000000002', 'Live ' + role, role]);
  }
  async function syncCurrentAuthMetadata() {
    const json = await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
      "select json_build_object('sessions',coalesce((select json_agg(row_to_json(s)) from (select id,user_id,aal,factor_id,not_after from auth.sessions) s),'[]'::json),'factors',coalesce((select json_agg(row_to_json(f)) from (select id,user_id,status,factor_type from auth.mfa_factors) f),'[]'::json))");
    const state = JSON.parse(json);
    const uuidArray = rows => '{' + rows.map(row => { assert.match(row.id, /^[0-9a-f-]{36}$/i); return row.id; }).join(',') + '}';
    await db.query('delete from auth.sessions where id <> all($1::uuid[])', [uuidArray(state.sessions)]);
    await db.query('delete from auth.mfa_factors where id <> all($1::uuid[])', [uuidArray(state.factors)]);
    for (const factor of state.factors) await db.query(
      'insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,$3,$4) on conflict(id) do update set user_id=excluded.user_id,status=excluded.status,factor_type=excluded.factor_type',
      [factor.id, factor.user_id, factor.status, factor.factor_type]);
    for (const session of state.sessions) await db.query(
      'insert into auth.sessions(id,user_id,aal,factor_id,not_after) values($1,$2,$3,$4,$5) on conflict(id) do update set user_id=excluded.user_id,aal=excluded.aal,factor_id=excluded.factor_id,not_after=excluded.not_after',
      [session.id, session.user_id, session.aal, session.factor_id, session.not_after]);
  }
  let clientId = uuid(900);
  const callback = 'https://chatgpt.com/aip/local-fixture/oauth/callback';
  await db.query('insert into system_oauth.clients(client_id,name,redirect_uris,allowed_scopes,public_client) values($1,$2,$3,$4,true)',
    [clientId, 'ChatGPT live test', [callback], ['profile.read']]);
  const handlerSource = stripTypeScriptTypes(await readFile('supabase/functions/oauth-connector/handler.ts', 'utf8'), { mode: 'transform' });
  const { makeHandler } = await import('data:text/javascript;base64,' + Buffer.from(handlerSource).toString('base64'));
  const handler = makeHandler({
    env: name => ({ SUPABASE_URL: base, OAUTH_SITE_URL: site, SUPABASE_ANON_KEY: 'local-only-public-key', SUPABASE_SERVICE_ROLE_KEY: adminToken })[name],
    fetch: async (url, options) => {
      if (url === base + '/auth/v1/user') return fetch(authURL + '/user', options);
      if (url.startsWith(base + '/rest/v1/rpc/')) {
        const name = url.slice((base + '/rest/v1/rpc/').length), data = JSON.parse(options.body);
        await syncCurrentAuthMetadata();
        await db.exec('set role service_role');
        try { return new Response(JSON.stringify(await rpc(db, name, data)), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
        finally { await db.exec('reset role'); }
      }
      throw new Error('Unexpected integration destination');
    },
  });
  const verifier = randomBytes(32).toString('base64url');
  const authorization = { client_id: clientId, redirect_uri: callback, response_type: 'code', scope: 'profile.read',
    state: randomBytes(24).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
  async function invoke(route, body, token, form = false) {
    const response = await handler(new Request(base + '/functions/v1/oauth-connector' + route, {
      method: 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(form ? {} : { Origin: site }),
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  }
  await check('normal user prepares consent with a real existing aal1 session', async () => {
    const prepared = await invoke('/oauth/prepare', authorization, users.student.session.access_token);
    assert.equal(prepared.status, 200); assert.ok(prepared.body.request_id, 'Student consent is available without MFA');
  });
  await check('manager password session cannot create consent or authorization code before MFA', async () => {
    const prepared = await invoke('/oauth/prepare', authorization, users.manager.session.access_token);
    assert.equal(prepared.status, 403); assert.equal(prepared.body.error, 'mfa_required');
    const issued = await db.query('select count(*)::int n from system_oauth.codes'); assert.equal(issued.rows[0].n, 0);
    const registration = await invoke('/account/admin/clients', { name: 'ChatGPT native-auth client', redirect_uris: [callback],
      allowed_scopes: ['profile.read'], public_client: true }, users.manager.session.access_token);
    assert.equal(registration.status, 403); assert.equal(registration.body.error, 'mfa_required');
  });
  let factor;
  await check('real TOTP enrollment returns QR/setup key without enabling factor', async () => {
    const enrollment = await authRequest('/factors', { token: users.manager.session.access_token,
      body: { factor_type: 'totp', friendly_name: 'System live test', issuer: 'System test' } });
    assert.equal(enrollment.status, 200); assert.ok(enrollment.body.totp?.secret, 'Real setup key returned');
    assert.ok(enrollment.body.totp?.qr_code, 'Real enrollment QR returned'); factor = enrollment.body;
    assert.match(factor.id, /^[0-9a-f-]{36}$/i);
    const status = await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
      "select status from auth.mfa_factors where id='" + factor.id + "'");
    assert.equal(status, 'unverified', 'Enrollment is not enabled before successful verification');
  });
  await check('wrong TOTP is rejected by real Auth and does not upgrade session', async () => {
    const challenge = await authRequest('/factors/' + factor.id + '/challenge', { token: users.manager.session.access_token, body: {} });
    assert.equal(challenge.status, 200);
    const correct = totp(factor.totp.secret), wrong = String((Number(correct) + 123457) % 1000000).padStart(6, '0');
    const result = await authRequest('/factors/' + factor.id + '/verify', { token: users.manager.session.access_token,
      body: { challenge_id: challenge.body.id, code: wrong } });
    assert.equal(result.status, 422); assert.ok(!result.body.access_token, 'Wrong OTP cannot issue aal2');
  });
  await check('correct real TOTP issues a signed aal2 JWT with trusted AMR timestamp', async () => {
    const challenge = await authRequest('/factors/' + factor.id + '/challenge', { token: users.manager.session.access_token, body: {} });
    assert.equal(challenge.status, 200);
    const result = await authRequest('/factors/' + factor.id + '/verify', { token: users.manager.session.access_token,
      body: { challenge_id: challenge.body.id, code: totp(factor.totp.secret) } });
    assert.equal(result.status, 200); assert.ok(result.body.access_token, 'Verified token returned');
    const identity = verifySigned(result.body.access_token); assert.equal(identity.aal, 'aal2');
    assert.ok(identity.amr.some(entry => entry.method === 'totp' && Number.isInteger(entry.timestamp)), 'Signed TOTP timestamp exists');
    users.manager.session = result.body;
  });
  await check('TOTP secret is encrypted in actual Auth PostgreSQL storage', async () => {
    const encrypted = await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
      "select count(*)=1 and bool_and(secret like '{%' and secret::jsonb->>'alg'='aes-gcm-hkdf' and secret::jsonb->>'key_id'='local' and octet_length(decode(secret::jsonb->>'nonce','base64'))=12) from auth.mfa_factors where factor_type='totp'");
    assert.equal(encrypted, 't', 'Verified TOTP seed is encrypted at rest');
  });
  await check('native verified manager session registers the actual OAuth client through protected HTTP', async () => {
    const registration = await invoke('/account/admin/clients', { name: 'ChatGPT native-auth client', redirect_uris: [callback],
      allowed_scopes: ['profile.read'], public_client: true }, users.manager.session.access_token);
    assert.equal(registration.status, 201); assert.match(registration.body.client_id, /^[0-9a-f-]{36}$/i);
    assert.ok(!registration.body.client_secret, 'Public S256 client has no secret');
    clientId = registration.body.client_id; authorization.client_id = clientId;
  });
  let prepared, tokens;
  await check('manager reconnects from existing verified session without password login', async () => {
    const result = await invoke('/oauth/prepare', authorization, users.manager.session.access_token);
    assert.equal(result.status, 200); assert.ok(result.body.request_id, 'Consent accepts existing real aal2 session'); prepared = result.body;
    const again = await invoke('/oauth/prepare', authorization, users.manager.session.access_token);
    assert.equal(again.status, 200); assert.ok(again.body.request_id, 'Repeated connect reuses same session');
  });
  await check('real verified identity grants consent and exchanges a PKCE authorization code', async () => {
    const decision = await invoke('/oauth/decision', { request_id: prepared.request_id, csrf_token: prepared.csrf_token, approve: true }, users.manager.session.access_token);
    assert.equal(decision.status, 200); const redirect = new URL(decision.body.redirect_url);
    assert.ok(redirect.searchParams.get('state') === authorization.state, 'State preserved');
    const result = await invoke('/oauth/token', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback,
      code: redirect.searchParams.get('code'), code_verifier: verifier }, undefined, true);
    assert.equal(result.status, 200); assert.ok(result.body.access_token && result.body.refresh_token, 'Real OAuth tokens issued'); tokens = result.body;
  });
  await check('OAuth token resolves the same actual manager identity through protected API', async () => {
    const response = await handler(new Request(base + '/functions/v1/oauth-connector/api/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } }));
    assert.equal(response.status, 200); const identity = await response.json(); assert.equal(identity.id, users.manager.id);
    assert.ok(!Object.hasOwn(identity, 'email') && !Object.hasOwn(identity, 'permissions'), 'Minimal identity payload');
  });
  await check('refresh rotates and disconnect invalidates the same live-identity grant', async () => {
    const refreshed = await invoke('/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token }, undefined, true);
    assert.equal(refreshed.status, 200); assert.ok(refreshed.body.refresh_token !== tokens.refresh_token, 'Refresh rotates'); tokens = refreshed.body;
    const response = await handler(new Request(base + '/functions/v1/oauth-connector/account/connections', { headers: { Origin: site, Authorization: 'Bearer ' + users.manager.session.access_token } }));
    assert.equal(response.status, 200); const apps = await response.json();
    const grant = apps.connections?.[0]; assert.ok(grant?.id, 'Connected app is present');
    const disconnected = await invoke('/account/disconnect', { grant_id: grant.id }, users.manager.session.access_token);
    assert.equal(disconnected.status, 200);
    const denied = await handler(new Request(base + '/functions/v1/oauth-connector/api/me', { headers: { Authorization: 'Bearer ' + tokens.access_token } }));
    assert.equal(denied.status, 401);
  });
  const retainedAAL2 = users.manager.session.access_token;
  let beforeRemoval, pendingBeforeRemoval, codeBeforeRemoval;
  async function liveCode() {
    const request = await invoke('/oauth/prepare', authorization, retainedAAL2);
    assert.equal(request.status, 200);
    const decision = await invoke('/oauth/decision', { request_id: request.body.request_id,
      csrf_token: request.body.csrf_token, approve: true }, retainedAAL2);
    assert.equal(decision.status, 200);
    return new URL(decision.body.redirect_url).searchParams.get('code');
  }
  await check('real factor removal downgrades persisted Auth session despite retained signed aal2 JWT', async () => {
    const issued = await invoke('/oauth/token', { grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: callback, code: await liveCode(), code_verifier: verifier }, undefined, true);
    assert.equal(issued.status, 200); beforeRemoval = issued.body;
    const pending = await invoke('/oauth/prepare', authorization, retainedAAL2);
    assert.equal(pending.status, 200); pendingBeforeRemoval = pending.body;
    codeBeforeRemoval = await liveCode();
    const removal = await authRequest('/factors/' + factor.id, { token: retainedAAL2, method: 'DELETE' });
    assert.ok([200, 204].includes(removal.status), 'Real Auth unenrollment succeeds');
    const state = await run('exec', postgres, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc',
      "select count(*)>0 and bool_and(aal='aal1' and factor_id is null) from auth.sessions where user_id='" + users.manager.id + "'");
    assert.equal(state, 't', 'Native session has lost its verified factor and aal2');
    assert.equal(verifySigned(retainedAAL2).aal, 'aal2', 'Old JWT still has signed aal2 claims');
    assert.equal((await authRequest('/user', { token: retainedAAL2 })).status, 200,
      'Native Auth validates old signed JWT; mutable persisted AAL must also be checked');
  });
  await check('persisted Auth downgrade blocks retained aal2 JWT at prepare and pending consent', async () => {
    const before = (await db.query('select count(*)::int n from system_oauth.codes')).rows[0].n;
    const prepare = await invoke('/oauth/prepare', authorization, retainedAAL2);
    assert.equal(prepare.status, 403); assert.equal(prepare.body.error, 'mfa_required');
    const decision = await invoke('/oauth/decision', { request_id: pendingBeforeRemoval.request_id,
      csrf_token: pendingBeforeRemoval.csrf_token, approve: true }, retainedAAL2);
    assert.equal(decision.status, 403); assert.equal(decision.body.error, 'mfa_required');
    assert.equal((await db.query('select count(*)::int n from system_oauth.codes')).rows[0].n, before, 'No code after factor removal');
  });
  await check('removed verified factor invalidates manager access, refresh and unexchanged codes', async () => {
    const access = await handler(new Request(base + '/functions/v1/oauth-connector/api/me', {
      headers: { Authorization: 'Bearer ' + beforeRemoval.access_token },
    }));
    assert.equal(access.status, 401);
    const refresh = await invoke('/oauth/token', { grant_type: 'refresh_token', client_id: clientId,
      refresh_token: beforeRemoval.refresh_token }, undefined, true);
    assert.equal(refresh.status, 400); assert.equal(refresh.body.error, 'invalid_grant');
    const exchange = await invoke('/oauth/token', { grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: callback, code: codeBeforeRemoval, code_verifier: verifier }, undefined, true);
    assert.equal(exchange.status, 400); assert.equal(exchange.body.error, 'invalid_grant');
  });
  await check('real signout removes trusted session and rejects the retained browser JWT', async () => {
    const studentToken = users.student.session.access_token;
    const signout = await authRequest('/logout', { token: studentToken, method: 'POST' });
    assert.ok([200, 204].includes(signout.status), 'Native logout succeeds');
    const prepared = await invoke('/oauth/prepare', authorization, studentToken);
    assert.equal(prepared.status, 401); assert.equal(prepared.body.error, 'invalid_token');
  });
  console.log('Live Supabase Auth + OAuth integration: ' + count + ' passed (real password/TOTP; production HTTP and PGlite PostgreSQL RPCs; native Auth session/factor metadata mirrored).');
} catch (error) {
  // Never dump Auth responses, tokens, OTPs, environment files or container logs.
  console.error('Live Auth integration failed: ' + error.message);
  if (containers.includes(authContainer)) {
    const result = await docker('docker', ['logs', authContainer], { timeout: 15000, maxBuffer: 1024 * 1024 }).catch(() => ({ stdout: '', stderr: '' }));
    const diagnostics = new Set();
    for (const line of (result.stdout + '\n' + result.stderr).split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (!['error', 'fatal'].includes(entry.level) || !entry.error) continue;
        let message = String(entry.error).split('\n').at(-1);
        for (const secret of [password, jwtSecret, encryptionKey, adminToken]) message = message.replaceAll(secret, '[redacted]');
        message = message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database URL redacted]').replace(/[A-Za-z0-9_+/=-]{25,}/g, '[redacted]');
        diagnostics.add(message.slice(-400));
      } catch { /* discard nonstructured logs */ }
    }
    for (const diagnosis of diagnostics) console.error('Local Auth failure cause: ' + diagnosis);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
