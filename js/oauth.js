(() => {
'use strict';
// Supabase Auth is the OAuth authorization server; this file only renders
// the existing site's consent and connected-apps interfaces.
const c=window.SystemCore,V=window.SchoolV7,s=c.state;
const $=c.$;
const params=new URLSearchParams(window.location.search);
const authorizationId=params.get('authorization_id');
const configuredClient=()=>String(window.APP_CONFIG?.CHATGPT_OAUTH_CLIENT_ID||'');
const isConfigured=()=>configuredClient()&&!configuredClient().startsWith('SET_')
  &&window.APP_CONFIG?.CHATGPT_OAUTH_PRIVACY_SAFE===true;

function safeRedirect(target,expected){
  const url=new URL(target);
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))
    throw new Error('INVALID_REDIRECT');
  if(expected){
    const registered=new URL(expected);
    if(url.origin!==registered.origin||url.pathname!==registered.pathname)
      throw new Error('INVALID_REDIRECT');
  }
  window.location.assign(url.href);
}
function notice(message){
  $('#oauthError').textContent=message;
  $('#oauthError').classList.remove('hidden');
}
function isOAuthRequest(){
  return Boolean(authorizationId);
}
async function showConsent(){
  if(!isOAuthRequest())return false;
  c.showOnlyView('#oauthConsentView');
  $('#oauthError').classList.add('hidden');
  $('#oauthApprove').disabled=true;
  $('#oauthDeny').disabled=true;
  if(!isConfigured()){notice('اتصال ChatGPT تا بازبینی و ایمن‌سازی شناسه‌های هویتی JWT غیرفعال است.');return true;}
  if(!s.profile?.active||s.profile.must_change_password){
    notice('حساب آماده اتصال نیست.');return true;
  }
  try{
    const {data,error}=await s.sb.auth.oauth.getAuthorizationDetails(authorizationId);
    if(error||!data)throw new Error('INVALID_AUTHORIZATION');
    if(!('authorization_id' in data)){
      // Supabase may auto-approve an old grant. Do NOT bypass this site's
      // local revocation or its strict (non-email) scope policy.
      const [{data:nativeGrants,error:grantError},{data:localGrant,error:localError}]=await Promise.all([
        s.sb.auth.oauth.getUserGrants(),
        s.sb.from('oauth_connected_apps').select('scopes,revoked_at')
          .eq('user_id',s.profile.id).eq('client_id',configuredClient()).maybeSingle()
      ]);
      const matching=(nativeGrants||[]).find(g=>g.client_id===configuredClient());
      if(grantError||localError||!localGrant||localGrant.revoked_at
         ||!matching||!Array.isArray(matching.scopes)
         ||matching.scopes.length!==1||matching.scopes[0]!=='profile')
        throw new Error('INVALID_GRANT');
      safeRedirect(data.redirect_url);
      return true;
    }
    if(data.client?.id!==configuredClient())throw new Error('UNKNOWN_CLIENT');
    // This school uses national-ID-derived emails: prohibit email / openid scopes.
    const requestedScopes=String(data.scope||'').trim().split(/\s+/);
    if(requestedScopes.length!==1||requestedScopes[0]!=='profile')
      throw new Error('UNSUPPORTED_SCOPE');
    $('#oauthClientName').textContent=String(data.client.name||'ChatGPT');
    $('#oauthAccountName').textContent=s.profile.full_name;
    $('#oauthAccountRole').textContent=({manager:'مدیر',teacher:'دبیر',student:'دانش‌آموز'})[s.profile.role]||s.profile.role;
    $('#oauthRedirectUri').textContent=String(data.redirect_uri||'');
    $('#oauthNativeScopes').textContent=String(data.scope||'email');
    $('#oauthApprove').disabled=false;
    $('#oauthDeny').disabled=false;
    const decide=async approve=>{
      const approveButton=$('#oauthApprove'),denyButton=$('#oauthDeny');
      approveButton.disabled=true;denyButton.disabled=true;
      try{
        if(approve){
          // Register exactly the user's grant and the narrow app capabilities.
          // RLS requires an active, ready account (including manager AAL2).
          const {error:grantError}=await s.sb.from('oauth_connected_apps').upsert({
            user_id:s.profile.id,client_id:configuredClient(),
            scopes:['profile.read','classes.read'],
            authorized_at:new Date().toISOString(),revoked_at:null
          },{onConflict:'user_id,client_id'});
          if(grantError)throw grantError;
        }
        const result=approve
          ?await s.sb.auth.oauth.approveAuthorization(authorizationId)
          :await s.sb.auth.oauth.denyAuthorization(authorizationId);
        if(result.error||!result.data?.redirect_url)throw result.error||new Error('OAUTH_ERROR');
        safeRedirect(result.data.redirect_url,data.redirect_uri);
      }catch{
        if(approve){
          // Do not leave the API active when provider-side consent fails.
          await s.sb.from('oauth_connected_apps')
            .update({revoked_at:new Date().toISOString()})
            .eq('user_id',s.profile.id).eq('client_id',configuredClient());
        }
        notice('ثبت اتصال انجام نشد. لطفاً دوباره تلاش کنید.');
        approveButton.disabled=false;denyButton.disabled=false;
      }
    };
    $('#oauthApprove').onclick=()=>decide(true);
    $('#oauthDeny').onclick=()=>decide(false);
  }catch{
    notice('درخواست اتصال معتبر نیست یا اجازه اتصال به این برنامه داده نشده است.');
  }
  return true;
}

async function renderConnectedApps(){
  const host=$('#oauthConnectedApps');
  if(!host)return;
  host.replaceChildren();
  if(!isConfigured()){
    host.textContent='اتصال ChatGPT هنوز در این سامانه پیکربندی نشده است.';
    return;
  }
  const {data,error}=await s.sb.from('oauth_connected_apps')
    .select('client_id,scopes,authorized_at,revoked_at')
    .eq('user_id',s.profile.id).eq('client_id',configuredClient()).maybeSingle();
  if(error){host.textContent='فهرست اتصال‌ها در دسترس نیست.';return;}
  if(!data||data.revoked_at){host.textContent='در حال حاضر ChatGPT به حساب شما متصل نیست.';return;}
  const title=document.createElement('strong');title.textContent='ChatGPT';
  const detail=document.createElement('p');detail.className='muted';
  detail.textContent='اتصال: '+V.datetime(data.authorized_at)+' · دسترسی‌ها: '+(data.scopes||[]).join('، ');
  const button=document.createElement('button');button.type='button';button.className='btn btn-ghost danger';
  button.textContent='قطع اتصال ChatGPT';
  button.onclick=async()=>{
    if(!window.confirm('دسترسی ChatGPT به حساب شما قطع شود؟'))return;
    button.disabled=true;
    try{
      // Local DB revocation is checked for EVERY API call (including a cached JWT).
      const {error:dbError}=await s.sb.from('oauth_connected_apps')
        .update({revoked_at:new Date().toISOString()})
        .eq('user_id',s.profile.id).eq('client_id',configuredClient());
      if(dbError)throw dbError;
      const {error:authError}=await s.sb.auth.oauth.revokeGrant(configuredClient());
      if(authError)throw authError;
      c.toast('اتصال ChatGPT قطع شد.');
    }catch{
      c.toast('دسترسی API قطع شده است؛ در صورت خطا، لغو اتصال در Supabase را بررسی کنید.',true);
    }finally{await renderConnectedApps();}
  };
  host.append(title,detail,button);
}
window.SchoolOAuth={isOAuthRequest,showConsent,renderConnectedApps,safeRedirect};
})();
