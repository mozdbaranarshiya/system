import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database } from './database-setup.mjs';
import { seed, migrate, seedOAuthSessions, asUser, rpc, ids, uuid } from './fixtures.mjs';

const db = await database();
const hash = text => createHash('sha256').update(text).digest('hex');
const pkce = text => createHash('sha256').update(text).digest('base64url');
const allScopes = ['profile.read','classes.read','grades.read','assignments.read'];
const clientId = uuid(100), publicId = uuid(101), secondId = uuid(102);
const callback = 'https://chatgpt.com/aip/plugin-fixture/oauth/callback';
let sessions;
const verifier = 'a'.repeat(43), challenge = pkce(verifier);
let serial = 300, passed = 0;
const mfa = () => Math.floor(Date.now()/1000);
const test = async (name, fn) => { try { await fn(); passed++; console.log('PASS',name); } catch (error) { throw new Error(name,{cause:error}); } };
const service = async fn => { await db.exec('set role service_role'); try { return await fn(); } finally { await db.exec('reset role'); } };
const op = (action,data) => service(() => rpc(db,'oauth_operation',{p_action:action,p_data:data}));
const api = (token,resource='me',filters={}) => service(() => rpc(db,'oauth_api',{p_token_hash:token,p_resource:resource,p_filters:filters}));
const errorIs = (value,error) => assert.equal(value.error,error,JSON.stringify(value));
function pending(user=ids.student,overrides={}) {
 const n=serial++;
 return {client_id:clientId,redirect_uri:callback,scopes:allScopes,state:'state-'+n,code_challenge:challenge,session_id:sessions[user].session_id,user_id:user,csrf_hash:hash('csrf-'+n),request_id:uuid(n),mfa_time:user===ids.manager?mfa():null,...overrides};
}
async function decision(request,approve=true,overrides={}) {
 const codeHash=hash('code-'+request.request_id);
 const data={request_id:request.request_id,user_id:request.user_id,session_id:request.session_id,csrf_hash:request.csrf_hash,approve,code_hash:codeHash,mfa_time:request.mfa_time,...overrides};
 return {result:await op('decide',data),codeHash};
}
async function grant(user=ids.student,overrides={}) {
 const request=pending(user,overrides);assert.ok((await op('prepare',request)).request_id);
 const {result,codeHash}=await decision(request);assert.equal(result.approved,true);
 const access=hash('access-'+request.request_id),refresh=hash('refresh-'+request.request_id);
 const exchange={client_id:request.client_id,code_hash:codeHash,redirect_uri:request.redirect_uri,code_challenge:request.code_challenge,access_hash:access,refresh_hash:refresh};
 assert.equal((await op('exchange',exchange)).expires_in,900);
 const grantId=(await db.query('select grant_id from system_oauth.codes where code_hash=$1',[codeHash])).rows[0].grant_id;
 return {request,codeHash,access,refresh,grantId,exchange};
}

