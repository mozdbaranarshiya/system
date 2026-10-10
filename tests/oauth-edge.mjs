import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

// Real HTTP Request/Response, SHA-256 and random bytes; Auth signature validation
// and transactional PostgreSQL state are mocked here and tested separately.
globalThis.crypto ??= webcrypto;
const source = stripTypeScriptTypes(await readFile('supabase/functions/oauth-connector/handler.ts', 'utf8'), { mode: 'transform' });
const { makeHandler, digest, challenge } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const base = 'https://school.supabase.test';
const site = 'https://school.test/';
const endpoint = base + '/functions/v1/oauth-connector';
const user = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
const clientId = '00000000-0000-4000-8000-000000000004';
const requestId = '00000000-0000-4000-8000-000000000005';
const grantId = '00000000-0000-4000-8000-000000000006';
const redirect = 'https://chatgpt.com/aip/plugin/callback/connector-test';
const clientSecret = 'test-fixture-not-a-production-secret';
const verifier = 'A'.repeat(43);
const pkce = await challenge(verifier);
const code = 'soc_' + 'B'.repeat(43);
const access = 'soa_' + 'C'.repeat(43);
const refresh = 'sor_' + 'D'.repeat(43);
const defaults = { client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'profile.read classes.read', state: 'state-with+reserved&characters', code_challenge: pkce, code_challenge_method: 'S256' };
const claims = () => ({ sub: user, session_id: session, role: 'authenticated', aud: 'authenticated', iss: base + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 300, aal: 'aal1', amr: [{method:'password',timestamp:Math.floor(Date.now()/1000)}] });
const jwt = overrides => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ ...claims(), ...overrides })).toString('base64url') + '.signature';
const standardClient = { active: true, public_client: false, pkce_required: true, redirect_uris: [redirect], allowed_scopes: ['profile.read', 'classes.read', 'grades.read', 'assignments.read'], secret_hash: await digest(clientSecret) };
let checks = 0;
async function test(name, fn) {
  try { await fn(); checks++; }
  catch (error) { console.error('FAILED OAuth HTTP boundary:', name); throw error; }
}
function harness(options = {}) {
  const calls = [];
  const config = { SUPABASE_URL: base, OAUTH_SITE_URL: site, SUPABASE_ANON_KEY: 'public-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-test-key', ...options.env };
  const handler = makeHandler({ env: name => config[name], fetch: async (url, init = {}) => {
    if (url === base + '/auth/v1/user') {
      calls.push({ name: 'auth', headers: init.headers });
      assert.equal(init.headers.apikey, 'public-test-key');
      assert.equal(init.headers['Accept-Profile'], undefined);
      assert.equal(init.headers['Content-Profile'], undefined);
      return new Response(JSON.stringify(options.authUser ?? { id: user }), { status: options.authStatus ?? 200 });
    }
    assert.match(url, /^https:\/\/school\.supabase\.test\/rest\/v1\/rpc\/(oauth_operation|oauth_api)$/);
    assert.equal(init.headers.apikey, 'service-test-key');
    assert.equal(init.headers.Authorization, 'Bearer service-test-key');
    assert.equal(init.headers['Accept-Profile'], config.SYSTEM_DB_SCHEMA ?? 'public');
    assert.equal(init.headers['Content-Profile'], config.SYSTEM_DB_SCHEMA ?? 'public');
    const payload = JSON.parse(init.body);
    const name = url.split('/').at(-1);
    calls.push({ name, ...payload, headers: init.headers });
    if (options.rpcStatus) return new Response('private database failure detail', {status:options.rpcStatus});
    if (options.rpc) { const result = await options.rpc(name, payload); if (result !== undefined) return new Response(JSON.stringify(result)); }
    if (name === 'oauth_api') return new Response(JSON.stringify({ id: user, display_name: 'Test account' }));
    const action = payload.p_action;
    const result = action === 'rate' ? { allowed: true } : action === 'client' ? { ...standardClient, ...options.client } : action === 'prepare' ? { request_id: payload.p_data.request_id, name: 'ChatGPT', scopes: payload.p_data.scopes } : action === 'decide' ? { approved: payload.p_data.approve, redirect_uri: redirect, state: defaults.state } : ['exchange', 'refresh'].includes(action) ? { scopes: ['profile.read', 'classes.read'], expires_in: 900 } : action === 'connections' ? { connections: [] } : { ok: true };
    return new Response(JSON.stringify(result));
  } });
  return { calls, async invoke(path, {method = 'GET', data, query, headers = {}, json = false, bearer, origin, raw} = {}) {
    if (origin !== undefined) headers.origin = origin;
    if (bearer !== undefined) headers.Authorization = 'Bearer ' + bearer;
    if (data !== undefined || raw !== undefined) headers['Content-Type'] ??= json ? 'application/json' : 'application/x-www-form-urlencoded';
    const response = await handler(new Request(endpoint + path + (query ? '?' + (query instanceof URLSearchParams ? query : new URLSearchParams(query)) : ''), { method, headers, body: raw ?? (data === undefined ? undefined : json ? JSON.stringify(data) : new URLSearchParams(data).toString()) }));
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
  } };
}
const error = (result, code, status = 400) => { assert.equal(result.response.status, status); assert.deepEqual(result.data, {error:code}); };
const callbackError = (result, code, state = defaults.state) => {
  assert.equal(result.response.status, 302); assert.equal(result.data, null);
  const callback = new URL(result.response.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirect);
  assert.equal(callback.searchParams.get('error'), code);
  assert.equal(callback.searchParams.get('state'), state);
  assert.equal(callback.searchParams.has('code'), false);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
};
const action = (h, name) => h.calls.find(x => x.p_action === name)?.p_data;
const browserRequest = (data, overrides = {}) => ({ method:'POST', json:true, data, origin:new URL(site).origin, bearer:jwt(), ...overrides });
const tokenRequest = (overrides = {}, headers = {}) => ({ method:'POST', data:{ client_id:clientId, client_secret:clientSecret, grant_type:'authorization_code', code, redirect_uri:redirect, code_verifier:verifier, ...overrides }, headers });

