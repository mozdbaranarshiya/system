import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// These are HTTP boundary tests with mocked SDK clients, not native Auth tests.
const source=stripTypeScriptTypes((await readFile('supabase/functions/admin-user/index.ts','utf8')).replace(/^import .*;\n/,''));
const actor='00000000-0000-0000-0000-000000000001';
const member='00000000-0000-0000-0000-000000000002';
const foreign='00000000-0000-0000-0000-000000000003';
const created='00000000-0000-0000-0000-000000000004';
const manager='00000000-0000-0000-0000-000000000005';
const session='00000000-0000-0000-0000-000000000006';
const jwt=claims=>`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.mockSignature`;
let checks=0;
const update=(userId,password)=>({action:'update',user_id:userId,national_id:'0000000002',full_name:'School member',role:'student',...(password?{password}:{})});

async function invoke(body,scenario={}){
  let handler;
  const clients=[],queries=[],mutations=[],sessionChecks=[];
  const token=scenario.token??jwt({sub:actor,session_id:session,aal:scenario.aal||'aal2',role:'authenticated',aud:'authenticated',iss:'https://test.invalid/auth/v1',exp:Math.floor(Date.now()/1000)+3600,...scenario.claims});
  const profiles={
    [actor]:{id:actor,role:'manager',active:true,must_change_password:false,...scenario.actor},
    [member]:{id:member,role:'teacher',active:true},
    [manager]:{id:manager,role:'manager',active:true},
    ...(scenario.profiles||{}),
  };
  const admin={
    auth:{admin:{
      updateUserById:async(id,attrs)=>{mutations.push({kind:'authUpdate',id,attrs});return {error:scenario.authUpdateError||null};},
      deleteUser:async(id)=>{mutations.push({kind:'authDelete',id});return {error:null};},
      createUser:async(attrs)=>{mutations.push({kind:'authCreate',attrs});return scenario.createError?{data:{user:null},error:scenario.createError}:{data:{user:{id:created}},error:null};},
    }},
    from:table=>({select:columns=>({eq:(field,id)=>({single:async()=>{
      queries.push({table,columns,field,id});
      const targetError=id!==actor&&scenario.targetError;
      return {data:profiles[id]||null,error:targetError||(!profiles[id]?{message:'missing private application user'}:null)};
    }})})}),
    rpc:async(name,args)=>{
      if(name==='assert_manager_session'){
        sessionChecks.push(args);
        if(scenario.sessionThrows)throw new Error('private session lookup failure');
        return {data:scenario.sessionReady===undefined?true:scenario.sessionReady,error:scenario.sessionError||null};
      }
      mutations.push({kind:'rpc',name,args});
      return {error:name==='remove_profile_access'?scenario.deleteError||null:scenario.patchError||null};
    },
  };
  const caller={auth:{
    getUser:async supplied=>{assert.equal(supplied,token);return {data:{user:scenario.invalidToken?null:{id:actor}},error:scenario.invalidToken?{}:null};},
    mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:scenario.aal||'aal2'},error:null})},
  }};
  const env={SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'secret',...(scenario.schema===undefined?{}:{SYSTEM_DB_SCHEMA:scenario.schema})};
  vm.runInNewContext(source,{
    Deno:{env:{get:name=>env[name]},serve:fn=>handler=fn},
    createClient:(url,key,options)=>{clients.push({url,key,options});return key==='secret'?admin:caller;},
    Request,Response,Error,JSON,String,Object,atob,TextDecoder,Uint8Array,console:{error:()=>{}},
  });
  const response=await handler(new Request('https://test.invalid/functions/v1/admin-user',{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),
  }));
  assert.equal(response.status,200);
  return {result:await response.json(),mutations:JSON.parse(JSON.stringify(mutations)),queries,clients,sessionChecks:JSON.parse(JSON.stringify(sessionChecks))};
}

async function test(name,fn){await fn();checks++;console.log(`ok ${checks} - ${name}`);}
const rejected=async(body,scenario,error='TARGET_NOT_MANAGED')=>{
  const result=await invoke(body,scenario);
  assert.deepEqual(result.result,{ok:false,error});
  assert.equal(result.mutations.length,0,'Rejected targets must cause no Auth or database writes');
};

