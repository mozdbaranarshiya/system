import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const raw=await readFile('supabase/functions/chatgpt-api/index.ts','utf8');
const source=stripTypeScriptTypes(raw.replace(/^import .*;\r?\n/m,''));
const issuer='https://test.invalid/auth/v1';
const now=Math.floor(Date.now()/1000);
const makeToken=claims=>[
  Buffer.from('{}').toString('base64url'),
  Buffer.from(JSON.stringify({sub:'test-user',client_id:'chatgpt-id',iss:issuer,
    iat:now-10,exp:now+600,aal:'aal1',
    aud:'https://test.invalid/functions/v1/chatgpt-mcp',...claims})).toString('base64url'),'signature'
].join('.');
let count=0;
async function request(action='me',scenario={},method='GET'){
  let handler;
  const calls=[];
  const profile={id:'test-user',full_name:'مدرسه آزمایشی',role:'student',
    active:true,must_change_password:false,...scenario.profile};
  const grant={scopes:['profile.read','classes.read'],
    authorized_at:new Date((now-120)*1000).toISOString(),revoked_at:null,...scenario.grant};
  function table(name){
    const where={};let include=null;let max=null;
    const result=()=>{
      calls.push({table:name,where,include,max});
      if(scenario.failTable===name)return {data:null,error:{message:'test-error'}};
      if(name==='oauth_connected_apps')return {data:scenario.missingGrant?null:grant,error:null};
      if(name==='profiles')return {data:profile,error:null};
      if(name==='class_students')return {data:(scenario.studentClasses||['my-class']).map(class_id=>({class_id})),error:null};
      if(name==='teacher_assignments')return {data:(scenario.teacherClasses||['my-class']).map(class_id=>({class_id})),error:null};
      if(name==='classes')return {data:(scenario.allClasses||[
        {id:'my-class',title:'کلاس من',academic_year:'1405-1406'},
        {id:'other-class',title:'کلاس غیرمجاز',academic_year:'1405-1406'}
      ]).filter(x=>include===null||include.includes(x.id)).slice(0,max||100),error:null};
      throw Error('unexpected table '+name);
    };
    const q={
      select:()=>q,eq:(key,val)=>{where[key]=val;return q;},
      in:(_,vals)=>{include=vals;return q;},
      order:()=>q,limit:n=>{max=n;return q;},
      single:async()=>result(),maybeSingle:async()=>result(),
      then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)
    };
    return q;
  }
  const admin={from:table};
  const caller={auth:{getUser:async()=>({
    data:{user:scenario.invalidAuth?null:{id:'test-user'}},
    error:scenario.invalidAuth?{message:'invalid'}:null
  })}};
  vm.runInNewContext(source,{
    createClient:(_url,key)=>key==='service'?admin:caller,
    Deno:{env:{get:name=>({
      SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'public',
      SUPABASE_SERVICE_ROLE_KEY:'service',CHATGPT_OAUTH_CLIENT_ID:'chatgpt-id',
      CHATGPT_OAUTH_PRIVACY_SAFE:scenario.privacySafe===false?'false':'true',
      CHATGPT_RESOURCE_AUDIENCE:'https://test.invalid/functions/v1/chatgpt-mcp'
    })[name]},serve:fn=>handler=fn},
    Request,Response,URL,Date,JSON,Object,String,Number,Set,Promise,
    atob:encoded=>Buffer.from(encoded,'base64').toString('binary')
  });
  const token=makeToken(scenario.claims||{});
  const headers=scenario.noAuth?{}:{Authorization:'Bearer '+token};
  const response=await handler(new Request('https://test.invalid/chatgpt-api/'+action,{method,headers}));
  return {status:response.status,data:await response.json(),calls};
}
async function check(title,action,scenario,status,expected){
  const result=await request(action,scenario);
  assert.equal(result.status,status,title);
  if(expected)assert.deepEqual(result.data,expected,title);
  count++;
  return result;
}
await check('Privacy gate fails closed','me',{privacySafe:false},503,{error:'not_configured'});
await check('Reject missing Bearer','me',{noAuth:true},401);
await check('Reject another OAuth client','me',{claims:{client_id:'wrong-client'}},401);
await check('Reject expired access tokens','me',{claims:{exp:now-1}},401);
await check('Reject tokens from unexpected issuer','me',{claims:{iss:'https://evil.invalid'}},401);
await check('Reject OAuth token for other audience','me',{claims:{aud:'authenticated'}},401);
await check('Reject national-ID derived JWT email','me',{claims:{email:'0000000004@school.local'}},401);
await check('Reject tokens failed by Supabase Auth','me',{invalidAuth:true},401);
await check('Reject client without grant','me',{missingGrant:true},403);
await check('Reject revoked grant','me',{grant:{revoked_at:new Date().toISOString()}},403);
await check('Reject inactive user','me',{profile:{active:false}},403);
await check('Reject initial password user','me',{profile:{must_change_password:true}},403);
await check('Reject missing profile scope','me',{grant:{scopes:['classes.read']}},403);
await check('Reject manager without AAL2','me',{profile:{role:'manager'}},403);
await check('Accept manager with AAL2','me',{profile:{role:'manager'},claims:{aal:'aal2'}},200,
  {id:'test-user',display_name:'مدرسه آزمایشی'});
await check('Profile response omits national ID','me',{},200,
  {id:'test-user',display_name:'مدرسه آزمایشی'});
const student=await check('Student class isolation','my/classes',{},200,
  {classes:[{id:'my-class',title:'کلاس من',academic_year:'1405-1406'}]});
assert.equal(student.calls.some(c=>c.table==='classes'&&c.include?.includes('other-class')),false);
const teacher=await check('Teacher class isolation','my/classes',{profile:{role:'teacher'},
  teacherClasses:['other-class']},200,
  {classes:[{id:'other-class',title:'کلاس غیرمجاز',academic_year:'1405-1406'}]});
assert.equal(teacher.calls.some(c=>c.table==='teacher_assignments'&&c.where.teacher_id==='test-user'),true);
await check('Unassigned student sees nothing','my/classes',{studentClasses:[]},200,{classes:[]});
await check('Reject missing classes scope','my/classes',{grant:{scopes:['profile.read']}},403);
await check('Reject disabled account','my/classes',{profile:{active:false}},403);
await check('No DB errors leaked','me',{failTable:'profiles'},503,{error:'service_unavailable'});
assert.equal((await request('me',{},'POST')).status,405);count++;
assert.equal((await request('unlisted')).status,404);count++;
const sql=await readFile('supabase/migrations/20261009_chatgpt_oauth.sql','utf8');
assert.match(sql,/oauth_no_direct_access/);
assert.match(sql,/pgrst\.db_pre_request/);
assert.match(sql,/oauth_no_direct_storage/);
assert.match(sql,/enable row level security/);
count+=4;
console.log('OAuth resource server and security guard tests:',count,'passed (mocked Auth/DB, no production calls).');