await test('configured school schema selects every OAuth RPC without changing Auth requests', async () => {
  const h=harness({env:{SYSTEM_DB_SCHEMA:'school'}});
  const result=await h.invoke('/oauth/prepare',browserRequest({...defaults,schema:'public',db_schema:'public',SYSTEM_DB_SCHEMA:'public'}));
  assert.equal(result.response.status,200);
  const prepared=action(h,'prepare');
  assert.equal(prepared.schema,undefined);assert.equal(prepared.db_schema,undefined);assert.equal(prepared.SYSTEM_DB_SCHEMA,undefined);
  for(const call of h.calls){
    assert.equal(call.headers['Accept-Profile'],call.name==='auth'?undefined:'school');
    assert.equal(call.headers['Content-Profile'],call.name==='auth'?undefined:'school');
  }
  assert.equal((await h.invoke('/api/me',{bearer:access})).response.status,200);
  assert.equal(h.calls.find(call=>call.name==='oauth_api').headers['Content-Profile'],'school');
});
for(const invalid of ['', 'public,school','"school"','school;select','School','school name','x'.repeat(64)])await test('invalid server schema rejected before HTTP dependencies: '+JSON.stringify(invalid),async()=>{
  const h=harness({env:{SYSTEM_DB_SCHEMA:invalid}});
  error(await h.invoke('/oauth/prepare',browserRequest(defaults)),'temporarily_unavailable',503);
  assert.equal(h.calls.length,0);
});

