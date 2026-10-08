import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';

// These are frontend interaction tests with mocked HTTPS/Auth responses, not live Supabase validation.
const html=await readFile('index.html','utf8');
const scripts=await Promise.all(['config.js','app.js','js/core.js','js/auth.js','js/oauth.js'].map(file=>readFile(file,'utf8')));
const query='?oauth=1&client_id=chatgpt&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&response_type=code&scope=profile.read+classes.read&state=opaque-client-state&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256';
const transaction={request_id:'test-request',csrf_token:'test-form-nonce',name:'ChatGPT',scopes:['profile.read','classes.read'],expires_at:new Date(Date.now()+300000).toISOString()};
let checks=0;
const windows=[];
const unexpectedErrors=[];
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));

function harness(options={}){
  const records=[],errors=[],authEvents=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>{if(!error.message.includes('Not implemented')){errors.push(error.message);unexpectedErrors.push(error.message);}});
  const dom=new JSDOM(html,{url:(options.site||'https://school.example/system/index.html')+(options.query??query),runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  windows.push(dom);
  const w=dom.window;
  w.confirm=()=>options.confirm!==false;
  const profile={id:'user-id',full_name:'کاربر <آزمون>',role:options.role||'student',active:true,must_change_password:options.mustChangePassword||false};
  let session=options.signedOut?null:{user:{id:profile.id},access_token:'frontend-test-session'};
  let assurance=options.aal||'aal2';
  const auth={
    getSession:async()=>({data:{session}}),
    onAuthStateChange:()=>{},
    signInWithPassword:async({email,password})=>{authEvents.push(['login',email]);if(password!=='CorrectPassword!')return {data:{},error:{}};session={user:{id:profile.id},access_token:'frontend-test-session'};return {data:{session}};},
    signOut:async()=>{session=null;return {};},
    mfa:{
      getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:assurance}}),
      listFactors:async()=>({data:{totp:options.enroll?[]:[{id:'factor-id',status:'verified'}]}}),
      enroll:async()=>{authEvents.push(['enroll']);return {data:{id:'factor-id',totp:{secret:'ABCD234567',qr_code:'data:image/svg+xml,test',uri:'otpauth://totp/test'}}};},
      challengeAndVerify:async({code})=>{authEvents.push(['mfa',code]);if(code!=='123456')return {error:{}};assurance='aal2';return {};}
    }
  };
  w.supabase={createClient:()=>({auth,from:()=>({select:()=>({eq:()=>({single:async()=>({data:profile})})})}),rpc:async()=>({data:{profiles:[],grades:[],classes:[],subjects:[],assignments:[],classStudents:[],representatives:[]}})})};
  let prepareCount=0,disconnected=false;
  w.fetch=async(url,options)=>{
    const record={url,options,body:options.body?JSON.parse(options.body):undefined};records.push(record);
    const pathname=new URL(url).pathname;
    let status=200,data={};
    if(pathname.endsWith('/oauth/prepare')){
      prepareCount++;
      if(prepareCount===1&&harnessOptions.stepup){status=403;data={error:'mfa_required'};}
      else if(harnessOptions.prepareError){status=400;data={error:harnessOptions.prepareError};}
      else data={...transaction,...harnessOptions.transaction};
    }else if(pathname.endsWith('/oauth/decision'))data={redirect_url:harnessOptions.redirect||'https://chatgpt.com/callback?code=test-code&state=opaque-client-state'};
    else if(pathname.endsWith('/account/connections'))data={connections:disconnected?[]:[{id:'grant-1',name:'ChatGPT',scopes:['profile.read'],created_at:'2026-10-01T12:00:00Z',last_used_at:'2026-10-07T12:00:00Z'}]};
    else if(pathname.endsWith('/account/disconnect')){disconnected=true;data={ok:true};}
    else throw new Error('Unexpected endpoint '+pathname);
    return {ok:status>=200&&status<300,json:async()=>data};
  };
  const harnessOptions=options;
  for(const script of scripts)w.eval(script);
  return {w,dom,records,errors,authEvents,init:()=>w.SystemCore.init()};
}