await test('Foreign Auth user cannot have identity or metadata updated',()=>rejected(update(foreign),{schema:'school'}));
await test('Foreign Auth user cannot have password reset or account gated',()=>rejected(update(foreign,'NewPassword123!'),{schema:'school'}));
await test('Foreign Auth user cannot be deleted in a shared project',()=>rejected({action:'delete',user_id:foreign},{schema:'school'}));
await test('Legacy public project also rejects deletion of a nonmember',()=>rejected({action:'delete',user_id:foreign},{}));
await test('Legacy public project also rejects password reset of a nonmember',()=>rejected(update(foreign,'NewPassword123!'),{}));
await test('Client-supplied profile or role cannot manufacture membership',()=>rejected({...update(foreign),profile:{id:foreign,role:'student'},existing_role:'teacher'},{schema:'school'}));
await test('Existing manager cannot be demoted through account update',()=>rejected(update(manager),{schema:'school'}));
await test('Existing manager cannot be deleted',()=>rejected({action:'delete',user_id:manager},{schema:'school'}));
await test('Manager cannot delete their own identity',()=>rejected({action:'delete',user_id:actor},{schema:'school'},'CANNOT_DELETE_SELF'));
await test('Target database failure exposes only a safe error code',()=>rejected(update(member),{schema:'school',targetError:{message:'private database information'}}));
await test('Shared-project delete removes school access without deleting Auth',async()=>{
  const result=await invoke({action:'delete',user_id:member},{schema:'school'});
  assert.deepEqual(result.result,{ok:true});
  assert.deepEqual(result.mutations,[{kind:'rpc',name:'remove_profile_access',args:{p_user:member,p_actor:actor}}]);
  assert.equal(result.queries.at(-1).id,member);
});
await test('School removal failure never falls back to deleting Auth',async()=>{
  const result=await invoke({action:'delete',user_id:member},{schema:'school',deleteError:{message:'private foreign key data'}});
  assert.deepEqual(result.result,{ok:false,error:'PROFILE_DELETE_FAILED'});
  assert.equal(result.mutations.length,1);
  assert.equal(result.mutations[0].kind,'rpc');
});
await test('Legacy public delete preserves Auth deletion after membership validation',async()=>{
  const result=await invoke({action:'delete',user_id:member});
  assert.deepEqual(result.result,{ok:true});
  assert.deepEqual(result.mutations,[{kind:'authDelete',id:member}]);
  assert.equal(result.queries.at(-1).id,member);
  assert.equal(result.clients.every(client=>client.options.db.schema==='public'),true);
});
await test('Legitimate member password reset is gated before Auth mutation',async()=>{
  const result=await invoke(update(member,'NewPassword123!'),{schema:'school'});
  assert.deepEqual(result.result,{ok:true});
  assert.deepEqual(result.mutations[0],{kind:'rpc',name:'apply_profile_patch',args:{p_user:member,p_actor:actor,p_patch:{must_change_password:true}}});
  assert.equal(result.mutations[1].kind,'authUpdate');
  assert.equal(result.mutations[1].id,member);
  assert.equal(result.mutations[1].attrs.password,'NewPassword123!');
  assert.equal(result.mutations[2].name,'apply_profile_patch');
  assert.equal(result.clients.every(client=>client.options.db.schema==='school'),true);
});
await test('Failed password gate prevents Auth mutation',async()=>{
  const result=await invoke(update(member,'NewPassword123!'),{schema:'school',patchError:{message:'gate error'}});
  assert.deepEqual(result.result,{ok:false,error:'PROFILE_UPDATE_FAILED'});
  assert.equal(result.mutations.length,1);
  assert.equal(result.mutations[0].kind,'rpc');
});
await test('Manager still requires MFA for privileged account operations',()=>rejected(update(member),{schema:'school',aal:'aal1'},'MFA_REQUIRED'));
await test('Retained signed AAL2 token cannot reset a password after its factor is removed',()=>rejected(update(member,'NewPassword123!'),{schema:'school',sessionError:{message:'factor removed'}},'MFA_REQUIRED'));
await test('Retained signed AAL2 token cannot create users after session downgrade',()=>rejected({action:'create',national_id:'0000000004',full_name:'New student',role:'student'},{schema:'school',sessionError:{message:'persisted session is aal1'}},'MFA_REQUIRED'));
await test('Retained signed AAL2 token cannot delete after logout removes its session',()=>rejected({action:'delete',user_id:member},{schema:'school',sessionError:{message:'session removed'}},'MFA_REQUIRED'));
await test('Persisted expired session rejects identity changes before any mutation',()=>rejected(update(member),{schema:'school',sessionError:{message:'session expired'}},'MFA_REQUIRED'));
await test('Unavailable or nontrue manager-session proof fails closed',async()=>{
  for(const scenario of [{sessionReady:false},{sessionReady:null},{sessionThrows:true}])await rejected(update(member),{schema:'school',...scenario},'MFA_REQUIRED');
});
await test('Only the verified native JWT session and user are sent to the proof RPC',async()=>{
  const result=await invoke({action:'health',user_id:foreign,session_id:foreign},{schema:'school'});
  assert.equal(result.result.ok,true);
  assert.deepEqual(result.sessionChecks,[{p_user:actor,p_session:session}]);
  assert.equal(result.mutations.length,0);
});
await test('Current manager-session proof preserves the existing MFA policy without an age cutoff',async()=>{
  const result=await invoke({action:'health'},{schema:'school',claims:{amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-86400}]}});
  assert.equal(result.result.ok,true);
  assert.deepEqual(result.sessionChecks,[{p_user:actor,p_session:session}]);
});
await test('Invalid signed manager metadata is rejected before session proof or mutation',async()=>{
  for(const claims of [{sub:foreign},{session_id:undefined},{session_id:'not-a-uuid'},{aal:'aal1'},{role:'service_role'},{aud:'foreign-app'},{iss:'https://other.invalid/auth/v1'},{client_id:foreign},{exp:0},{exp:undefined}]){
    const result=await invoke(update(member),{schema:'school',claims});
    assert.deepEqual(result.result,{ok:false,error:'MFA_REQUIRED'});
    assert.equal(result.sessionChecks.length,0);
    assert.equal(result.mutations.length,0);
  }
});
await test('Malformed signed JWT payload is rejected before session proof or mutation',async()=>{
  for(const token of ['not-a-jwt','header.invalid-json.signature','header.bnVsbA.signature']){
    const result=await invoke(update(member),{schema:'school',token});
    assert.deepEqual(result.result,{ok:false,error:'MFA_REQUIRED'});
    assert.equal(result.sessionChecks.length,0);
    assert.equal(result.mutations.length,0);
  }
});
await test('Rejected Auth token cannot reach the signed-session boundary',async()=>{
  const result=await invoke(update(member),{schema:'school',invalidToken:true});
  assert.equal(result.result.ok,false);
  assert.equal(result.sessionChecks.length,0);
  assert.equal(result.queries.length,0);
  assert.equal(result.mutations.length,0);
});
await test('Inactive manager cannot manage accounts',()=>rejected(update(member),{schema:'school',actor:{active:false}},'USER_INACTIVE'));
await test('Manager with pending password change cannot manage accounts',()=>rejected(update(member),{schema:'school',actor:{must_change_password:true}},'ACCOUNT_NOT_READY'));
await test('Teacher caller cannot manage accounts regardless of client role',()=>rejected(update(member),{schema:'school',actor:{role:'teacher'}},'MANAGER_ONLY'));
await test('Malformed configured schema fails before SDK calls or mutations',async()=>{
  for(const schema of ['school,public','school;drop table profiles','school/profile','a'.repeat(64)]){
    const result=await invoke(update(member),{schema});
    assert.deepEqual(result.result,{ok:false,error:'INVALID_DB_SCHEMA'});
    assert.equal(result.clients.length,0);
    assert.equal(result.mutations.length,0);
  }
});
await test('Profile creation rollback deletes only the freshly created identity',async()=>{
  const result=await invoke({action:'create',national_id:'0000000004',full_name:'New student',role:'student'},{schema:'school',patchError:{message:'profile failed'}});
  assert.equal(result.result.ok,false);
  assert.deepEqual(result.mutations.filter(item=>item.kind==='authDelete'),[{kind:'authDelete',id:created}]);
  assert.equal(result.mutations[1].args.p_user,created);
});
await test('Failed or colliding Auth creation cannot delete an existing user',async()=>{
  const result=await invoke({action:'create',national_id:'0000000004',full_name:'New student',role:'student'},{schema:'school',createError:{message:'existing account'}});
  assert.equal(result.result.ok,false);
  assert.equal(result.mutations.length,1);
  assert.equal(result.mutations[0].kind,'authCreate');
});

console.log(`Admin account request tests: ${checks} passed with mocked Auth and schema-bound database clients.`);
