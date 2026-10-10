import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const context={window:{SystemCore:{state:{},$:()=>{},esc:String,toEnDigits:value=>String(value).replace(/[۰-۹]/g,d=>'0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])}},Intl,Date,Map,Object,clearInterval};
vm.createContext(context);await vm.runInContext(await readFile('js/core.js','utf8'),context);await vm.runInContext(await readFile('js/reports.js','utf8'),context);
const V=context.window.SchoolV7;
for(const [fa,en] of [['۱۴۰۵/۰۷/۱۰','2026-10-02'],['1404/01/01','2025-03-21'],['1403/12/30','2025-03-20']])assert.equal(V.gregorian(fa),en);
assert.throws(()=>V.gregorian('1404/12/30'));assert.throws(()=>V.gregorian('1405/13/01'));
const report=V.reportData({scores:[{subject_id:'math',period:'نوبت اول',lesson_score:16},{subject_id:'math',period:'نوبت دوم',lesson_score:19},{subject_id:'science',period:'نوبت اول',lesson_score:0},{subject_id:'science',period:'نوبت دوم',lesson_score:null}]});
assert.equal(report.first,8);assert.equal(report.second,19);assert.equal(report.annual,17.5);assert.equal(report.rows[1].annual,null);
const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));assert.equal(manifest.dir,'rtl');assert.equal(manifest.lang,'fa');
for(const [file,size] of [['favicon-16x16.png',16],['favicon-32x32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
const bytes=await readFile('assets/icons/'+file);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
const ico=await readFile('assets/icons/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
const html=await readFile('index.html','utf8');for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await readFile(match[1]);
for(const file of ['app.js','config.js',...(await readdir('js')).map(f=>'js/'+f)])assert.equal(/sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/.test(await readFile(file,'utf8')),false);

// Exercise the real frontend entry points with a local SDK/storage test double.
// Schema selection must cover all SDK queries, and cached data must never cross projects or schemas.
const appSource=await readFile('app.js','utf8');
const userId='00000000-0000-4000-8000-000000000004';
async function configuredApp(settings={},stored={}){
  const dom=new JSDOM(html,{url:'https://school.test/index.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,storageCalls=[],uploads=[],signOutCalls=[];
  const profile={id:userId,role:'student',full_name:'کاربر آزمون',active:true};
  const task={id:'task-id',class_id:'class-id',subject_id:'subject-id',title:'تکلیف آزمون',due_at:new Date(Date.now()+3600000).toISOString()};
  const oldFile=userId+'/task-id/old.pdf';
  const tables={profiles:[profile],scores:[],assignments:[task],assignment_submissions:[{id:'submission-id',assignment_id:task.id,student_id:userId,file_path:oldFile,status:'pending',original_name:'old.pdf'}]};
  const bootstrap={profiles:[profile],grades:[],classes:[],subjects:[],assignments:[],classStudents:[],representatives:[]};
  let clientOptions,bootstrapCalls=0,profilesBeforeBootstrap=[];
  class Query{
    constructor(table){this.table=table;}
    select(){return this;}eq(){return this;}order(){return this;}
    single(){return Promise.resolve({data:tables[this.table]?.[0]});}
    then(resolve,reject){return Promise.resolve({data:tables[this.table]||[]}).then(resolve,reject);}
  }
  const sdk={
    from:table=>new Query(table),
    rpc:async name=>{if(name==='get_app_bootstrap'){bootstrapCalls++;profilesBeforeBootstrap=[...w.SystemCore.state.profiles];return {data:bootstrap};}return {data:true};},
    auth:{
      getSession:async()=>({data:{session:{user:{id:userId},access_token:'unit-session'}}}),onAuthStateChange:()=>{},
      signOut:async options=>{signOutCalls.push(options);return {};},
      mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1'}}),listFactors:async()=>({data:{totp:[{id:'unit-factor',status:'verified'}]}})}
    },
    storage:{from:bucket=>({
      createSignedUrl:async file=>{storageCalls.push({bucket,action:'sign',file});return {data:{signedUrl:'https://storage.test/signed'}};},
      remove:async files=>{storageCalls.push({bucket,action:'remove',files});return {};}
    })}
  };
  w.APP_CONFIG={SUPABASE_URL:'https://source.supabase.test',SUPABASE_ANON_KEY:'public-test-key',...settings};
  w.supabase={createClient:(_url,_key,options)=>{clientOptions=options;return sdk;}};
  w.open=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.XMLHttpRequest=class{
    constructor(){this.upload={};this.status=200;}
    open(method,url){uploads.push({method,url});}
    setRequestHeader(){}
    send(){this.onload();}
  };
  for(const [key,value] of Object.entries(stored))w.sessionStorage.setItem(key,value);
  w.eval(appSource);await w.SystemCore.init();
  return {w,dom,sdk,profile,storageCalls,uploads,signOutCalls,clientOptions,get bootstrapCalls(){return bootstrapCalls;},get profilesBeforeBootstrap(){return profilesBeforeBootstrap;},snapshot:()=>Object.fromEntries(Array.from({length:w.sessionStorage.length},(_,i)=>{const key=w.sessionStorage.key(i);return [key,w.sessionStorage.getItem(key)];}))};
}
const localApps=[];
try{
  const initial=await configuredApp();localApps.push(initial);
  assert.equal(initial.clientOptions.db.schema,'public');
  assert.equal(Object.hasOwn(initial.clientOptions,'auth'),false,'Legacy configuration must retain the SDK default Auth storage key.');
  assert.equal(initial.bootstrapCalls,1);
  const same=await configuredApp({},initial.snapshot());localApps.push(same);
  assert.equal(same.profilesBeforeBootstrap.length,1,'Same-project/schema cached references should be present during background refresh.');
  const school=await configuredApp({SUPABASE_DB_SCHEMA:'school',ASSIGNMENT_BUCKET:'school-assignment-files',SUPABASE_AUTH_STORAGE_KEY:'system-school-pukan-auth'},initial.snapshot());localApps.push(school);
  assert.equal(school.clientOptions.db.schema,'school');
  assert.equal(school.clientOptions.auth.storageKey,'system-school-pukan-auth','Same-origin applications must be able to keep separate Auth persistence/broadcast namespaces.');
  assert.equal(school.bootstrapCalls,1,'A different schema must load fresh references.');
  assert.equal(school.profilesBeforeBootstrap.length,0,'A different schema must not expose cached references while loading.');
  const target=await configuredApp({SUPABASE_URL:'https://target.supabase.test'},initial.snapshot());localApps.push(target);
  assert.equal(target.bootstrapCalls,1,'A different project must load fresh references.');
  assert.equal(target.profilesBeforeBootstrap.length,0,'A different project must not expose cached references while loading.');
  for(const [app,bucket] of [[initial,'assignment-files'],[school,'school-assignment-files']]){
    await app.w.SystemCore.navigate('homework');
    await app.w.document.querySelector('.open-file').onclick();
    await app.w.document.querySelector('.submit-homework').onclick();
    const input=app.w.document.querySelector('#hwFile');
    Object.defineProperty(input,'files',{configurable:true,value:[new app.w.File(['test'],'work.pdf',{type:'application/pdf'})]});
    await input.onchange();await input.onchange();
    await app.w.document.querySelector('#modalSubmit').onclick();
    assert.equal(app.uploads.length,2);
    for(const upload of app.uploads)assert.equal(new URL(upload.url).pathname.startsWith('/storage/v1/object/'+bucket+'/'),true);
    assert.equal(app.storageCalls.some(call=>call.action==='sign'),true);
    assert.equal(app.storageCalls.filter(call=>call.action==='remove').length,2);
    assert.equal(app.storageCalls.every(call=>call.bucket===bucket),true);
  }
  // Exercise the actual logout and failed-authentication paths. A second app on
  // the same native Auth project must keep its independently signed-in session.
  for(const [app,scope] of [[initial,undefined],[school,'local']]){
    const previousMfa=app.sdk.auth.mfa;
    await app.w.SystemCore.logout();
    assert.equal(app.signOutCalls.at(-1)?.scope,scope,'Ordinary logout should respect isolated-school versus legacy session scope.');
    assert.equal(app.w.document.querySelector('#loginView').classList.contains('hidden'),false);
    app.profile.active=false;
    await app.w.SystemCore.enterApp();
    assert.equal(app.signOutCalls.at(-1)?.scope,scope,'Rejected school access must not globally sign out another application.');
    app.profile.active=true;app.profile.role='manager';
    app.sdk.auth.mfa={getAuthenticatorAssuranceLevel:async()=>({error:new Error('Unavailable MFA context')})};
    await app.w.SystemCore.enterApp();
    assert.equal(app.signOutCalls.at(-1)?.scope,scope,'Failed MFA must use the same session boundary.');
    app.sdk.auth.mfa=previousMfa;app.w.SystemCore.state.profile=app.profile;
    const pending=app.w.SystemCore.ensureManagerMfa();
    const cancel=app.w.document.querySelector('#mfaLogout');
    for(let i=0;i<10&&typeof cancel.onclick!=='function';i++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(typeof cancel.onclick,'function','The real MFA challenge must expose its cancellation action.');
    await cancel.onclick();assert.equal(await pending,false);
    assert.equal(app.signOutCalls.at(-1)?.scope,scope,'Cancelled MFA must not revoke independently signed-in sessions.');
    assert.equal(app.signOutCalls.length,4,'All four logout paths should execute exactly one SDK sign-out.');
  }
}finally{for(const app of localApps)app.dom.window.close();}
console.log('Unit checks passed: Jalali leap days, report averages, icon sizes, manifest paths, public client configuration, schema/project cache isolation, configured assignment storage, isolated Auth persistence, and ordinary/rejected/MFA logout scope.');