await test('valid authorization redirect preserves exact client state and PKCE; no credential forwarded', async () => {
  const h = harness(); const r = await h.invoke('/oauth/authorize', { query:{...defaults,client_secret:'must-not-be-forwarded',password:'never'} });
  assert.equal(r.response.status, 302);
  const location = new URL(r.response.headers.get('location'));
  assert.equal(location.origin, new URL(site).origin); assert.equal(location.searchParams.get('oauth'), '1');
  for (const [key, value] of Object.entries(defaults)) assert.equal(location.searchParams.get(key), value);
  assert.equal(location.searchParams.has('client_secret'), false); assert.equal(location.searchParams.has('password'), false);
  assert.equal(h.calls.some(x => x.name === 'auth'), false);
});
for (const [name, changes, expected, status] of [
  ['malformed client', {client_id:'nope'}, 'invalid_client',401],
  ['exact callback mismatch', {redirect_uri:redirect+'/'}, 'invalid_request'],
  ['callback attacker suffix', {redirect_uri:redirect+'.evil.test'}, 'invalid_request'],
  ['callback URL credentials', {redirect_uri:'https://attacker@chatgpt.com/aip/plugin/callback/connector-test'}, 'invalid_request'],
  ['callback URL fragment', {redirect_uri:redirect+'#fragment'}, 'invalid_request'],
  ['insecure callback', {redirect_uri:redirect.replace('https:', 'http:')}, 'invalid_request'],
  ['empty state', {state:''}, 'invalid_request'],
  ['control character state', {state:'bad\nstate'}, 'invalid_request'],
  ['implicit flow', {response_type:'token'}, 'unsupported_response_type'],
  ['unknown scope', {scope:'admin.all'}, 'invalid_scope'],
  ['duplicate scope', {scope:'profile.read profile.read'}, 'invalid_scope'],
  ['plain PKCE', {code_challenge_method:'plain'}, 'invalid_request'],
  ['missing required PKCE', {code_challenge:'',code_challenge_method:''}, 'invalid_request'],
  ['malformed S256 challenge', {code_challenge:'too-short'}, 'invalid_request'],
]) await test(name, async () => {
  const result=await harness().invoke('/oauth/authorize', {query:{...defaults,...changes}});
  if(Object.hasOwn(changes,'client_id')||Object.hasOwn(changes,'redirect_uri')) {
    error(result,expected,status); assert.equal(result.response.headers.get('location'),null);
  } else callbackError(result,expected,Object.hasOwn(changes,'state')?(changes.state.includes('\n')?null:changes.state):defaults.state);
});
await test('missing state', async () => { const query={...defaults}; delete query.state; callbackError(await harness().invoke('/oauth/authorize',{query}),'invalid_request',null); });
await test('inactive client', async () => error(await harness({client:{active:false}}).invoke('/oauth/authorize',{query:defaults}),'invalid_client',401));
await test('client cannot grant unregistered scope', async () => callbackError(await harness({client:{allowed_scopes:['profile.read']}}).invoke('/oauth/authorize',{query:defaults}),'invalid_scope'));
await test('duplicate authorization parameters rejected', async () => { const query=new URLSearchParams(defaults); query.append('redirect_uri',redirect); const h=harness(); error(await h.invoke('/oauth/authorize',{query}),'invalid_request'); assert.equal(action(h,'client'),undefined); });
await test('confidential client with explicitly optional PKCE', async () => { const r=await harness({client:{pkce_required:false}}).invoke('/oauth/authorize',{query:{...defaults,code_challenge:'',code_challenge_method:''}}); assert.equal(r.response.status,302); });
await test('public client always requires PKCE', async () => callbackError(await harness({client:{public_client:true,pkce_required:false}}).invoke('/oauth/authorize',{query:{...defaults,code_challenge:'',code_challenge_method:''}}),'invalid_request'));
await test('oversized state is not reflected into registered error callback', async () => callbackError(await harness().invoke('/oauth/authorize',{query:{...defaults,state:'x'.repeat(513)}}),'invalid_request',null));
await test('browser prepare keeps JSON OAuth validation errors', async () => error(await harness().invoke('/oauth/prepare',browserRequest({...defaults,scope:'admin.all'})),'invalid_scope'));
await test('native MFA row contention produces retryable 503 without issuing code', async () => {
  const h=harness({rpc:(name,p)=>p.p_action==='prepare'?{error:'temporarily_unavailable'}:undefined});
  error(await h.invoke('/oauth/prepare',browserRequest(defaults)),'temporarily_unavailable',503);
  assert.equal(action(h,'decide'),undefined);
});

