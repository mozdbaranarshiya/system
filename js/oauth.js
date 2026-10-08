(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e,cfg}=c;
const labels={
  'profile.read':'مشاهده نام و شناسه حساب شما',
  'classes.read':'مشاهده کلاس‌های مجاز شما',
  'grades.read':'مشاهده نمره‌هایی که در سامانه اجازه دیدنشان را دارید',
  'assignments.read':'مشاهده تکالیف مجاز شما'
};
const parameters=['client_id','redirect_uri','response_type','scope','state','code_challenge','code_challenge_method'];
let pending=null,requestInvalid=false,consentBusy=false;
const query=new URLSearchParams(window.location.search);
if(query.has('oauth')){
  pending={};
  for(const key of parameters){
    if(query.getAll(key).length>1)requestInvalid=true;
    if(query.has(key))pending[key]=query.get(key);
  }
  requestInvalid=requestInvalid||query.getAll('oauth').length!==1||query.get('oauth')!=='1'||
    ['client_id','redirect_uri','response_type','scope','state'].some(key=>!pending[key])||
    pending.response_type!=='code'||
    Boolean(pending.code_challenge)!==Boolean(pending.code_challenge_method)||
    (pending.code_challenge_method&&pending.code_challenge_method!=='S256');
  // Keep the authorization request only in this tab's memory, never a token in a URL.
  const clean=new URL(window.location.href);
  clean.searchParams.delete('oauth');
  for(const key of parameters)clean.searchParams.delete(key);
  window.history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
}
async function call(path,body,expectedUser=s.profile?.id){
  const {data:{session},error}=await s.sb.auth.getSession();
  if(error||!session?.access_token||(expectedUser&&session.user?.id!==expectedUser))throw new Error('invalid_session');
  s.session=session;
  const response=await fetch(`${cfg.SUPABASE_URL.replace(/\/$/,'')}/functions/v1/oauth-connector${path}`,{
    method:body===undefined?'GET':'POST',
    headers:{Authorization:`Bearer ${session.access_token}`,apikey:cfg.SUPABASE_ANON_KEY,...(body===undefined?{}:{'Content-Type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'
  });
  let data;
  try{data=await response.json();}catch(_){throw new Error('server_error');}
  if(!response.ok||data?.error)throw new Error(data?.error||'server_error');
  if(expectedUser){
    const current=await s.sb.auth.getSession();
    if(current.error||current.data?.session?.user?.id!==expectedUser)throw new Error('invalid_session');
    s.session=current.data.session;
  }
  return data;
}
function message(error){
  const code=error?.message;
  if(['invalid_session','invalid_token','login_required'].includes(code))return 'نشست شما معتبر نیست. از حساب خارج شوید و دوباره وارد شوید.';
  if(['mfa_required','mfa_expired'].includes(code))return 'تأیید دومرحله‌ای تازه مدیر لازم است. اتصال را دوباره از ChatGPT آغاز کنید.';
  if(['expired_request','invalid_request','invalid_grant','invalid_client','invalid_scope','invalid_redirect_uri','unsupported_response_type','csrf_failed'].includes(code))return 'درخواست اتصال نامعتبر یا منقضی شده است. اتصال را دوباره از ChatGPT آغاز کنید.';
  return 'ارتباط با سرویس اتصال انجام نشد. دوباره تلاش کنید.';
}
function showFailure(error){
  c.showOnlyView('#oauthView');
  $('#oauthContent').innerHTML=`<h1>اتصال حساب</h1><p class="alert alert-warning">${e(message(error))}</p><p class="hint">وضعیت دسترسی‌ها را می‌توانید در «برنامه‌های متصل» بررسی کنید.</p>${V.button('oauthReturn','بازگشت به سامانه','btn-ghost')}`;
  V.bind('#oauthReturn',async()=>{pending=null;await c.enterApp();});
}
async function prepare(){
  try{return await call('/oauth/prepare',pending);}
  catch(error){
    if(!['mfa_required','mfa_expired'].includes(error.message)||s.profile?.role!=='manager')throw error;
    const verified=await c.ensureManagerMfa(true);
    if(!verified)return null;
    return call('/oauth/prepare',pending);
  }
}
function validTransaction(data){
  return data&&typeof data.request_id==='string'&&typeof data.csrf_token==='string'&&
    typeof data.name==='string'&&Array.isArray(data.scopes)&&data.scopes.length>0&&
    data.scopes.every(scope=>Object.hasOwn(labels,scope))&&Number.isFinite(Date.parse(data.expires_at));
}
async function decision(transaction,approve){
  if(consentBusy)return;
  consentBusy=true;
  const buttons=[...document.querySelectorAll('#oauthContent button')];buttons.forEach(button=>button.disabled=true);
  try{
    if(Date.parse(transaction.expires_at)<=Date.now())throw new Error('expired_request');
    const result=await call('/oauth/decision',{request_id:transaction.request_id,csrf_token:transaction.csrf_token,approve});
    // The server chooses a previously registered, exact-match callback. Request parameters never choose navigation here.
    const destination=new URL(result.redirect_url);
    const loopback=hostname=>['localhost','127.0.0.1'].includes(hostname);
    const localCallback=window.location.protocol==='http:'&&loopback(window.location.hostname)&&destination.protocol==='http:'&&loopback(destination.hostname);
    if((destination.protocol!=='https:'&&!localCallback)||destination.username||destination.password||destination.hash)throw new Error('server_error');
    pending=null;
    window.location.assign(destination.href);
  }catch(error){showFailure(error);}
  finally{consentBusy=false;buttons.forEach(button=>{if(button.isConnected)button.disabled=false;});}
}
V.resumeOAuth=async()=>{
  if(!pending)return false;
  c.showOnlyView('#oauthView');
  $('#oauthContent').innerHTML='<p>در حال بررسی درخواست اتصال…</p>';
  if(requestInvalid){showFailure(new Error('invalid_request'));return true;}
  try{
    const transaction=await prepare();
    if(!transaction)return true;
    if(!validTransaction(transaction))throw new Error('server_error');
    if(Date.parse(transaction.expires_at)<=Date.now())throw new Error('expired_request');
    c.showOnlyView('#oauthView');
    $('#oauthContent').innerHTML=`<h1>اجازه اتصال حساب</h1><p><strong>${e(transaction.name)}</strong> می‌خواهد به حساب شما متصل شود.</p>
      <div class="oauth-account"><p>حساب: <strong>${e(s.profile.full_name)}</strong></p><p>نقش: ${e(c.faRole[s.profile.role]||s.profile.role)}</p></div>
      <p>دسترسی‌های درخواستی:</p><ul class="oauth-scope-list">${transaction.scopes.map(scope=>`<li>${e(labels[scope])}</li>`).join('')}</ul>
      <p class="hint">فقط اطلاعاتی در دسترس این برنامه قرار می‌گیرد که خودتان در سامانه مجاز به مشاهده آن هستید. رمز عبور و کد دومرحله‌ای به برنامه داده نمی‌شوند. دسترسی را می‌توانید از «برنامه‌های متصل» قطع کنید.</p>
      <div class="oauth-actions">${V.button('oauthDeny','لغو','btn-ghost')}${V.button('oauthApprove','اجازه می‌دهم')}</div>`;
    V.bind('#oauthApprove',()=>decision(transaction,true));
    V.bind('#oauthDeny',()=>decision(transaction,false));
  }catch(error){showFailure(error);}
  return true;
};
const originalMenu=V.menu;
V.menu=()=>[...originalMenu(),['connected-apps','برنامه‌های متصل']];
function managerClientCard(){
  if(s.profile?.role!=='manager')return '';
  return `<section class="card v7-narrow" id="oauthClientCard"><h2>ثبت برنامه برای اتصال ChatGPT</h2>
    <p class="hint">آدرس Callback نمایش‌داده‌شده در تنظیمات OAuth برنامه را دقیقاً وارد کنید. ثبت برنامه به تأیید دومرحله‌ای تازه مدیر نیاز دارد.</p>
    <form id="oauthClientForm" autocomplete="off"><div class="form-grid">
      ${V.field('oauthClientName','نام برنامه','text','ChatGPT')}
      <label><span>Callback URL</span><input id="oauthClientCallback" type="url" required maxlength="2048" dir="ltr" data-machine-text autocomplete="off" spellcheck="false" placeholder="https://…"></label>
    </div><fieldset><legend>دسترسی‌های مجاز برنامه</legend>${Object.entries(labels).map(([scope,label])=>`<label class="v7-choice"><input type="checkbox" class="oauth-client-scope" value="${e(scope)}" ${scope==='profile.read'?'checked':''}><span>${e(label)}</span></label>`).join('')}</fieldset>
    <label class="v7-choice"><input id="oauthClientPkce" type="checkbox" checked><span>PKCE با S256 اجباری باشد</span></label>
    <p class="hint">این گزینه را فقط برای برنامه‌ای با Client Secret، مانند GPT Actions، که PKCE ارسال نمی‌کند غیرفعال کنید.</p>
    ${V.toolbar(V.button('oauthClientRegister','ثبت برنامه'))}<p id="oauthClientMessage" role="status" aria-live="polite"></p></form>
    <div id="oauthClientCredentials" hidden></div></section>`;
}
function bindManagerRegistration(){
  const form=$('#oauthClientForm');
  if(!form)return;
  const result=$('#oauthClientCredentials'),status=$('#oauthClientMessage'),button=$('#oauthClientRegister');
  let busy=false;
  const clearCredentials=()=>{
    result.querySelectorAll('input').forEach(input=>input.value='');
    result.replaceChildren();result.hidden=true;
  };
  const account=s.profile.id;
  const subscription=s.sb.auth.onAuthStateChange((_event,session)=>{
    if(session?.user?.id!==account)clearCredentials();
  });
  V.cleanupTasks.push(()=>{clearCredentials();subscription?.data?.subscription?.unsubscribe();});
  async function register(event){
    event?.preventDefault();
    if(busy||s.profile?.role!=='manager'||!form.reportValidity())return;
    const name=$('#oauthClientName').value.trim(),redirect=$('#oauthClientCallback').value.trim();
    const scopes=[...form.querySelectorAll('.oauth-client-scope:checked')].map(input=>input.value);
    let callback;
    try{callback=new URL(redirect);}catch(_){status.textContent='آدرس Callback معتبر نیست.';return;}
    const loopback=hostname=>['localhost','127.0.0.1'].includes(hostname);
    const localCallback=window.location.protocol==='http:'&&loopback(window.location.hostname)&&callback.protocol==='http:'&&loopback(callback.hostname);
    if((callback.protocol!=='https:'&&!localCallback)||callback.username||callback.password||callback.hash){status.textContent='آدرس Callback باید HTTPS و بدون نام کاربری، رمز یا بخش # باشد.';return;}
    if(!name||name.length>100||!scopes.length||scopes.some(scope=>!Object.hasOwn(labels,scope))){status.textContent='نام برنامه و حداقل یک دسترسی مجاز را انتخاب کنید.';return;}
    const owner=s.profile.id,pkce=$('#oauthClientPkce').checked;
    busy=true;button.disabled=true;status.textContent='تأیید دومرحله‌ای مدیر لازم است.';clearCredentials();
    try{
      const current=await s.sb.auth.getSession();
      if(current.error||current.data?.session?.user?.id!==owner)throw new Error('invalid_session');
      if(!form.isConnected||s.profile?.id!==owner||s.profile?.role!=='manager')return;
      const verified=await c.ensureManagerMfa(true);
      // Cancellation signs out through the existing MFA screen. Never restore the authenticated view here.
      if(!verified||!form.isConnected||s.profile?.id!==owner||s.profile?.role!=='manager')return;
      status.textContent='در حال ثبت برنامه…';
      const data=await call('/account/admin/clients',{name,redirect_uris:[redirect],allowed_scopes:scopes,public_client:false,pkce_required:pkce},owner);
      if(!form.isConnected||s.profile?.id!==owner||s.profile?.role!=='manager')return;
      if(s.session?.user?.id!==owner)throw new Error('invalid_session');
      if(data?.ok!==true||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.client_id)||!/^scs_[A-Za-z0-9_-]{43}$/.test(data.client_secret))throw new Error('server_error');
      const endpoint=cfg.SUPABASE_URL.replace(/\/$/,'')+'/functions/v1/oauth-connector';
      const fields=[
        ['oauthRegisteredClientId','Client ID',data.client_id,'oauthCopyClientId'],
        ['oauthRegisteredClientSecret','Client Secret',data.client_secret,'oauthCopyClientSecret'],
        ['oauthRegisteredAuthorizeUrl','Authorization URL',endpoint+'/oauth/authorize','oauthCopyAuthorizeUrl'],
        ['oauthRegisteredTokenUrl','Token URL',endpoint+'/oauth/token','oauthCopyTokenUrl'],
        ['oauthRegisteredScopes','Scope',scopes.join(' '),'oauthCopyScopes']
      ];
      result.innerHTML=`<h3>برنامه ثبت شد</h3><p class="alert alert-warning">Client Secret فقط همین بار نمایش داده می‌شود. آن را در تنظیمات OAuth برنامه وارد کنید و محرمانه نگه دارید.</p>
        <p class="hint">در بخش Authentication برنامه در GPT Builder، OAuth را انتخاب و اطلاعات زیر را وارد کنید.</p>
        <div class="form-grid">${fields.map(([id,title])=>`<label><span>${e(title)}</span><input id="${id}" readonly dir="ltr" data-machine-text autocomplete="off" spellcheck="false"></label>`).join('')}</div>
        ${V.toolbar(fields.map(([,title,,id])=>V.button(id,'کپی '+title,'btn-ghost')).join('')+V.button('oauthDismissCredentials','بستن اطلاعات محرمانه','btn-ghost'))}`;
      for(const [id,,value] of fields)$('#'+id).value=value;
      result.hidden=false;status.textContent='برنامه ثبت شد؛ اطلاعات را پیش از بستن کپی کنید.';
      for(const [input,,,selector] of fields){
        V.bind('#'+selector,async()=>{
          try{await navigator.clipboard.writeText($('#'+input).value);c.toast('کپی شد.');}
          catch(_){c.toast('کپی خودکار ممکن نبود؛ مقدار را دستی انتخاب کنید.',true);}
        });
      }
      V.bind('#oauthDismissCredentials',()=>{clearCredentials();status.textContent='اطلاعات محرمانه بسته شد و دوباره قابل نمایش نیست.';});
    }catch(error){if(form.isConnected)status.textContent=message(error);}
    finally{busy=false;if(button.isConnected)button.disabled=false;}
  }
  form.onsubmit=register;
  button.onclick=register;
}
V.routes['connected-apps']=async()=>{
  V.page('برنامه‌های متصل','مشاهده و قطع دسترسی برنامه‌ها به حساب شما','<div class="card v7-narrow" id="connectedApps">در حال دریافت اطلاعات…</div>'+managerClientCard());
  bindManagerRegistration();
  async function draw(){
    const result=await call('/account/connections');
    if(!Array.isArray(result.connections))throw new Error('server_error');
    $('#connectedApps').innerHTML=result.connections.length?result.connections.map(connection=>`<article class="oauth-connection">
      <h3>${e(connection.name)}</h3><p>تاریخ اتصال: ${e(V.datetime(connection.created_at))}</p><p>آخرین استفاده: ${e(V.datetime(connection.last_used_at))}</p>
      <p>دسترسی‌ها:</p><ul class="oauth-scope-list">${(connection.scopes||[]).map(scope=>`<li>${e(labels[scope]||scope)}</li>`).join('')}</ul>
      <button type="button" class="btn btn-ghost oauth-disconnect" data-grant-id="${e(connection.id)}">قطع اتصال</button></article>`).join(''):'<p class="empty">هیچ برنامه‌ای به حساب شما متصل نیست.</p>';
    V.bind('.oauth-disconnect',async button=>{
      if(!window.confirm('اتصال این برنامه قطع شود؟ تمام دسترسی‌ها و امکان تمدید آن‌ها لغو می‌شوند.'))return;
      await call('/account/disconnect',{grant_id:button.dataset.grantId});
      c.toast('اتصال برنامه قطع شد.');await draw();
    });
  }
  try{await draw();}catch(error){$('#connectedApps').innerHTML=`<p class="alert alert-warning">${e(message(error))}</p>`;}
};
})();
