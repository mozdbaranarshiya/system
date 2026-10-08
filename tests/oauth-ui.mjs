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
  const records=[],errors=[],authEvents=[],timeline=[],clipboard=[];
  const console=new VirtualConsole();
  console.on('jsdomError',error=>{if(!error.message.includes('Not implemented')){errors.push(error.message);unexpectedErrors.push(error.message);}});
  const dom=new JSDOM(html,{url:(options.site||'https://school.example/system/index.html')+(options.query??query),runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  windows.push(dom);
  const w=dom.window;
  w.confirm=()=>options.confirm!==false;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value=>{clipboard.push(value);}}});
  const profile={id:'user-id',full_name:'کاربر <آزمون>',role:options.role||'student',active:true,must_change_password:options.mustChangePassword||false};
  let session=options.signedOut?null:{user:{id:profile.id},access_token:'frontend-test-session'};
  let assurance=options.aal||'aal2';
  const authCallbacks=new Set();
  const auth={
    getSession:async()=>({data:{session}}),
    onAuthStateChange:callback=>{authCallbacks.add(callback);return {data:{subscription:{unsubscribe:()=>authCallbacks.delete(callback)}}};},
    signInWithPassword:async({email,password})=>{authEvents.push(['login',email]);if(password!=='CorrectPassword!')return {data:{},error:{}};session={user:{id:profile.id},access_token:'frontend-test-session'};return {data:{session}};},
    signOut:async()=>{session=null;return {};},
    mfa:{
      getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:assurance}}),
      listFactors:async()=>({data:{totp:options.enroll?[]:[{id:'factor-id',status:'verified'}]}}),
      enroll:async()=>{authEvents.push(['enroll']);return {data:{id:'factor-id',totp:{secret:'ABCD234567',qr_code:'data:image/svg+xml,test',uri:'otpauth://totp/test'}}};},
      challengeAndVerify:async({code})=>{authEvents.push(['mfa',code]);timeline.push(['mfa',code]);if(code!=='123456')return {error:{}};assurance='aal2';if(options.switchAfterMfa)session={user:{id:'other-user'},access_token:'other-test-session'};return {};}
    }
  };
  w.supabase={createClient:()=>({auth,from:()=>({select:()=>({eq:()=>({single:async()=>({data:profile})})})}),rpc:async()=>({data:{profiles:[],grades:[],classes:[],subjects:[],assignments:[],classStudents:[],representatives:[]}})})};
  let prepareCount=0,disconnected=false;
  w.fetch=async(url,options)=>{
    const record={url,options,body:options.body?JSON.parse(options.body):undefined};records.push(record);
    const pathname=new URL(url).pathname;
    timeline.push(['request',pathname]);
    let status=200,data={};
    if(pathname.endsWith('/oauth/prepare')){
      prepareCount++;
      if(prepareCount===1&&harnessOptions.stepup){status=403;data={error:'mfa_required'};}
      else if(harnessOptions.prepareError){status=400;data={error:harnessOptions.prepareError};}
      else data={...transaction,...harnessOptions.transaction};
    }else if(pathname.endsWith('/oauth/decision'))data={redirect_url:harnessOptions.redirect||'https://chatgpt.com/callback?code=test-code&state=opaque-client-state'};
    else if(pathname.endsWith('/account/connections'))data={connections:disconnected?[]:[{id:'grant-1',name:'ChatGPT',scopes:['profile.read'],created_at:'2026-10-01T12:00:00Z',last_used_at:'2026-10-07T12:00:00Z'}]};
    else if(pathname.endsWith('/account/disconnect')){disconnected=true;data={ok:true};}
    else if(pathname.endsWith('/account/admin/clients')){
      if(harnessOptions.registerError){status=403;data={error:harnessOptions.registerError};}
      else data={ok:true,client_id:'00000000-0000-4000-8000-000000000008',client_secret:'scs_'+('A'.repeat(42))+'8'};
      if(harnessOptions.switchDuringRegistration)session={user:{id:'other-user'},access_token:'other-test-session'};
    }
    else throw new Error('Unexpected endpoint '+pathname);
    return {ok:status>=200&&status<300,json:async()=>data};
  };
  const harnessOptions=options;
  for(const script of scripts)w.eval(script);
  return {w,dom,records,errors,authEvents,timeline,clipboard,init:()=>w.SystemCore.init(),switchUser:async id=>{
    session={user:{id},access_token:'other-test-session'};
    for(const callback of authCallbacks)await callback('SIGNED_IN',session);
  }};
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

  const staleConsent=harness();await staleConsent.init();await staleConsent.switchUser('other-user');
  await staleConsent.w.document.querySelector('#oauthApprove').onclick({});
  assert.equal(staleConsent.records.filter(record=>record.url.endsWith('/oauth/decision')).length,0);
  assert.match(staleConsent.w.document.querySelector('#oauthContent').textContent,/نشست شما معتبر نیست/);checks++;

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
  assert.equal(connected.w.document.querySelector('#oauthClientForm'),null);
  assert.match(connected.w.document.querySelector('#connectedApps').textContent,/ChatGPT/);
  await connected.w.document.querySelector('.oauth-disconnect').onclick({});
  assert.deepEqual(connected.records.find(x=>x.url.endsWith('/account/disconnect')).body,{grant_id:'grant-1'});
  assert.match(connected.w.document.querySelector('#connectedApps').textContent,/هیچ برنامه‌ای/);checks++;

  const cancelled=harness({query:'',confirm:false});await cancelled.init();await cancelled.w.SchoolV7.routes['connected-apps']();await cancelled.w.document.querySelector('.oauth-disconnect').onclick({});
  assert.equal(cancelled.records.filter(x=>x.url.endsWith('/account/disconnect')).length,0);checks++;

  const teacher=harness({query:'',role:'teacher'});await teacher.init();await teacher.w.SchoolV7.routes['connected-apps']();
  assert.equal(teacher.w.document.querySelector('#oauthClientCard'),null);assert.match(teacher.w.document.querySelector('#connectedApps').textContent,/ChatGPT/);checks++;

  const staleConnections=harness({query:''});await staleConnections.init();await staleConnections.switchUser('other-user');
  await staleConnections.w.SchoolV7.routes['connected-apps']();
  assert.equal(staleConnections.records.filter(record=>record.url.endsWith('/account/connections')).length,0);
  assert.match(staleConnections.w.document.querySelector('#connectedApps').textContent,/نشست شما معتبر نیست/);checks++;

  const clientManager=harness({query:'',role:'manager'});await clientManager.init();await clientManager.w.SchoolV7.routes['connected-apps']();
  const doc=clientManager.w.document,callback='https://chatgpt.com/aip/12345/oauth/callback?workspace=0088';
  assert.equal(doc.querySelector('#oauthClientName').value,'ChatGPT');assert.equal(doc.querySelector('#oauthClientPkce').checked,true);
  assert.deepEqual([...doc.querySelectorAll('.oauth-client-scope')].map(input=>[input.value,input.checked]),[
    ['profile.read',true],['classes.read',false],['grades.read',false],['assignments.read',false]
  ]);checks++;
  doc.querySelector('#oauthClientCallback').value=callback;
  doc.querySelector('#oauthClientCallback').dispatchEvent(new clientManager.w.Event('input',{bubbles:true}));await tick();
  assert.equal(doc.querySelector('#oauthClientCallback').value,callback);
  const registering=doc.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  assert.equal(doc.querySelector('#mfaView').classList.contains('hidden'),false);
  assert.equal(clientManager.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);checks++;
  doc.querySelector('#mfaCode').value='999999';await doc.querySelector('#mfaForm').onsubmit({preventDefault(){}});
  assert.equal(clientManager.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);
  assert.equal(doc.querySelector('#mfaView').classList.contains('hidden'),false);checks++;
  doc.querySelector('#mfaCode').value='123456';await doc.querySelector('#mfaForm').onsubmit({preventDefault(){}});await registering;await tick();
  const registered=clientManager.records.find(record=>record.url.endsWith('/account/admin/clients'));
  assert.deepEqual(registered.body,{name:'ChatGPT',redirect_uris:[callback],allowed_scopes:['profile.read'],public_client:false,pkce_required:true});
  assert.equal(registered.options.headers.Authorization,'Bearer frontend-test-session');assert.equal(registered.options.credentials,'omit');
  assert.ok(clientManager.timeline.findIndex(event=>event[0]==='mfa'&&event[1]==='123456')<clientManager.timeline.findIndex(event=>event[0]==='request'&&event[1].endsWith('/account/admin/clients')));checks++;
  const secret='scs_'+('A'.repeat(42))+'8',secretInput=doc.querySelector('#oauthRegisteredClientSecret');
  assert.equal(doc.querySelector('#oauthRegisteredClientId').value,'00000000-0000-4000-8000-000000000008');
  assert.equal(secretInput.value,secret);assert.equal(secretInput.hasAttribute('data-machine-text'),true);
  const endpoint=clientManager.w.APP_CONFIG.SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/oauth-connector';
  assert.equal(doc.querySelector('#oauthRegisteredAuthorizeUrl').value,endpoint+'/oauth/authorize');
  assert.equal(doc.querySelector('#oauthRegisteredTokenUrl').value,endpoint+'/oauth/token');assert.equal(doc.querySelector('#oauthRegisteredScopes').value,'profile.read');
  assert.deepEqual(clientManager.clipboard,[]);
  for(const storage of [clientManager.w.localStorage,clientManager.w.sessionStorage])for(let index=0;index<storage.length;index++)assert.equal(storage.getItem(storage.key(index)).includes(secret),false);
  assert.doesNotMatch(clientManager.w.location.href,/scs_/);
  await doc.querySelector('#oauthCopyClientSecret').onclick({});assert.deepEqual(clientManager.clipboard,[secret]);checks++;
  await doc.querySelector('#oauthDismissCredentials').onclick({});
  assert.equal(secretInput.value,'');assert.equal(doc.querySelector('#oauthRegisteredClientSecret'),null);assert.equal(doc.querySelector('#oauthClientCredentials').hidden,true);checks++;

  const switchedBeforeMfa=harness({query:'',role:'manager',enroll:true});await switchedBeforeMfa.init();await switchedBeforeMfa.w.SchoolV7.routes['connected-apps']();
  switchedBeforeMfa.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  await switchedBeforeMfa.switchUser('other-user');
  const switchedBeforePending=switchedBeforeMfa.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  assert.equal(switchedBeforeMfa.w.document.querySelector('#mfaView').classList.contains('hidden'),true);
  assert.equal(switchedBeforeMfa.authEvents.filter(event=>['enroll','mfa'].includes(event[0])).length,0);
  assert.equal(switchedBeforeMfa.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);
  assert.match(switchedBeforeMfa.w.document.querySelector('#oauthClientMessage').textContent,/نشست شما معتبر نیست/);
  await switchedBeforePending;checks++;

  for(const [option,expectedCalls] of [['switchAfterMfa',0],['switchDuringRegistration',1]]){
    const switched=harness({query:'',role:'manager',[option]:true});await switched.init();await switched.w.SchoolV7.routes['connected-apps']();
    switched.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
    const switchedPending=switched.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
    switched.w.document.querySelector('#mfaCode').value='123456';await switched.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await switchedPending;
    assert.equal(switched.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,expectedCalls);
    assert.equal(switched.w.document.querySelector('#oauthRegisteredClientSecret'),null);assert.equal(switched.w.document.querySelector('#oauthClientCredentials').hidden,true);
    assert.match(switched.w.document.querySelector('#oauthClientMessage').textContent,/نشست شما معتبر نیست/);checks++;
  }

  const changedAfter=harness({query:'',role:'manager'});await changedAfter.init();await changedAfter.w.SchoolV7.routes['connected-apps']();
  changedAfter.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  const changedAfterPending=changedAfter.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  changedAfter.w.document.querySelector('#mfaCode').value='123456';await changedAfter.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await changedAfterPending;
  const changedAfterSecret=changedAfter.w.document.querySelector('#oauthRegisteredClientSecret');assert.equal(changedAfterSecret.value,secret);
  await changedAfter.switchUser('other-user');
  assert.equal(changedAfterSecret.value,'');assert.equal(changedAfter.w.document.querySelector('#oauthRegisteredClientSecret'),null);checks++;

  const selected=harness({query:'',role:'manager'});await selected.init();await selected.w.SchoolV7.routes['connected-apps']();
  selected.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  selected.w.document.querySelector('#oauthClientPkce').checked=false;
  selected.w.document.querySelector('.oauth-client-scope[value="classes.read"]').checked=true;
  const selectedPending=selected.w.document.querySelector('#oauthClientForm').onsubmit({preventDefault(){}});await tick();
  selected.w.document.querySelector('#mfaCode').value='123456';await selected.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await selectedPending;
  assert.deepEqual(selected.records.find(record=>record.url.endsWith('/account/admin/clients')).body.allowed_scopes,['profile.read','classes.read']);
  assert.equal(selected.records.find(record=>record.url.endsWith('/account/admin/clients')).body.pkce_required,false);
  const selectedSecret=selected.w.document.querySelector('#oauthRegisteredClientSecret');
  await selected.w.SystemCore.logout();assert.equal(selectedSecret.value,'');assert.equal(selected.w.document.querySelector('#oauthClientCredentials').hidden,true);checks++;

  const cancelledRegistration=harness({query:'',role:'manager'});await cancelledRegistration.init();await cancelledRegistration.w.SchoolV7.routes['connected-apps']();
  cancelledRegistration.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  const cancelledPending=cancelledRegistration.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  await cancelledRegistration.w.document.querySelector('#mfaLogout').onclick();await cancelledPending;
  assert.equal(cancelledRegistration.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);
  assert.equal(cancelledRegistration.w.document.querySelector('#appView').classList.contains('hidden'),true);
  assert.equal(cancelledRegistration.w.document.querySelector('#loginView').classList.contains('hidden'),false);
  assert.equal(cancelledRegistration.w.SystemCore.state.profile,null);checks++;

  for(const redirect of ['http://localhost:9000/callback','http://evil.example/callback','https://user:password@chatgpt.com/callback','https://chatgpt.com/callback#fragment','javascript:alert(1)']){
    const unsafe=harness({query:'',role:'manager'});await unsafe.init();await unsafe.w.SchoolV7.routes['connected-apps']();
    unsafe.w.document.querySelector('#oauthClientCallback').value=redirect;
    await unsafe.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});
    assert.equal(unsafe.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);
    assert.equal(unsafe.authEvents.filter(event=>event[0]==='mfa').length,0);
    assert.equal(unsafe.w.document.querySelector('#mfaView').classList.contains('hidden'),true);checks++;
  }

  const noScopes=harness({query:'',role:'manager'});await noScopes.init();await noScopes.w.SchoolV7.routes['connected-apps']();
  noScopes.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  noScopes.w.document.querySelector('.oauth-client-scope:checked').checked=false;
  await noScopes.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});
  assert.equal(noScopes.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,0);assert.match(noScopes.w.document.querySelector('#oauthClientMessage').textContent,/حداقل یک/);checks++;

  const localClient=harness({query:'',role:'manager',site:'http://localhost:8080/system/index.html'});await localClient.init();await localClient.w.SchoolV7.routes['connected-apps']();
  localClient.w.document.querySelector('#oauthClientCallback').value='http://127.0.0.1:9090/callback?state=100';
  const localClientPending=localClient.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  localClient.w.document.querySelector('#mfaCode').value='123456';await localClient.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await localClientPending;
  assert.equal(localClient.records.filter(record=>record.url.endsWith('/account/admin/clients')).length,1);checks++;

  const deniedClient=harness({query:'',role:'manager',registerError:'access_denied'});await deniedClient.init();await deniedClient.w.SchoolV7.routes['connected-apps']();
  deniedClient.w.document.querySelector('#oauthClientCallback').value='https://chatgpt.com/callback';
  const deniedClientPending=deniedClient.w.document.querySelector('#oauthClientRegister').onclick({preventDefault(){}});await tick();
  deniedClient.w.document.querySelector('#mfaCode').value='123456';await deniedClient.w.document.querySelector('#mfaForm').onsubmit({preventDefault(){}});await deniedClientPending;
  assert.equal(deniedClient.w.document.querySelector('#oauthRegisteredClientSecret'),null);
  assert.match(deniedClient.w.document.querySelector('#oauthClientMessage').textContent,/ارتباط با سرویس/);checks++;

  await tick();assert.deepEqual(unexpectedErrors,[]);
  console.log(`OAuth frontend interaction tests: ${checks} passed with mocked HTTPS/Auth responses.`);
}finally{for(const dom of windows)dom.window.close();}
