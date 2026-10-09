import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
// Exercise request validation without credentials or calls to a live Auth project.
const source=stripTypeScriptTypes((await readFile('supabase/functions/account-security/index.ts','utf8')).replace(/^import .*;\n/,''));
let checks=0;
async function invoke(scenario={},body={current_password:'OldPassword123!',new_password:'NewPassword123!'}){
const writes=[],signouts=[],profile={id:'caller',role:'student',active:true,national_id:'0000000004',...scenario.profile};let handler;
const admin={auth:{admin:{updateUserById:async(id,attrs)=>{writes.push({id,attrs});return {error:scenario.authUpdateError||null};}}},rpc:async(name,args)=>{assert.equal(name,'apply_profile_patch');assert.equal(args.p_actor,'caller');writes.push({id:args.p_user,attrs:args.p_patch});return {error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:profile,error:null})})})})};
const caller={auth:{getClaims:async()=>({data:{claims:scenario.oauthClient?{client_id:'third-party'}:{}},error:null}),getUser:async()=>({data:{user:scenario.invalidToken?null:{id:'caller',email:'0000000004@school.local'}},error:scenario.invalidToken?{}:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:scenario.aal||'aal2'},error:null})}}};
const verifier={auth:{signInWithPassword:async args=>({data:{user:args.password==='OldPassword123!'?{id:'caller'}:null},error:args.password==='OldPassword123!'?null:{}}),signOut:async args=>{signouts.push(args);return {error:null};}}};
vm.runInNewContext(source,{Deno:{env:{get:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret'})[name]},serve:fn=>handler=fn},createClient:(url,key,options)=>key==='secret'?admin:options?.global?caller:verifier,Request,Response,Date,Error,JSON,String,Object});
const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)}));
return {response:await response.json(),writes,signouts};}
for(const [scenario,body,error] of [
[{invalidToken:true},undefined,'UNAUTHORIZED'],[{oauthClient:true},undefined,'UNAUTHORIZED'],[{profile:{active:false}},undefined,'UNAUTHORIZED'],[{profile:{role:'manager'},aal:'aal1'},undefined,'MFA_REQUIRED'],
[{}, {current_password:'OldPassword123!',new_password:'short'},'WEAK_PASSWORD'],[{}, {current_password:'OldPassword123!',new_password:'OldPassword123!'},'WEAK_PASSWORD'],
[{}, {current_password:'OldPassword123!',new_password:'0000000004'},'WEAK_PASSWORD'],[{}, {current_password:'wrong',new_password:'NewPassword123!'},'WRONG_PASSWORD']]){
const result=await invoke(scenario,body);assert.equal(result.response.ok,false);assert.equal(result.response.error,error);assert.equal(result.writes.length,0);checks++;}
const own=await invoke({profile:{must_change_password:true}},{current_password:'OldPassword123!',new_password:'NewPassword123!',user_id:'someone-else'});
assert.equal(own.response.ok,true);assert.equal(own.writes[0].id,'caller');assert.equal(own.writes[1].attrs.must_change_password,false);assert.equal(own.signouts[0].scope,'local');checks++;
const failed=await invoke({authUpdateError:{message:'sensitive technical details'}});assert.equal(failed.response.error,'PASSWORD_UPDATE_FAILED');assert.equal(JSON.stringify(failed.response).includes('sensitive'),false);checks++;
console.log(`Account security request tests: ${checks} passed with mocked Auth and database clients.`);