try{
  const existing=harness();await existing.init();
  assert.equal(existing.w.document.querySelector('#oauthView').classList.contains('hidden'),false);
  assert.equal(existing.w.document.querySelector('#loginView').classList.contains('hidden'),true);
  assert.equal(existing.authEvents.filter(x=>x[0]==='login').length,0);
  assert.match(existing.w.document.querySelector('#oauthContent').textContent,/مشاهده کلاس‌های مجاز/);
  assert.match(existing.w.document.querySelector('#oauthContent').innerHTML,/&lt;آزمون&gt;/);
  assert.equal(existing.w.location.search,'');
  assert.equal(existing.records[0].options.headers.Authorization,'Bearer frontend-test-session');
  assert.equal(existing.records[0].options.credentials,'omit');
  assert.equal(existing.records[0].body.state,'opaque-client-state');
  assert.equal(existing.records.filter(x=>x.url.endsWith('/oauth/decision')).length,0);checks++;

  await existing.w.document.querySelector('#oauthApprove').onclick({});
  const approved=existing.records.find(x=>x.url.endsWith('/oauth/decision'));
  assert.deepEqual(approved.body,{request_id:'test-request',csrf_token:'test-form-nonce',approve:true});checks++;

  const denied=harness();await denied.init();await denied.w.document.querySelector('#oauthDeny').onclick({});
  assert.equal(denied.records.find(x=>x.url.endsWith('/oauth/decision')).body.approve,false);checks++;

  const missing=harness({query:query.replace('&state=opaque-client-state','')});await missing.init();
  assert.equal(missing.records.length,0);assert.match(missing.w.document.querySelector('#oauthContent').textContent,/نامعتبر/);checks++;
  const duplicate=harness({query:query+'&redirect_uri=https%3A%2F%2Fevil.example'});await duplicate.init();
  assert.equal(duplicate.records.length,0);checks++;
  const invalid=harness({prepareError:'invalid_redirect_uri'});await invalid.init();
  assert.equal(invalid.w.document.querySelector('#oauthApprove'),null);assert.match(invalid.w.document.querySelector('#oauthContent').textContent,/نامعتبر/);checks++;

  const wrongResponse=harness({redirect:'javascript:alert(1)'});await wrongResponse.init();await wrongResponse.w.document.querySelector('#oauthApprove').onclick({});
  assert.match(wrongResponse.w.document.querySelector('#oauthContent').textContent,/ارتباط با سرویس/);checks++;
  for(const redirect of ['http://localhost:9000/callback','https://chatgpt.com/callback#fragment','https://user:pass@chatgpt.com/callback']){
    const blocked=harness({redirect});await blocked.init();await blocked.w.document.querySelector('#oauthApprove').onclick({});
    assert.match(blocked.w.document.querySelector('#oauthContent').textContent,/ارتباط با سرویس/);checks++;
  }
  const local=harness({site:'http://localhost:8080/system/index.html',redirect:'http://127.0.0.1:9000/callback?code=test-code&state=opaque-client-state'});
  await local.init();await local.w.document.querySelector('#oauthApprove').onclick({});
  assert.doesNotMatch(local.w.document.querySelector('#oauthContent').textContent,/ارتباط با سرویس/);checks++;

  const password=harness({mustChangePassword:true});await password.init();
  assert.equal(password.w.document.querySelector('#passwordView').classList.contains('hidden'),false);assert.equal(password.records.length,0);checks++;

  const signedOut=harness({signedOut:true});await signedOut.init();
  assert.equal(signedOut.records.length,0);
  signedOut.w.document.querySelector('#loginNationalId').value='0000000004';signedOut.w.document.querySelector('#loginPassword').value='wrong';
  signedOut.w.document.querySelector('#loginForm').dispatchEvent(new signedOut.w.Event('submit',{cancelable:true}));await tick();assert.equal(signedOut.records.length,0);
  signedOut.w.document.querySelector('#loginPassword').value='CorrectPassword!';
  signedOut.w.document.querySelector('#loginForm').dispatchEvent(new signedOut.w.Event('submit',{cancelable:true}));await tick();
  assert.equal(signedOut.records.filter(x=>x.url.endsWith('/oauth/prepare')).length,1);checks++;

  const manager=harness({role:'manager',aal:'aal1',enroll:true});const managerReady=manager.init();await tick();
  assert.equal(manager.records.length,0);assert.equal(manager.w.document.querySelector('#mfaView').classList.contains('hidden'),false);
  assert.equal(manager.w.document.querySelector('#mfaSecret').textContent,'ABCD234567');
  manager.w.document.querySelector('#mfaCode').value='999999';await manager.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});
  assert.equal(manager.records.length,0);checks++;
  manager.w.document.querySelector('#mfaCode').value='123456';await manager.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await managerReady;
  assert.equal(manager.records.filter(x=>x.url.endsWith('/oauth/prepare')).length,1);
  assert.equal(manager.w.document.querySelector('#mfaSecret').textContent,'');assert.equal(manager.w.document.querySelector('#mfaQrImage').hasAttribute('src'),false);
  assert.equal(manager.w.document.querySelector('#mfaCode').value,'');checks++;

  const stepup=harness({role:'manager',stepup:true});const stepupReady=stepup.init();await tick();
  assert.equal(stepup.records.filter(x=>x.url.endsWith('/oauth/prepare')).length,1);
  assert.equal(stepup.w.document.querySelector('#mfaView').classList.contains('hidden'),false);
  stepup.w.document.querySelector('#mfaCode').value='123456';await stepup.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await stepupReady;
  assert.equal(stepup.records.filter(x=>x.url.endsWith('/oauth/prepare')).length,2);checks++;

  const idempotent=harness();await idempotent.init();await idempotent.init();idempotent.w.document.dispatchEvent(new idempotent.w.Event('DOMContentLoaded'));await tick();
  assert.equal(idempotent.records.filter(x=>x.url.endsWith('/oauth/prepare')).length,1);checks++;

  const connected=harness({query:''});await connected.init();
  await connected.w.SchoolV7.routes['connected-apps']();
  assert.match(connected.w.document.querySelector('#connectedApps').textContent,/ChatGPT/);
  await connected.w.document.querySelector('.oauth-disconnect').onclick({});
  assert.deepEqual(connected.records.find(x=>x.url.endsWith('/account/disconnect')).body,{grant_id:'grant-1'});
  assert.match(connected.w.document.querySelector('#connectedApps').textContent,/هیچ برنامه‌ای/);checks++;

  const cancelled=harness({query:'',confirm:false});await cancelled.init();await cancelled.w.SchoolV7.routes['connected-apps']();await cancelled.w.document.querySelector('.oauth-disconnect').onclick({});
  assert.equal(cancelled.records.filter(x=>x.url.endsWith('/account/disconnect')).length,0);checks++;

  await tick();assert.deepEqual(unexpectedErrors,[]);
  console.log(`OAuth frontend interaction tests: ${checks} passed with mocked HTTPS/Auth responses.`);
}finally{for(const dom of windows)dom.window.close();}