for (const path of ['/oauth/prepare','/oauth/decision','/account/disconnect','/account/admin/clients']) {
  await test(path+' missing browser origin', async () => {const h=harness();error(await h.invoke(path,browserRequest(defaults,{origin:undefined})),'access_denied',403);assert.equal(h.calls.length,0);});
  await test(path+' foreign browser origin', async () => {const h=harness();error(await h.invoke(path,browserRequest(defaults,{origin:'https://evil.test'})),'access_denied',403);assert.equal(h.calls.length,0);});
}
await test('prepare binds verified GoTrue user/session; client role and MFA ignored', async () => {
  const h=harness(); const r=await h.invoke('/oauth/prepare',browserRequest({...defaults,user_id:otherUser,actor:otherUser,session_id:otherUser,mfa_time:Date.now(),mfa_verified:true,role:'manager'}));
  assert.equal(r.response.status,200); const prepared=action(h,'prepare');
  assert.equal(prepared.user_id,user);assert.equal(prepared.actor,user);assert.equal(prepared.session_id,session);assert.equal(prepared.mfa_time,null);
  assert.equal(prepared.role,undefined);assert.equal(prepared.mfa_verified,undefined);
  assert.match(r.data.csrf_token,/^[A-Za-z0-9_-]{43}$/);assert.equal(prepared.csrf_hash,await digest(r.data.csrf_token));assert.notEqual(prepared.csrf_hash,r.data.csrf_token);
  assert.equal(prepared.request_id,r.data.request_id);assert.equal(h.calls[0].name,'auth');
});
await test('GoTrue rejection cannot be replaced by decoded JWT claims', async () => { const h=harness({authStatus:401}); error(await h.invoke('/oauth/prepare',browserRequest(defaults)),'invalid_token',401);assert.equal(action(h,'prepare'),undefined); });
for (const [name, overrides] of [
  ['expired JWT',{exp:0}],['wrong JWT subject',{sub:otherUser}],['wrong audience',{aud:'anonymous'}],['wrong issuer',{iss:'https://attacker.test/auth/v1'}],['service role',{role:'service_role'}],['missing session',{session_id:null}],['external OAuth JWT',{client_id:clientId}],
]) await test(name+' rejected despite Auth test-double user response', async () => error(await harness().invoke('/oauth/prepare',browserRequest(defaults,{bearer:jwt(overrides)})),'invalid_token',401));
await test('Auth user cannot differ from verified JWT subject', async () => error(await harness({authUser:{id:otherUser}}).invoke('/oauth/prepare',browserRequest(defaults)),'invalid_token',401));
await test('opaque OAuth token cannot act as browser session', async () => error(await harness().invoke('/oauth/prepare',browserRequest(defaults,{bearer:access})),'invalid_token',401));
await test('MFA timestamp comes exclusively from verified aal2 AMR', async () => {const now=Math.floor(Date.now()/1000);const h=harness();assert.equal((await h.invoke('/oauth/prepare',browserRequest(defaults,{bearer:jwt({aal:'aal2',amr:[{method:'password',timestamp:now},{method:'totp',timestamp:now-5}]})}))).response.status,200);assert.equal(action(h,'prepare').mfa_time,now-5);});
await test('unverified or future MFA claims cannot establish MFA', async () => {const h=harness();await h.invoke('/oauth/prepare',browserRequest(defaults,{bearer:jwt({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)+600}]})}));assert.equal(action(h,'prepare').mfa_time,null);});
await test('manager MFA requirement returned by trusted SQL is surfaced', async () => error(await harness({rpc:(name,p)=>p.p_action==='prepare'?{error:'mfa_required'}:undefined}).invoke('/oauth/prepare',browserRequest(defaults)),'mfa_required',403));

