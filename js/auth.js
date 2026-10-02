(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$}=c;
const fields=()=>`${V.field('currentPassword','رمز فعلی','password')}${V.field('newPassword','رمز جدید (حداقل ۸ کاراکتر)','password')}${V.field('confirmPassword','تکرار رمز جدید','password')}`;
async function changePassword(){
const password=$('#newPassword').value;
if(password!==$('#confirmPassword').value)throw new Error('تکرار رمز جدید یکسان نیست.');
if(password.length<8)throw new Error('WEAK_PASSWORD');
await c.invokeFunction('account-security',{current_password:$('#currentPassword').value,new_password:password});
s.profile.must_change_password=false;c.toast('رمز عبور تغییر کرد.');}
V.requirePassword=()=>{
if(!s.profile?.must_change_password)return false;
c.showOnlyView('#passwordView');$('#passwordFields').innerHTML=fields();
$('#passwordForm').onsubmit=async event=>{
event.preventDefault();const b=$('#passwordSubmit');if(b.disabled)return;b.disabled=true;
try{await changePassword();await c.enterApp();}catch(error){c.toast(c.errText(error),true);}finally{b.disabled=false;}};
$('#passwordLogout').onclick=c.logout;return true;};
V.routes.security=async()=>{
V.page('امنیت حساب','تغییر رمز و مدیریت نشست‌ها',`<div class="card v7-narrow"><form id="securityForm"><div class="form-grid">${fields()}</div>${V.toolbar(V.button('changePassword','تغییر رمز'))}</form>${V.button('signOutEverywhere','خروج از همه دستگاه‌ها','btn-ghost')}<p class="hint">رمز جدید باید متفاوت از کد ملی و رمز فعلی باشد.</p></div>`);
$('#securityForm').onsubmit=event=>event.preventDefault();
V.bind('#changePassword',async()=>{if(!$('#securityForm').reportValidity())return;await changePassword();$('#securityForm').reset();});
V.bind('#signOutEverywhere',async()=>{const {error}=await s.sb.auth.signOut({scope:'global'});if(error)throw error;c.toast('از همه دستگاه‌ها خارج شدید.');});};
})();