try {
 await seed(db);await migrate(db);sessions=await seedOAuthSessions(db);await db.exec(await readFile('supabase/migrations/20261007_oauth_connector.sql','utf8'));
 const register={actor:ids.manager,session_id:sessions[ids.manager].session_id,mfa_time:mfa(),client_id:clientId,name:'ChatGPT',redirect_uris:[callback],allowed_scopes:allScopes,secret_hash:hash('fixture-client-secret'),pkce_required:true};
 await test('Service-only lifecycle and resource RPCs reject every browser role',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   await assert.rejects(()=>rpc(db,'oauth_operation',{p_action:'client',p_data:{client_id:clientId}}),/permission denied/);
   await assert.rejects(()=>rpc(db,'oauth_api',{p_token_hash:hash('invalid'),p_resource:'me'}),/permission denied/);
   await assert.rejects(()=>db.query('select * from system_oauth.clients'),/permission denied/);
   await db.exec('reset role');
  }
  await service(()=>assert.rejects(()=>db.query('select * from system_oauth.clients'),/permission denied/));
 });
 await test('Manager registration requires recent verified MFA and actual internal role',async()=>{
  errorIs(await op('register',{...register,actor:ids.teacher,session_id:sessions[ids.teacher].session_id}),'access_denied');
  errorIs(await op('register',{...register,mfa_time:null}),'mfa_required');
  errorIs(await op('register',{...register,mfa_time:mfa()-601}),'mfa_required');
  assert.equal((await op('register',register)).ok,true);
  assert.equal((await op('register',{...register,client_id:secondId,name:'Other app'})).ok,true);
 });
 await test('Registration enforces HTTPS, exact supported scopes and safe public PKCE',async()=>{
  errorIs(await op('register',{...register,client_id:uuid(105),redirect_uris:['https://trusted.example@evil.example/cb']}),'invalid_request');
  errorIs(await op('register',{...register,client_id:uuid(105),redirect_uris:['http://example.com/cb']}),'invalid_request');
  errorIs(await op('register',{...register,client_id:uuid(105),redirect_uris:['https://example.com/cb#fragment']}),'invalid_request');
  errorIs(await op('register',{...register,client_id:uuid(105),allowed_scopes:['admin.write']}),'invalid_scope');
  errorIs(await op('register',{...register,client_id:publicId,secret_hash:null,pkce_required:false}),'invalid_request');
  assert.equal((await op('register',{...register,client_id:publicId,secret_hash:null})).ok,true);
  assert.equal((await op('register',{...register,client_id:uuid(106),redirect_uris:['http://localhost:8080/cb'],allow_local_http:true})).ok,true);
 });
 await test('Authorization rejects unknown client, changed callback, empty state, broad scopes and missing S256',async()=>{
  for(const [overrides,error] of [[{client_id:uuid(999)},'invalid_client'],[{redirect_uri:callback+'/suffix'},'invalid_request'],[{redirect_uri:callback+'?extra=1'},'invalid_request'],[{state:''},'invalid_request'],[{scopes:['students.write']},'invalid_scope'],[{code_challenge:null},'invalid_request'],[{code_challenge:'plain-verifier'},'invalid_request']])errorIs(await op('prepare',pending(ids.student,overrides)),error);
 });
 await test('Initial-password and inactive accounts cannot authorize',async()=>{
  errorIs(await op('prepare',pending(ids.initial)),'account_not_ready');
  await db.query('update profiles set active=false where id=$1',[ids.classmate]);
  errorIs(await op('prepare',pending(ids.classmate)),'account_not_ready');
  await db.query('update profiles set active=true where id=$1',[ids.classmate]);
 });
 await test('Managers require fresh MFA before preparing authorization and again at consent',async()=>{
  errorIs(await op('prepare',pending(ids.manager,{mfa_time:null})),'mfa_required');
  errorIs(await op('prepare',pending(ids.manager,{mfa_time:mfa()-601})),'mfa_required');
  errorIs(await op('prepare',pending(ids.manager,{mfa_time:mfa()+60})),'mfa_required');
  const request=pending(ids.manager);assert.ok((await op('prepare',request)).request_id);
  errorIs((await decision(request,true,{mfa_time:null})).result,'mfa_required');
  errorIs((await decision(request,true,{mfa_time:mfa()-601})).result,'mfa_required');
  assert.equal((await decision(request)).result.approved,true);
 });
 await test('Browser authorization requires the current persisted user session',async()=>{
  for(const session_id of [null,uuid(9999),sessions[ids.classmate].session_id])errorIs(await op('prepare',pending(ids.student,{session_id})),'invalid_token');
  await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[sessions[ids.student].session_id]);
  errorIs(await op('prepare',pending()),'invalid_token');
  await db.query('update auth.sessions set not_after=null where id=$1',[sessions[ids.student].session_id]);
 });
 await test('Fresh signed MFA context cannot override a downgraded persisted manager session',async()=>{
  const request=pending(ids.manager);await op('prepare',request);
  await db.query("update auth.sessions set aal='aal1',factor_id=null where id=$1",[sessions[ids.manager].session_id]);
  errorIs(await op('prepare',pending(ids.manager)),'mfa_required');errorIs((await decision(request)).result,'mfa_required');
  errorIs(await op('register',{...register,client_id:uuid(108)}),'mfa_required');
  await db.query("update auth.sessions set aal='aal2',factor_id=$1 where id=$2",[sessions[ids.manager].factor_id,sessions[ids.manager].session_id]);
  assert.equal((await decision(request)).result.approved,true);
 });
 await test('Manager token grants remain bound to the exact verified TOTP factor',async()=>{
  const connected=await grant(ids.manager),request=pending(ids.manager);await op('prepare',request);
  assert.equal((await db.query('select mfa_factor_id from system_oauth.grants where id=$1',[connected.grantId])).rows[0].mfa_factor_id,sessions[ids.manager].factor_id);
  await db.query("update auth.mfa_factors set status='unverified' where id=$1",[sessions[ids.manager].factor_id]);
  errorIs((await decision(request)).result,'mfa_required');errorIs(await api(connected.access),'invalid_token');
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:connected.refresh,access_hash:hash('factor-unverified-access'),next_refresh_hash:hash('factor-unverified-refresh')}),'invalid_grant');
  await db.query("update auth.mfa_factors set status='verified',factor_type='phone' where id=$1",[sessions[ids.manager].factor_id]);
  errorIs(await op('prepare',pending(ids.manager)),'mfa_required');
  await db.query("update auth.mfa_factors set factor_type='totp' where id=$1",[sessions[ids.manager].factor_id]);
 });
 await test('Consent binds a single-use server-side CSRF challenge to user and browser session',async()=>{
  const request=pending();await op('prepare',request);
  for(const override of [{csrf_hash:hash('wrong')},{session_id:uuid(201)},{user_id:ids.classmate}])errorIs((await decision(request,true,override)).result,'invalid_request');
  const accepted=await decision(request);assert.equal(accepted.result.approved,true);assert.equal(accepted.result.state,request.state);assert.equal(accepted.result.redirect_uri,callback);
  errorIs((await decision(request)).result,'invalid_request');
 });
 await test('Denied consent preserves state and issues no authorization code',async()=>{
  const request=pending();await op('prepare',request);const denied=await decision(request,false);
  assert.equal(denied.result.approved,false);assert.equal(denied.result.state,request.state);
  assert.equal((await db.query('select count(*)::int n from system_oauth.codes where code_hash=$1',[denied.codeHash])).rows[0].n,0);
 });
 await test('Expired consent cannot issue a code',async()=>{
  const request=pending();await op('prepare',request);await db.query("update system_oauth.requests set expires_at=now()-interval '1 second' where id=$1",[request.request_id]);
  errorIs((await decision(request)).result,'invalid_request');
 });
 await test('Codes bind client, exact callback and S256 verifier before single-use consumption',async()=>{
  const request=pending();await op('prepare',request);const {codeHash}=await decision(request);
  const exchange={client_id:clientId,code_hash:codeHash,redirect_uri:callback,code_challenge:challenge,access_hash:hash('single-access'),refresh_hash:hash('single-refresh')};
  for(const override of [{client_id:secondId},{redirect_uri:callback+'/'},{code_challenge:pkce('wrong'.repeat(10))},{code_challenge:null}])errorIs(await op('exchange',{...exchange,...override}),'invalid_grant');
  assert.equal((await op('exchange',exchange)).expires_in,900);errorIs(await op('exchange',exchange),'invalid_grant');
 });
 await test('Expired authorization codes cannot exchange',async()=>{
  const request=pending();await op('prepare',request);const {codeHash}=await decision(request);
  await db.query("update system_oauth.codes set expires_at=now()-interval '1 second' where code_hash=$1",[codeHash]);
  errorIs(await op('exchange',{client_id:clientId,code_hash:codeHash,redirect_uri:callback,code_challenge:challenge,access_hash:hash('expired-access'),refresh_hash:hash('expired-refresh')}),'invalid_grant');
 });
 const student=await grant(),teacher=await grant(ids.teacher),manager=await grant(ids.manager);
 await test('Current user is minimal and caller claims are restored after trusted evaluation',async()=>{
  const before=(await db.query("select current_setting('request.jwt.claims',true) claims")).rows[0].claims;
  assert.deepEqual(await api(student.access),{id:ids.student,display_name:'دانش‌آموز یک'});
  assert.equal((await db.query("select current_setting('request.jwt.claims',true) claims")).rows[0].claims||'',before||'');
 });
 await test('Profile scope never grants educational API access',async()=>{
  const narrow=await grant(ids.student,{scopes:['profile.read']});assert.equal((await api(narrow.access)).id,ids.student);
  for(const resource of ['classes','grades','assignments'])errorIs(await api(narrow.access,resource),'insufficient_scope');
 });
 await test('Student sees only enrolled classes and cannot change class/student identifiers',async()=>{
  assert.deepEqual((await api(student.access,'classes')).rows.map(x=>x.id),[ids.class]);
  errorIs(await api(student.access,'classes',{class_id:ids.otherClass}),'access_denied');
  errorIs(await api(student.access,'grades',{student_id:ids.classmate}),'access_denied');
  errorIs(await api(student.access,'grades',{student_id:ids.otherStudent}),'access_denied');
  errorIs(await api(student.access,'assignments',{class_id:ids.otherClass}),'access_denied');
 });
 await db.query("insert into scores(student_id,class_id,subject_id,period,continuous_score,final_score) values($1,$2,$3,'نوبت اول',17,19)",[ids.student,ids.class,ids.otherSubject]);
 await test('Teacher class and grade reads use current assigned class AND subject permissions',async()=>{
  assert.deepEqual((await api(teacher.access,'classes')).rows.map(x=>x.id),[ids.class]);
  assert.equal((await api(teacher.access,'grades')).rows.length,2);
  assert.ok((await api(teacher.access,'grades')).rows.every(x=>x.subject_id===ids.subject));
  errorIs(await api(teacher.access,'classes',{class_id:ids.otherClass}),'access_denied');
  errorIs(await api(teacher.access,'grades',{student_id:ids.otherStudent}),'access_denied');
 });
 await test('Manager educational reads use real manager permission without exposing national IDs',async()=>{
  assert.equal((await api(manager.access,'classes')).rows.length,2);
  assert.equal((await api(manager.access,'grades')).rows.length,3);
  assert.equal(JSON.stringify(await api(manager.access,'grades')).includes('national_id'),false);
 });
 await test('Students cannot bypass server report-card visibility using OAuth',async()=>{
  await db.query('update school_settings set report_cards_open=false where id=true');
  errorIs(await api(student.access,'grades'),'access_denied');assert.equal((await api(teacher.access,'grades')).rows.length,2);
  await db.query('update school_settings set report_cards_open=true where id=true');
 });
 await test('Resource API rejects malformed IDs, extra proxy fields and unsafe pagination',async()=>{
  for(const filters of [{class_id:'not-uuid'},{limit:101},{limit:0},{offset:10001},{offset:-1},{table:'auth.users'},{role:'manager'}])errorIs(await api(student.access,'classes',filters),'invalid_request');
  errorIs(await api(student.access,'auth.users'),'invalid_request');
  assert.equal((await api(student.access,'grades',{limit:1,offset:1})).rows.length,1);
 });
 await test('Access tokens expire and unknown tokens cannot authenticate',async()=>{
  const expired=await grant();await db.query("update system_oauth.access_tokens set expires_at=now()-interval '1 second' where token_hash=$1",[expired.access]);
  errorIs(await api(expired.access),'invalid_token');errorIs(await api(hash('unknown')),'invalid_token');
 });
 await test('Refresh rotates atomically, never extends the family deadline and can narrow scopes',async()=>{
  const current=await grant(),nextAccess=hash('rotated-access'),nextRefresh=hash('rotated-refresh');
  const expiry=(await db.query('select expires_at from system_oauth.refresh_tokens where token_hash=$1',[current.refresh])).rows[0].expires_at;
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:nextAccess,next_refresh_hash:nextRefresh,scopes:['profile.read','admin.write']}),'invalid_scope');
  assert.deepEqual((await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:nextAccess,next_refresh_hash:nextRefresh,scopes:['profile.read']})).scopes,['profile.read']);
  assert.equal((await api(nextAccess)).id,ids.student);errorIs(await api(nextAccess,'grades'),'insufficient_scope');
  assert.deepEqual((await db.query('select expires_at from system_oauth.refresh_tokens where token_hash=$1',[nextRefresh])).rows[0].expires_at,expiry);
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:nextRefresh,access_hash:hash('broad-access'),next_refresh_hash:hash('broad-refresh'),scopes:allScopes}),'invalid_scope');
 });
 await test('Reusing a rotated refresh revokes the entire family and persists its audit record',async()=>{
  const current=await grant(),nextAccess=hash('reuse-next-access'),nextRefresh=hash('reuse-next-refresh');
  assert.equal((await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:nextAccess,next_refresh_hash:nextRefresh})).expires_in,900);
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:hash('reuse-attacker'),next_refresh_hash:hash('reuse-attacker-refresh')}),'invalid_grant');
  errorIs(await api(current.access),'invalid_token');errorIs(await api(nextAccess),'invalid_token');
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:nextRefresh,access_hash:hash('reuse-later'),next_refresh_hash:hash('reuse-later-refresh')}),'invalid_grant');
  assert.equal((await db.query("select count(*)::int n from audit_logs where action='OAUTH_REFRESH_REUSE' and record_id=$1",[current.grantId])).rows[0].n,1);
 });
 await test('Expired refresh and refresh from another client fail without issuing tokens',async()=>{
  const current=await grant();
  errorIs(await op('refresh',{client_id:secondId,refresh_hash:current.refresh,access_hash:hash('wrong-client-access'),next_refresh_hash:hash('wrong-client-refresh')}),'invalid_grant');
  await db.query("update system_oauth.refresh_tokens set expires_at=now()-interval '1 second' where token_hash=$1",[current.refresh]);
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:hash('expired-refresh-access'),next_refresh_hash:hash('expired-refresh-next')}),'invalid_grant');
 });
 await test('Revocation is idempotent, client-bound and invalidates access plus refresh',async()=>{
  const current=await grant();assert.equal((await op('revoke',{client_id:secondId,token_hash:current.access})).ok,true);assert.equal((await api(current.access)).id,ids.student);
  assert.equal((await op('revoke',{client_id:clientId,token_hash:current.refresh})).ok,true);assert.equal((await op('revoke',{client_id:clientId,token_hash:current.refresh})).ok,true);
  errorIs(await api(current.access),'invalid_token');errorIs(await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:hash('revoked-access'),next_refresh_hash:hash('revoked-refresh')}),'invalid_grant');
 });
 await test('Connected Apps is private and records last use without leaking token material',async()=>{
  const connections=(await op('connections',{user_id:ids.teacher})).connections;
  assert.ok(connections.some(x=>x.id===teacher.grantId&&x.last_used_at));
  assert.ok(connections.every(x=>x.client_id===clientId));assert.equal(JSON.stringify(connections).includes('token_hash'),false);
  const unrelated=(await op('connections',{user_id:ids.otherStudent})).connections;assert.deepEqual(unrelated,[]);
 });
 await test('Disconnect rejects another user and invalidates every connection for the same app',async()=>{
  const first=await grant(ids.classmate),second=await grant(ids.classmate);
  errorIs(await op('disconnect',{actor:ids.student,session_id:sessions[ids.student].session_id,grant_id:first.grantId,admin:false}),'access_denied');
  assert.equal((await op('disconnect',{actor:ids.classmate,grant_id:first.grantId,admin:false})).ok,true);
  errorIs(await api(first.access),'invalid_token');errorIs(await api(second.access),'invalid_token');
  assert.deepEqual((await op('connections',{user_id:ids.classmate})).connections,[]);
 });
 await test('Admin revocation requires real manager role and fresh MFA',async()=>{
  const current=await grant(ids.classmate);
  errorIs(await op('disconnect',{actor:ids.teacher,grant_id:current.grantId,admin:true,session_id:sessions[ids.teacher].session_id,mfa_time:mfa()}),'access_denied');
  errorIs(await op('disconnect',{actor:ids.manager,grant_id:current.grantId,admin:true,session_id:sessions[ids.manager].session_id,mfa_time:null}),'mfa_required');
  assert.equal((await op('disconnect',{actor:ids.manager,grant_id:current.grantId,admin:true,session_id:sessions[ids.manager].session_id,mfa_time:mfa()})).ok,true);errorIs(await api(current.access),'invalid_token');
 });
 await test('Removing teacher assignments removes OAuth resource access immediately',async()=>{
  await db.query('delete from teacher_assignments where teacher_id=$1',[ids.teacher]);
  assert.deepEqual((await api(teacher.access,'classes')).rows,[]);assert.deepEqual((await api(teacher.access,'grades')).rows,[]);assert.deepEqual((await api(teacher.access,'assignments')).rows,[]);
 });
 await test('Role changes revoke existing grants instead of escalating token authority',async()=>{
  const current=await grant(ids.classmate);await db.query("update profiles set role='manager' where id=$1",[ids.classmate]);
  errorIs(await api(current.access),'invalid_token');
  errorIs(await op('prepare',pending(ids.classmate,{mfa_time:null})),'mfa_required');
  await db.query("update profiles set role='student' where id=$1",[ids.classmate]);
 });
 await test('Password changes and disabled accounts revoke OAuth grants immediately',async()=>{
  const changed=await grant(ids.classmate);await db.query("update auth.users set encrypted_password=crypt('ChangedStrongPassword!',gen_salt('bf')) where id=$1",[ids.classmate]);errorIs(await api(changed.access),'invalid_token');
  const disabled=await grant(ids.classmate);await db.query('update profiles set active=false where id=$1',[ids.classmate]);errorIs(await api(disabled.access),'invalid_token');await db.query('update profiles set active=true where id=$1',[ids.classmate]);errorIs(await api(disabled.access),'invalid_token');
 });
 await test('Auth bans are evaluated live and invalidate refresh credentials',async()=>{
  await db.exec('alter table auth.users add column if not exists banned_until timestamptz');
  const current=await grant(ids.classmate);await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[ids.classmate]);
  errorIs(await api(current.access),'invalid_token');errorIs(await op('prepare',pending(ids.classmate)),'account_not_ready');
  errorIs(await op('refresh',{client_id:clientId,refresh_hash:current.refresh,access_hash:hash('banned-access'),next_refresh_hash:hash('banned-refresh')}),'invalid_grant');
  await db.query('update auth.users set banned_until=null where id=$1',[ids.classmate]);errorIs(await api(current.access),'invalid_token');
 });
 await test('Security changes cancel pending consent before any new grant can be issued',async()=>{
  for(const change of [
   async()=>{await db.query('update profiles set active=false where id=$1',[ids.classmate]);await db.query('update profiles set active=true where id=$1',[ids.classmate]);},
   async()=>{await db.query("update auth.users set encrypted_password=crypt('RevokedPendingPassword!',gen_salt('bf')) where id=$1",[ids.classmate]);}
  ]) {
   const request=pending(ids.classmate);await op('prepare',request);await change();
   errorIs((await decision(request)).result,'invalid_request');
  }
 });
 await test('Disconnect cancels pending consent for the same app while preserving another app',async()=>{
  const connected=await grant(ids.classmate),request=pending(ids.classmate),other=pending(ids.classmate,{client_id:secondId});
  await op('prepare',request);await op('prepare',other);
  assert.equal((await op('disconnect',{actor:ids.classmate,grant_id:connected.grantId})).ok,true);
  errorIs((await decision(request)).result,'invalid_request');assert.equal((await decision(other)).result.approved,true);
 });
 await test('Consent revalidates live client redirects and scopes before issuing a code',async()=>{
  const request=pending();await op('prepare',request);
  await db.query('update system_oauth.clients set redirect_uris=$1 where client_id=$2',[[callback+'/changed'],clientId]);
  errorIs((await decision(request)).result,'invalid_request');
  await db.query('update system_oauth.clients set redirect_uris=$1,allowed_scopes=$2 where client_id=$3',[[callback],['profile.read'],clientId]);
  errorIs((await decision(request)).result,'invalid_request');
  await db.query('update system_oauth.clients set allowed_scopes=$1 where client_id=$2',[allScopes,clientId]);
  assert.equal((await decision(request)).result.approved,true);
 });
 await test('Consent and MFA expiration use wall time even within a long-lived transaction',async()=>{
  const request=pending();await op('prepare',request);await db.exec('begin');
  try {
   await db.query("update system_oauth.requests set expires_at=clock_timestamp()+interval '50 milliseconds' where id=$1",[request.request_id]);
   await new Promise(resolve=>setTimeout(resolve,80));errorIs((await decision(request)).result,'invalid_request');
   const oldMFA=Date.now()/1000-599.95;await new Promise(resolve=>setTimeout(resolve,80));
   errorIs(await op('prepare',pending(ids.manager,{mfa_time:oldMFA})),'mfa_required');
  } finally {await db.exec('rollback');}
 });
 await test('Code, access and refresh expiration use wall time after transaction start',async()=>{
  const request=pending();await op('prepare',request);const {codeHash}=await decision(request),connected=await grant();
  await db.exec('begin');
  try {
   await db.query("update system_oauth.codes set expires_at=clock_timestamp()+interval '50 milliseconds' where code_hash=$1",[codeHash]);
   await db.query("update system_oauth.access_tokens set expires_at=clock_timestamp()+interval '50 milliseconds' where token_hash=$1",[connected.access]);
   await db.query("update system_oauth.refresh_tokens set expires_at=clock_timestamp()+interval '50 milliseconds' where token_hash=$1",[connected.refresh]);
   await new Promise(resolve=>setTimeout(resolve,80));
   errorIs(await op('exchange',{client_id:clientId,code_hash:codeHash,redirect_uri:callback,code_challenge:challenge,access_hash:hash('late-access'),refresh_hash:hash('late-refresh')}),'invalid_grant');
   errorIs(await api(connected.access),'invalid_token');
   errorIs(await op('refresh',{client_id:clientId,refresh_hash:connected.refresh,access_hash:hash('late-rotated-access'),next_refresh_hash:hash('late-rotated-refresh')}),'invalid_grant');
  } finally {await db.exec('rollback');}
 });
 await test('Unsupported transaction isolation cannot bypass fresh post-lock snapshots',async()=>{
  for(const isolation of ['repeatable read','serializable']){
   await db.exec('set role service_role');await db.exec('begin isolation level '+isolation);
   try {await assert.rejects(()=>rpc(db,'oauth_operation',{p_action:'client',p_data:{client_id:clientId}}),/READ COMMITTED/);}finally{await db.exec('rollback');await db.exec('reset role');}
  }
 });
 await test('Client disable revokes all user grants and requires manager MFA',async()=>{
  const current=await grant(ids.classmate,{client_id:secondId});
  errorIs(await op('client_disable',{actor:ids.teacher,session_id:sessions[ids.teacher].session_id,client_id:secondId,mfa_time:mfa()}),'access_denied');
  assert.equal((await op('client_disable',{actor:ids.manager,session_id:sessions[ids.manager].session_id,client_id:secondId,mfa_time:mfa()})).ok,true);
  errorIs(await api(current.access),'invalid_token');errorIs(await op('client',{client_id:secondId}),'invalid_client');
 });
 await test('Database rate limits are shared, enforce exact limits and reset only after the window',async()=>{
  assert.equal((await op('rate',{key:'fixture-rate',limit:2,window_seconds:60})).allowed,true);
  assert.equal((await op('rate',{key:'fixture-rate',limit:2,window_seconds:60})).allowed,true);
  assert.equal((await op('rate',{key:'fixture-rate',limit:2,window_seconds:60})).allowed,false);
  await db.query("update system_oauth.rate_limits set started_at=now()-interval '61 seconds' where key='fixture-rate'");
  assert.equal((await op('rate',{key:'fixture-rate',limit:2,window_seconds:60})).allowed,true);
 });
 await test('Private tables have RLS and security audit contains no token hashes, passwords or secrets',async()=>{
  const tables=(await db.query("select relrowsecurity from pg_class where relnamespace='system_oauth'::regnamespace and relkind='r'")).rows;assert.equal(tables.length,7);assert.ok(tables.every(x=>x.relrowsecurity));
  const audit=JSON.stringify((await db.query("select action,new_data from audit_logs where table_name='oauth'")).rows);
  for(const forbidden of ['secret_hash','token_hash','code_hash','csrf_hash','fixture-client-secret',hash('fixture-client-secret'),'encrypted_password','code_challenge'])assert.equal(audit.includes(forbidden),false,forbidden);
  assert.ok(audit.includes('OAUTH_CONSENT_DENIED'));assert.ok(audit.includes('OAUTH_MFA_REQUIRED'));
  await asUser(db,ids.manager,()=>assert.rejects(()=>db.query("delete from audit_logs where table_name='oauth'"),/permission denied/));
 });
 console.log(`OAuth database lifecycle and permission tests: ${passed} passed.`);
} catch(error) { console.error(error.message,error.cause?.message,error.cause?.cause?.message);process.exitCode=1; }
finally { await db.close(); }