await test('consent decision hashes nonce and code; same nonce cannot be consumed twice', async () => {
  let used=false; const h=harness({rpc:(name,p)=>{if(p.p_action==='decide'){if(used)return {error:'invalid_request'};used=true;return {redirect_uri:redirect,approved:true,state:defaults.state};}}});
  const input={request_id:requestId,csrf_token:'E'.repeat(43),approve:true,user_id:otherUser,mfa_verified:true};
  const r=await h.invoke('/oauth/decision',browserRequest(input));assert.equal(r.response.status,200);
  const callback=new URL(r.data.redirect_url);assert.equal(callback.searchParams.get('state'),defaults.state);assert.match(callback.searchParams.get('code'),/^soc_[A-Za-z0-9_-]{43}$/);
  const decided=action(h,'decide');assert.equal(decided.csrf_hash,await digest(input.csrf_token));assert.equal(decided.code_hash,await digest(callback.searchParams.get('code')));assert.equal(decided.user_id,user);assert.equal(decided.mfa_verified,undefined);
  error(await h.invoke('/oauth/decision',browserRequest(input)),'invalid_request');
});
await test('consent denial preserves state and never returns a code', async () => {const r=await harness().invoke('/oauth/decision',browserRequest({request_id:requestId,csrf_token:'nonce',approve:false}));const callback=new URL(r.data.redirect_url);assert.equal(callback.searchParams.get('error'),'access_denied');assert.equal(callback.searchParams.get('state'),defaults.state);assert.equal(callback.searchParams.has('code'),false);});
await test('consent boolean cannot be coercible string', async () => error(await harness().invoke('/oauth/decision',browserRequest({request_id:requestId,csrf_token:'nonce',approve:'true'})),'invalid_request'));

