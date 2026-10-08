import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {database} from './database-setup.mjs';
import {seed,migrate,ids} from './fixtures.mjs';
import {adapter} from './adapter.mjs';

// Real Chromium rendering/navigation with mocked Auth/OAuth HTTPS responses.
// School profile/bootstrap reads use the real PostgreSQL test database and RLS adapter.
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const db=await database();
await seed(db);await migrate(db);
const query=adapter(db),root=process.cwd(),errors=[];
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/__db'){
      let body='';for await(const part of req)body+=part;
      res.setHeader('Content-Type','application/json');
      try{res.end(JSON.stringify(await query(JSON.parse(body))));}
      catch(error){res.end(JSON.stringify({data:null,error:{message:error.message,code:error.code}}));}
      return;
    }
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const requestQuery='?oauth=1&client_id=chatgpt-browser-test&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcallback&response_type=code&scope=profile.read+classes.read+grades.read+assignments.read&state=browser-test-state&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256';
await mkdir('test-results/tmp',{recursive:true});
process.env.TMPDIR=path.resolve('test-results/tmp');
let browser,checks=0;
const contexts=[];

async function session(user,viewport,authorize=true){
  const context=await browser.newContext({viewport,timezoneId:'Asia/Tehran'});
  contexts.push(context);
  const page=await context.newPage(),calls=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(userId=>window.__TEST_USER=userId,ids[user]);
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'text/javascript',path:path.join(root,'tests/mock-supabase.js')}));
  await page.route('https://*.supabase.co/**',async route=>{
    const request=route.request(),pathname=new URL(request.url()).pathname;
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(!pathname.startsWith('/functions/v1/oauth-connector/')){errors.push('Unexpected live backend request: '+pathname);await route.abort();return;}
    const body=request.postDataJSON();
    calls.push({pathname,body,headers:request.headers()});
    assert.equal(request.headers().authorization,'Bearer local-test-token');
    assert.equal(request.headers().origin,origin);
    let response;
    if(pathname.endsWith('/oauth/prepare')){
      assert.equal(body.state,'browser-test-state');
      response={request_id:'browser-test-request',csrf_token:'browser-test-nonce',name:'ChatGPT',scopes:['profile.read','classes.read','grades.read','assignments.read'],expires_at:new Date(Date.now()+300000).toISOString()};
    }else if(pathname.endsWith('/oauth/decision')){
      assert.deepEqual(body,{request_id:'browser-test-request',csrf_token:'browser-test-nonce',approve:body.approve});
      response={redirect_url:'https://chatgpt.com/callback?'+(body.approve?'code=browser-test-code':'error=access_denied')+'&state=browser-test-state'};
    }else if(pathname.endsWith('/account/connections')){
      response={connections:calls.some(call=>call.pathname.endsWith('/account/disconnect'))?[]:[{id:'browser-test-grant',client_id:'chatgpt-browser-test',name:'ChatGPT',scopes:['profile.read','classes.read'],created_at:'2026-10-07T08:30:00Z',last_used_at:'2026-10-07T09:00:00Z'}]};
    }else if(pathname.endsWith('/account/disconnect')){
      assert.deepEqual(body,{grant_id:'browser-test-grant'});response={ok:true};
    }else if(pathname.endsWith('/account/admin/clients')){
      response={ok:true,client_id:'00000000-0000-4000-8000-000000000008',client_secret:'scs_'+('B'.repeat(42))+'8'};
    }else{errors.push('Unexpected OAuth endpoint '+pathname);await route.fulfill({status:404,headers,body:JSON.stringify({error:'invalid_request'})});return;}
    await route.fulfill({status:200,headers,body:JSON.stringify(response)});
  });
  await page.route('https://chatgpt.com/callback**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Mock OAuth callback received</body></html>'}));
  await page.goto(origin+'/index.html'+(authorize?requestQuery:''));
  await page.waitForFunction(()=>window.SystemCore?.state.profile);
  if(authorize)await page.locator('#oauthApprove').waitFor({state:'visible'});
  return {page,context,calls};
}
async function consentLayout(page,filename){
  assert.equal(await page.locator('#loginView').isVisible(),false);
  assert.equal(await page.locator('#mfaView').isVisible(),false);
  assert.equal(await page.locator('#oauthView').isVisible(),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#oauthView')).direction),'rtl');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Horizontal overflow');
  assert.equal(await page.locator('#oauthContent li').count(),4);
  assert.equal(await page.evaluate(()=>location.search),'');
  await page.screenshot({path:'test-results/'+filename,fullPage:true});checks++;
}

try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const desktop=await session('student',{width:1440,height:1000});
  await consentLayout(desktop.page,'oauth-consent-desktop.png');
  assert.equal(desktop.calls.filter(call=>call.pathname.endsWith('/oauth/decision')).length,0);
  await desktop.page.getByRole('button',{name:'اجازه می‌دهم'}).click();
  await desktop.page.waitForURL('https://chatgpt.com/callback**');
  assert.equal(new URL(desktop.page.url()).searchParams.get('code'),'browser-test-code');
  assert.equal(new URL(desktop.page.url()).searchParams.get('state'),'browser-test-state');
  assert.equal(desktop.calls.find(call=>call.pathname.endsWith('/oauth/decision')).body.approve,true);checks++;

  const mobile=await session('teacher',{width:390,height:844});
  await consentLayout(mobile.page,'oauth-consent-mobile.png');
  await mobile.page.getByRole('button',{name:'لغو',exact:true}).click();
  await mobile.page.waitForURL('https://chatgpt.com/callback**');
  const denial=new URL(mobile.page.url());
  assert.equal(denial.searchParams.get('error'),'access_denied');
  assert.equal(denial.searchParams.get('state'),'browser-test-state');
  assert.equal(denial.searchParams.has('code'),false);
  assert.equal(mobile.calls.find(call=>call.pathname.endsWith('/oauth/decision')).body.approve,false);checks++;

  const connected=await session('student',{width:390,height:844},false);
  await connected.page.waitForFunction(()=>document.querySelector('#content').textContent.includes('برنامه امروز'));
  await connected.page.evaluate(()=>window.SystemCore.navigate('connected-apps'));
  await connected.page.locator('.oauth-disconnect').waitFor({state:'visible'});
  assert.match(await connected.page.locator('#connectedApps').textContent(),/ChatGPT/);
  assert.equal(await connected.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Connected apps overflow');
  connected.page.once('dialog',dialog=>dialog.accept());
  await connected.page.getByRole('button',{name:'قطع اتصال',exact:true}).click();
  await connected.page.waitForFunction(()=>document.querySelector('#connectedApps').textContent.includes('هیچ برنامه‌ای'));
  assert.equal(connected.calls.filter(call=>call.pathname.endsWith('/account/disconnect')).length,1);checks++;

  const manager=await session('manager',{width:390,height:844},false);
  await manager.page.waitForFunction(()=>document.querySelector('#content').textContent.includes('برنامه امروز'));
  await manager.page.evaluate(()=>{
    window.__TEST_MFA=[];
    window.SystemCore.state.sb.auth.mfa.challengeAndVerify=async({code})=>{
      window.__TEST_MFA.push(code);
      return code==='123456'?{}:{error:{message:'Invalid fixture OTP'}};
    };
    return window.SystemCore.navigate('connected-apps');
  });
  const callback='https://chatgpt.com/aip/12345/oauth/callback?workspace=0088';
  await manager.page.locator('#oauthClientCallback').fill(callback);
  assert.equal(await manager.page.locator('#oauthClientCallback').inputValue(),callback);
  assert.equal(await manager.page.locator('#oauthClientName').inputValue(),'ChatGPT');
  assert.deepEqual(await manager.page.locator('.oauth-client-scope').evaluateAll(inputs=>inputs.map(input=>[input.value,input.checked])),[
    ['profile.read',true],['classes.read',false],['grades.read',false],['assignments.read',false]
  ]);
  assert.equal(await manager.page.locator('#oauthClientPkce').isChecked(),true);
  assert.equal(await manager.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Manager registration form overflow');
  await manager.page.screenshot({path:'test-results/oauth-manager-registration-mobile.png',fullPage:true});
  await manager.page.locator('#oauthClientRegister').click();
  await manager.page.locator('#mfaView').waitFor({state:'visible'});
  assert.equal(manager.calls.filter(call=>call.pathname.endsWith('/account/admin/clients')).length,0);
  await manager.page.locator('#mfaCode').fill('999999');
  await manager.page.locator('#mfaSubmit').click();
  await manager.page.waitForFunction(()=>window.__TEST_MFA.includes('999999'));
  assert.equal(manager.calls.filter(call=>call.pathname.endsWith('/account/admin/clients')).length,0);
  assert.equal(await manager.page.locator('#mfaView').isVisible(),true);
  await manager.page.locator('#mfaCode').fill('123456');
  await manager.page.locator('#mfaSubmit').click();
  await manager.page.locator('#oauthClientCredentials').waitFor({state:'visible'});
  assert.equal(await manager.page.locator('#appView').isVisible(),true);
  assert.equal(await manager.page.locator('#mfaView').isVisible(),false);
  assert.equal(await manager.page.locator('#oauthClientCallback').inputValue(),callback);
  const registrationCalls=manager.calls.filter(call=>call.pathname.endsWith('/account/admin/clients'));
  assert.equal(registrationCalls.length,1);
  assert.deepEqual(registrationCalls[0].body,{name:'ChatGPT',redirect_uris:[callback],allowed_scopes:['profile.read'],public_client:false,pkce_required:true});
  assert.equal(await manager.page.locator('#oauthRegisteredClientId').inputValue(),'00000000-0000-4000-8000-000000000008');
  assert.equal(await manager.page.locator('#oauthRegisteredClientSecret').inputValue(),'scs_'+('B'.repeat(42))+'8');
  const secretInput=await manager.page.locator('#oauthRegisteredClientSecret').elementHandle();
  assert.equal(await manager.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Manager registration result overflow');
  assert.equal(await manager.page.locator('#oauthClientCredentials button').evaluateAll(buttons=>buttons.some(button=>button.scrollWidth>button.clientWidth+1)),false,'Manager credential button text overflow');
  await manager.page.screenshot({path:'test-results/oauth-manager-credentials-mobile.png',fullPage:true});
  await manager.page.locator('#oauthDismissCredentials').click();
  assert.equal(await secretInput.evaluate(input=>input.value),'','Dismiss must clear the detached secret input');
  await secretInput.dispose();
  assert.equal(await manager.page.locator('#oauthClientCredentials').isVisible(),false);
  assert.equal(await manager.page.locator('#oauthClientCredentials input').count(),0);
  assert.equal(await manager.page.locator('#oauthRegisteredClientSecret').count(),0);checks++;

  assert.deepEqual(errors,[]);
  console.log(`OAuth Chromium smoke checks: ${checks} passed; RTL desktop/mobile screenshots saved. Auth/OAuth HTTPS responses are mocked; school profile reads use the PostgreSQL test database.`);
}finally{
  for(const context of contexts)await context.close();
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await db.close();
}
