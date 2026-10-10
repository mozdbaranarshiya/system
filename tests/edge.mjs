import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
// Exercise request validation without credentials or calls to a live Auth project.
const source=stripTypeScriptTypes((await readFile('supabase/functions/account-security/index.ts','utf8')).replace(/^import .*;\n/,''));
const actor='00000000-0000-0000-0000-000000000001';
const session='00000000-0000-0000-0000-000000000006';
const jwt=claims=>`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.mockSignature`;
let checks=0;
async function invoke(scenario={},body={current_password:'OldPassword123!',new_password:'NewPassword123!'}){
const writes=[],signouts=[],clients=[],sessionChecks=[],verifications=[],profile={id:actor,role:'student',active:true,national_id:'0000000004',...scenario.profile};let handler;
const token=scenario.token??jwt({sub:actor,session_id:session,aal:scenario.aal||'aal2',role:'authenticated',aud:'authenticated',iss:'https://test.invalid/auth/v1',exp:Math.floor(Date.now()/1000)+3600,...scenario.claims});
const admin={auth:{admin:{updateUserById:async(id,attrs)=>{writes.push({id,attrs});return {error:scenario.authUpdateError||null};}}},rpc:async(name,args)=>{
if(name==='assert_manager_session'){sessionChecks.push(args);if(scenario.sessionThrows)throw new Error('private session lookup failure');return {data:scenario.sessionReady===undefined?true:scenario.sessionReady,error:scenario.sessionError||null};}
assert.equal(name,'apply_profile_patch');assert.equal(args.p_actor,actor);writes.push({id:args.p_user,attrs:args.p_patch});return {error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:profile,error:null})})})})};
const caller={auth:{getUser:async supplied=>{assert.equal(supplied,token);return {data:{user:scenario.invalidToken?null:{id:actor,email:'0000000004@school.local'}},error:scenario.invalidToken?{}:null};}}};
const verifier={auth:{signInWithPassword:async args=>{verifications.push(args);return {data:{user:args.password==='OldPassword123!'?{id:actor}:null},error:args.password==='OldPassword123!'?null:{}};},signOut:async args=>{signouts.push(args);return {error:null};}}};
vm.runInNewContext(source,{Deno:{env:{get:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',SYSTEM_DB_SCHEMA:scenario.schema})[name]},serve:fn=>handler=fn},createClient:(url,key,options)=>{clients.push({url,key,options});return key==='secret'?admin:options?.global?caller:verifier;},Request,Response,Date,Error,JSON,String,Object,atob,TextDecoder,Uint8Array});
const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}));
return {response:await response.json(),writes,signouts,clients,sessionChecks:JSON.parse(JSON.stringify(sessionChecks)),verifications};}
for(const [scenario,body,error] of [
[{invalidToken:true},undefined,'UNAUTHORIZED'],[{profile:{active:false}},undefined,'UNAUTHORIZED'],[{profile:{role:'manager'},aal:'aal1'},undefined,'MFA_REQUIRED'],
[{}, {current_password:'OldPassword123!',new_password:'short'},'WEAK_PASSWORD'],[{}, {current_password:'OldPassword123!',new_password:'OldPassword123!'},'WEAK_PASSWORD'],
[{}, {current_password:'OldPassword123!',new_password:'0000000004'},'WEAK_PASSWORD'],[{}, {current_password:'wrong',new_password:'NewPassword123!'},'WRONG_PASSWORD']]){
const result=await invoke(scenario,body);assert.equal(result.response.ok,false);assert.equal(result.response.error,error);assert.equal(result.writes.length,0);checks++;}
const own=await invoke({profile:{must_change_password:true}},{current_password:'OldPassword123!',new_password:'NewPassword123!',user_id:'someone-else'});
assert.equal(own.response.ok,true);assert.equal(own.writes[0].id,actor);assert.equal(own.writes[1].attrs.must_change_password,false);assert.equal(own.signouts[0].scope,'local');checks++;
const failed=await invoke({authUpdateError:{message:'sensitive technical details'}});assert.equal(failed.response.error,'PASSWORD_UPDATE_FAILED');assert.equal(JSON.stringify(failed.response).includes('sensitive'),false);checks++;
const scoped=await invoke({schema:'school'});assert.equal(scoped.response.ok,true);assert.equal(scoped.clients[0].options.db.schema,'school');assert.equal(scoped.clients[1].options.db.schema,'school');assert.equal(scoped.clients[2].options.db,undefined,'Password verifier is an Auth-only client');assert.equal(scoped.writes.every(write=>write.id===actor),true);checks++;
const legacy=await invoke();assert.equal(legacy.clients[0].options.db.schema,'public');assert.equal(legacy.clients[1].options.db.schema,'public');checks++;
const invalidSchema=await invoke({schema:'school,public'});assert.equal(invalidSchema.response.error,'PASSWORD_UPDATE_FAILED');assert.equal(invalidSchema.clients.length,0);assert.equal(invalidSchema.writes.length,0);checks++;
for(const reason of ['factor removed','persisted session is aal1','session removed after logout','persisted session expired']){
const result=await invoke({schema:'school',profile:{role:'manager'},sessionError:{message:reason}});assert.deepEqual(result.response,{ok:false,error:'MFA_REQUIRED'});assert.equal(result.writes.length,0);assert.equal(result.verifications.length,0);assert.equal(result.sessionChecks.length,1);checks++;
}
for(const scenario of [{sessionReady:false},{sessionReady:null},{sessionThrows:true}]){
const result=await invoke({schema:'school',profile:{role:'manager'},...scenario});assert.deepEqual(result.response,{ok:false,error:'MFA_REQUIRED'});assert.equal(result.writes.length,0);assert.equal(result.verifications.length,0);
}checks++;
const initialManager=await invoke({schema:'school',profile:{role:'manager',must_change_password:true}});assert.equal(initialManager.response.ok,true);assert.deepEqual(initialManager.sessionChecks,[{p_user:actor,p_session:session}]);assert.equal(initialManager.writes[0].id,actor);assert.equal(initialManager.writes[1].attrs.must_change_password,false);checks++;
const establishedManager=await invoke({schema:'school',profile:{role:'manager'},claims:{amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-86400}]}});assert.equal(establishedManager.response.ok,true);assert.deepEqual(establishedManager.sessionChecks,[{p_user:actor,p_session:session}]);checks++;
const normal=await invoke({schema:'school',aal:'aal1'});assert.equal(normal.response.ok,true);assert.equal(normal.sessionChecks.length,0);checks++;
for(const claims of [{sub:'00000000-0000-0000-0000-000000000099'},{session_id:undefined},{session_id:'invalid'},{aal:'aal1'},{role:'service_role'},{aud:'other'},{iss:'https://other.invalid/auth/v1'},{client_id:session},{exp:0},{exp:undefined}]){
const result=await invoke({schema:'school',profile:{role:'manager'},claims});assert.deepEqual(result.response,{ok:false,error:'MFA_REQUIRED'});assert.equal(result.sessionChecks.length,0);assert.equal(result.writes.length,0);assert.equal(result.verifications.length,0);
}checks++;
const malformed=await invoke({schema:'school',profile:{role:'manager'},token:'header.invalid-json.signature'});assert.deepEqual(malformed.response,{ok:false,error:'MFA_REQUIRED'});assert.equal(malformed.sessionChecks.length,0);assert.equal(malformed.writes.length,0);checks++;
console.log(`Account security request tests: ${checks} passed with mocked Auth and database clients.`);