await test('POST client auth; correct PKCE transmitted as S256; no raw credential/token SQL storage', async () => {
  const h=harness();const r=await h.invoke('/oauth/token',tokenRequest());assert.equal(r.response.status,200);assert.equal(r.data.token_type,'Bearer');assert.equal(r.data.expires_in,900);
  assert.match(r.data.access_token,/^soa_[A-Za-z0-9_-]{43}$/);assert.match(r.data.refresh_token,/^sor_[A-Za-z0-9_-]{43}$/);
  const exchange=action(h,'exchange');assert.equal(exchange.code_hash,await digest(code));assert.equal(exchange.code_challenge,pkce);assert.equal(exchange.access_hash,await digest(r.data.access_token));assert.equal(exchange.refresh_hash,await digest(r.data.refresh_token));
  for(const secret of [clientSecret,code,r.data.access_token,r.data.refresh_token])assert.equal(JSON.stringify(h.calls).includes(secret),false);
});
await test('Basic client auth supported without POST credentials', async () => {const input=tokenRequest();delete input.data.client_id;delete input.data.client_secret;input.headers.Authorization='Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64');assert.equal((await harness().invoke('/oauth/token',input)).response.status,200);});
await test('Basic and POST auth cannot be mixed', async () => error(await harness().invoke('/oauth/token',tokenRequest({}, {Authorization:'Basic '+Buffer.from(clientId+':'+clientSecret).toString('base64')})),'invalid_client',401));
await test('incorrect confidential client secret', async () => {const h=harness();error(await h.invoke('/oauth/token',tokenRequest({client_secret:'wrong'})),'invalid_client',401);assert.equal(action(h,'exchange'),undefined);});
await test('missing confidential client secret', async () => error(await harness().invoke('/oauth/token',tokenRequest({client_secret:''})),'invalid_client',401));
await test('malformed Basic authorization', async () => error(await harness().invoke('/oauth/token',tokenRequest({},{Authorization:'Basic !!!!'})),'invalid_client',401));
await test('public token client without secret supported', async () => assert.equal((await harness({client:{public_client:true,secret_hash:null}}).invoke('/oauth/token',tokenRequest({client_secret:''}))).response.status,200));
await test('public client cannot supply a secret', async () => error(await harness({client:{public_client:true,secret_hash:null}}).invoke('/oauth/token',tokenRequest()),'invalid_client',401));
await test('wrong verifier is sent hashed and SQL invalid_grant preserved', async () => {const h=harness({rpc:(name,p)=>p.p_action==='exchange'&&p.p_data.code_challenge!==pkce?{error:'invalid_grant'}:undefined});error(await h.invoke('/oauth/token',tokenRequest({code_verifier:'Z'.repeat(43)})),'invalid_grant');assert.notEqual(action(h,'exchange').code_challenge,pkce);});
for(const invalid of ['too-short','!'.repeat(43),'x'.repeat(129)])await test('invalid verifier '+invalid.length,async()=>error(await harness().invoke('/oauth/token',tokenRequest({code_verifier:invalid})),invalid.length>128?'invalid_request':'invalid_grant'));
await test('malformed code rejected before exchange', async () => {const h=harness();error(await h.invoke('/oauth/token',tokenRequest({code:'code'})),'invalid_grant');assert.equal(action(h,'exchange'),undefined);});
await test('expired/consumed code SQL result cannot issue tokens', async () => error(await harness({rpc:(name,p)=>p.p_action==='exchange'?{error:'invalid_grant'}:undefined}).invoke('/oauth/token',tokenRequest()),'invalid_grant'));
await test('refresh rotation sends old/new hashes and preserves scopes unless narrowing requested', async () => {
  const h=harness();const input={client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:refresh};const r=await h.invoke('/oauth/token',{method:'POST',data:input});assert.equal(r.response.status,200);
  const rotation=action(h,'refresh');assert.equal(rotation.refresh_hash,await digest(refresh));assert.equal(rotation.next_refresh_hash,await digest(r.data.refresh_token));assert.equal(rotation.access_hash,await digest(r.data.access_token));assert.equal(rotation.scopes,null);assert.notEqual(refresh,r.data.refresh_token);
});
await test('refresh narrowing propagated to SQL', async () => {const h=harness({rpc:(name,p)=>p.p_action==='refresh'?{scopes:p.p_data.scopes,expires_in:900}:undefined});const r=await h.invoke('/oauth/token',tokenRequest({grant_type:'refresh_token',refresh_token:refresh,scope:'profile.read'}));assert.equal(r.data.scope,'profile.read');assert.deepEqual(action(h,'refresh').scopes,['profile.read']);});
await test('refresh cannot widen scopes rejected by SQL', async () => error(await harness({rpc:(name,p)=>p.p_action==='refresh'?{error:'invalid_scope'}:undefined}).invoke('/oauth/token',tokenRequest({grant_type:'refresh_token',refresh_token:refresh,scope:'grades.read'})),'invalid_scope'));
await test('refresh reuse/expired/revoked SQL failure returned without token', async () => error(await harness({rpc:(name,p)=>p.p_action==='refresh'?{error:'invalid_grant'}:undefined}).invoke('/oauth/token',tokenRequest({grant_type:'refresh_token',refresh_token:refresh})),'invalid_grant'));
await test('unsupported grant rejected', async () => error(await harness().invoke('/oauth/token',tokenRequest({grant_type:'password'})),'unsupported_grant_type'));
await test('duplicate form parameters rejected', async () => {const h=harness();error(await h.invoke('/oauth/token',{method:'POST',raw:'client_id='+clientId+'&client_id='+clientId}),'invalid_request');assert.equal(action(h,'client'),undefined);});
await test('revoke hashes token and is idempotent HTTP response', async () => {const h=harness();for(let i=0;i<2;i++)assert.equal((await h.invoke('/oauth/revoke',{method:'POST',data:{client_id:clientId,client_secret:clientSecret,token:refresh}})).response.status,200);assert.equal(action(h,'revoke').token_hash,await digest(refresh));});

