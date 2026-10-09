import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const script=await readFile('js/oauth.js','utf8');
let checks=0;
const markup=`<!doctype html><html><body>
<div id="oauthConsentView" class="hidden"></div>
<div id="oauthError" class="hidden"></div>
<button id="oauthApprove" disabled></button>
<button id="oauthDeny" disabled></button>
<div id="oauthClientName"></div>
<div id="oauthAccountName"></div>
<div id="oauthAccountRole"></div>
<div id="oauthRedirectUri"></div>
<div id="oauthNativeScopes"></div>
<div id="oauthConnectedApps"></div>
</body></html>`;
function sandbox(options={}){
  const dom=new JSDOM(markup,{url:'https://school.example/system/?authorization_id=auth-id',runScripts:'outside-only'});
  const w=dom.window, records={approved:0,denied:0,upserted:0,revoked:0,updated:0};
  const grant={client_id:'client-123',scopes:['profile.read','classes.read'],
    authorized_at:new Date().toISOString(),revoked_at:null};
  const details={authorization_id:'auth-id',client:{id:'client-123',name:'ChatGPT'},
    scope:'profile',redirect_uri:'https://chatgpt.example/callback',...options.details};
  const oauth={
    getAuthorizationDetails:async()=>({data:details,error:null}),
    getUserGrants:async()=>({data:[{client_id:'client-123',scopes:['profile']}],error:null}),
    approveAuthorization:async()=>{records.approved++;return {error:{message:'stop navigation'}};},
    denyAuthorization:async()=>{records.denied++;return {error:{message:'stop navigation'}};},
    revokeGrant:async()=>{records.revoked++;return {error:null};}
  };
  const db={from:table=>{
    assert.equal(table,'oauth_connected_apps');
    const q={
      select:()=>q,eq:()=>q,maybeSingle:async()=>({data:grant.revoked_at?null:grant,error:null}),
      upsert:async()=>{records.upserted++;return {error:options.denyWrite?{}:null};},
      update:()=>{records.updated++;grant.revoked_at=new Date().toISOString();return q;},
      then:(resolve,reject)=>Promise.resolve({error:null}).then(resolve,reject),
    };
    return q;
  }};
  w.APP_CONFIG={CHATGPT_OAUTH_CLIENT_ID:'client-123',CHATGPT_OAUTH_PRIVACY_SAFE:options.privacy!==false};
  const state={sb:{auth:{oauth},...db},profile:{id:'user-abc',active:true,full_name:'کاربر آزمایشی',role:'student',must_change_password:false}};
  w.SystemCore={state,$:x=>w.document.querySelector(x),showOnlyView:sel=>{w.document.querySelector(sel).classList.remove('hidden');},toast:()=>{}};
  w.SchoolV7={datetime:x=>x,label:x=>x};
  w.confirm=()=>true;
  w.eval(script);
  return {w,dom,records,grant};
}
async function test(label,options,fn){
  const x=sandbox(options);
  try {await fn(x);checks++;} catch(e){throw new Error(label+': '+e.message,{cause:e});}
  finally{x.dom.window.close();}
}
await test('valid client, profile-only consent',{},async({w})=>{
  assert.equal(await w.SchoolOAuth.showConsent(),true);
  assert.equal(w.document.querySelector('#oauthApprove').disabled,false);
  assert.equal(w.document.querySelector('#oauthClientName').textContent,'ChatGPT');
  assert.equal(w.document.querySelector('#oauthAccountName').textContent,'کاربر آزمایشی');
});
await test('wrong OAuth client denied',{details:{client:{id:'wrong',name:'Other'}}},async({w})=>{
  await w.SchoolOAuth.showConsent();
  assert.equal(w.document.querySelector('#oauthApprove').disabled,true);
  assert.equal(w.document.querySelector('#oauthError').classList.contains('hidden'),false);
});
await test('national-ID email scope denied',{details:{scope:'email profile'}},async({w})=>{
  await w.SchoolOAuth.showConsent();
  assert.equal(w.document.querySelector('#oauthApprove').disabled,true);
});
await test('privacy gate blocks consent',{privacy:false},async({w})=>{
  await w.SchoolOAuth.showConsent();
  assert.equal(w.document.querySelector('#oauthApprove').disabled,true);
});
await test('deny calls OAuth provider, without granting DB',{},async({w,records})=>{
  await w.SchoolOAuth.showConsent();
  await w.document.querySelector('#oauthDeny').onclick();
  assert.equal(records.denied,1);assert.equal(records.upserted,0);
});
await test('approve uses local grant and rolls back failed provider authorization',{},async({w,records})=>{
  await w.SchoolOAuth.showConsent();
  await w.document.querySelector('#oauthApprove').onclick();
  assert.equal(records.upserted,1);assert.equal(records.approved,1);assert.equal(records.updated,1);
});
await test('failed grant never calls OAuth approval',{denyWrite:true},async({w,records})=>{
  await w.SchoolOAuth.showConsent();
  await w.document.querySelector('#oauthApprove').onclick();
  assert.equal(records.approved,0);
});
await test('connected apps can revoke locally and natively',{},async({w,records,grant})=>{
  await w.SchoolOAuth.renderConnectedApps();
  const button=w.document.querySelector('#oauthConnectedApps button');
  assert.ok(button);
  await button.onclick();
  assert.equal(records.revoked,1);assert.equal(records.updated,1);
  assert.ok(grant.revoked_at);
});
console.log('OAuth consent and connected apps DOM checks:',checks,'passed with mocked Auth and database.');