await test('API accepts opaque token and passes only hashed token to SQL authorization', async () => {const h=harness();const r=await h.invoke('/api/me',{bearer:access});assert.equal(r.response.status,200);const api=h.calls.find(x=>x.name==='oauth_api');assert.equal(api.p_token_hash,await digest(access));assert.equal(api.p_resource,'me');assert.equal(JSON.stringify(h.calls).includes(access),false);assert.equal(h.calls.some(x=>x.name==='auth'),false);});
for(const [name,config]of[['missing token',{}],['JWT cannot call connector API',{bearer:jwt()}],['malformed token',{bearer:'soa_short'}],['query token ignored',{query:{access_token:access}}]])await test(name,async()=>error(await harness().invoke('/api/me',config),'invalid_token',401));
for(const [name,query]of[['invalid resource id',{student_id:'not-a-uuid'}],['unsupported IDOR filter',{user_id:otherUser}],['zero page limit',{limit:'0'}],['excess page limit',{limit:'101'}],['negative offset',{offset:'-1'}],['fractional offset',{offset:'1.5'}]])await test(name,async()=>{const h=harness();error(await h.invoke('/api/grades',{bearer:access,query}),'invalid_request');assert.equal(h.calls.some(x=>x.name==='oauth_api'),false);});
await test('API valid filters forwarded for SQL object access checking',async()=>{const h=harness();await h.invoke('/api/grades',{bearer:access,query:{student_id:otherUser,class_id:grantId,limit:'10',offset:'1'}});assert.deepEqual(h.calls.find(x=>x.name==='oauth_api').p_filters,{student_id:otherUser,class_id:grantId,limit:'10',offset:'1'});});
for(const [code,status]of[['invalid_token',401],['insufficient_scope',403],['access_denied',403]])await test('API SQL '+code+' blocks response',async()=>error(await harness({rpc:name=>name==='oauth_api'?{error:code}:undefined}).invoke('/api/grades',{bearer:access}),code,status));

await test('disconnect identity is bound to session and client cannot opt into admin revoke',async()=>{const h=harness();assert.equal((await h.invoke('/account/disconnect',browserRequest({grant_id:grantId,actor:otherUser,user_id:otherUser,admin:true}))).response.status,200);const d=action(h,'disconnect');assert.equal(d.actor,user);assert.equal(d.user_id,user);assert.equal(d.admin,false);});
await test('admin revoke still requires internal SQL manager/MFA authorization',async()=>{const h=harness({rpc:(name,p)=>p.p_action==='disconnect'?{error:'access_denied'}:undefined});error(await h.invoke('/account/admin/revoke',browserRequest({grant_id:grantId,role:'manager',mfa_verified:true})),'access_denied',403);assert.equal(action(h,'disconnect').admin,true);assert.equal(action(h,'disconnect').mfa_time,null);});
await test('connections identity is bound to verified session',async()=>{const h=harness();const r=await h.invoke('/account/connections',{origin:new URL(site).origin,bearer:jwt(),query:{user_id:otherUser}});assert.equal(r.response.status,200);assert.equal(action(h,'connections').user_id,user);});
await test('client registration uses random credentials, hashed secret and least-privilege scope',async()=>{
  const h=harness();const input={name:'ChatGPT',redirect_uris:[redirect],allowed_scopes:['profile.read'],public_client:false,client_secret:'attacker-chosen-secret',client_id:clientId};
  const first=await h.invoke('/account/admin/clients',browserRequest(input));const second=await h.invoke('/account/admin/clients',browserRequest(input));assert.equal(first.response.status,201);assert.match(first.data.client_secret,/^scs_[A-Za-z0-9_-]{43}$/);assert.notEqual(first.data.client_secret,second.data.client_secret);assert.notEqual(first.data.client_id,second.data.client_id);assert.notEqual(first.data.client_id,clientId);
  const register=action(h,'register');assert.equal(register.secret_hash,await digest(first.data.client_secret));assert.equal(register.client_id,first.data.client_id);assert.deepEqual(register.allowed_scopes,['profile.read']);assert.equal(first.data.secret_hash,undefined);assert.equal(register.client_secret,undefined);assert.equal(register.actor,user);
});
await test('public registration has no secret and always requires PKCE',async()=>{const h=harness();const r=await h.invoke('/account/admin/clients',browserRequest({name:'Public app',redirect_uris:[redirect],allowed_scopes:['profile.read'],public_client:true,pkce_required:false}));assert.equal(r.response.status,201);assert.equal(r.data.client_secret,undefined);assert.equal(action(h,'register').secret_hash,null);assert.equal(action(h,'register').pkce_required,true);});
await test('manager registration cannot be authorized with supplied role/MFA',async()=>error(await harness({rpc:(name,p)=>p.p_action==='register'?{error:'mfa_required'}:undefined}).invoke('/account/admin/clients',browserRequest({name:'ChatGPT',redirect_uris:[redirect],allowed_scopes:['profile.read'],public_client:false,role:'manager',mfa_verified:true})),'mfa_required',403));

await test('security and allowed origin headers present on success',async()=>{const r=await harness().invoke('/oauth/prepare',browserRequest(defaults));const headers=r.response.headers;assert.equal(headers.get('cache-control'),'no-store');assert.equal(headers.get('pragma'),'no-cache');assert.equal(headers.get('x-content-type-options'),'nosniff');assert.equal(headers.get('referrer-policy'),'no-referrer');assert.match(headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(headers.get('access-control-allow-origin'),new URL(site).origin);assert.equal(headers.get('access-control-allow-credentials'),null);});
await test('preflight has restricted origins/headers/methods',async()=>{const r=await harness().invoke('/oauth/prepare',{method:'OPTIONS',origin:new URL(site).origin});assert.equal(r.response.status,204);assert.equal(r.response.headers.get('access-control-allow-origin'),new URL(site).origin);assert.equal(r.response.headers.get('access-control-allow-methods'),'GET, POST, OPTIONS');assert.equal(r.response.headers.get('access-control-allow-headers'),'authorization, apikey, content-type');});
await test('internal RPC/exception failure contains no private upstream details',async()=>{const r=await harness({rpcStatus:500}).invoke('/oauth/token',tokenRequest());error(r,'temporarily_unavailable',503);assert.equal(r.response.headers.get('cache-control'),'no-store');assert.equal(JSON.stringify(r.data).includes('private'),false);});
await test('unexpected dependency exception sanitized',async()=>error(await harness({rpc:()=>{throw new Error('sensitive_database_secret');}}).invoke('/oauth/token',tokenRequest()),'temporarily_unavailable',503));
await test('rate limit blocks OAuth operations before issuance',async()=>{const h=harness({rpc:(name,p)=>p.p_action==='rate'?{allowed:false}:undefined});const r=await h.invoke('/oauth/token',tokenRequest());error(r,'rate_limit_exceeded',429);assert.equal(r.response.headers.get('retry-after'),'60');assert.equal(action(h,'exchange'),undefined);});
await test('oversized actual body rejected without relying on Content-Length',async()=>{const h=harness();error(await h.invoke('/oauth/token',{method:'POST',raw:'x='+ 'a'.repeat(16385)}),'invalid_request',413);assert.equal(action(h,'client'),undefined);});
await test('oversized declared body rejected before SQL',async()=>error(await harness().invoke('/oauth/token',tokenRequest({}, {'Content-Length':'20000'})),'invalid_request',413));
await test('token endpoint rejects JSON content type',async()=>error(await harness().invoke('/oauth/token',{...tokenRequest(),json:true}),'invalid_request',415));
await test('browser endpoint rejects form content type',async()=>error(await harness().invoke('/oauth/prepare',{...browserRequest(defaults),json:false}),'invalid_request',415));
await test('invalid JSON rejected',async()=>error(await harness().invoke('/oauth/prepare',{...browserRequest(undefined),raw:'{not json',headers:{'Content-Type':'application/json'}}),'invalid_request'));
await test('insecure production site configuration blocks all requests',async()=>error(await harness({env:{OAUTH_SITE_URL:'http://school.test/'}}).invoke('/oauth/authorize',{query:defaults}),'temporarily_unavailable',503));
await test('unknown route does not reveal implementation',async()=>error(await harness().invoke('/private-internal-route'),'invalid_request',404));
console.log(`OAuth HTTP boundary: ${checks} tests passed (real HTTP/WebCrypto; GoTrue and SQL HTTP dependencies mocked).`);
