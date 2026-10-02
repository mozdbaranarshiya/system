(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.routes.settings=async()=>{
if(!V.manager())throw new Error('ACCESS_DENIED');await c.renderSettings();const settings=await V.query(s.sb.from('school_settings').select('*').eq('id',true).single());
$('#content').insertAdjacentHTML('beforeend',`<div class="card"><h3>تنظیمات آموزشی</h3><form id="schoolSettings"><div class="form-grid">${V.field('settingSchoolName','نام مدرسه','text',settings.school_name==='سامانه مدرسه'?c.cfg.SCHOOL_NAME:settings.school_name)}${V.field('settingPass','حد نصاب قبولی','number',settings.passing_score)}${V.field('settingAbsence','آستانه غیبت زیاد','number',settings.absence_alert_threshold)}</div>${V.toolbar(V.button('saveSchoolSettings','ذخیره تنظیمات'))}</form></div>`);
$('#schoolSettings').onsubmit=event=>event.preventDefault();V.bind('#saveSchoolSettings',async()=>{if(!$('#schoolSettings').reportValidity())return;await V.query(s.sb.from('school_settings').update({school_name:$('#settingSchoolName').value.trim(),passing_score:V.number('settingPass'),absence_alert_threshold:V.number('settingAbsence'),updated_by:s.profile.id,updated_at:new Date().toISOString()}).eq('id',true));c.toast('تنظیمات ذخیره شد.');});};
V.routes.audit=async()=>{
if(!V.manager())throw new Error('ACCESS_DENIED');let page=0;
V.page('گزارش تغییرات','تاریخچه تغییرات ثبت‌شده توسط سرور',`<div class="card">${V.field('auditTable','نام جدول برای فیلتر','text','',false)}${V.toolbar(V.button('loadAudit','نمایش'))}<div id="auditRows"></div></div>`);
async function draw(){let q=s.sb.from('audit_logs').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*50,page*50+49);if(V.value('auditTable'))q=q.eq('table_name',V.value('auditTable'));const {data,error,count}=await q;if(error)throw error;
$('#auditRows').innerHTML=c.table(['تاریخ','کاربر','عملیات','جدول','جزئیات'],data.map(r=>`<tr><td>${V.datetime(r.created_at)}</td><td>${e(r.user_id?c.userName(r.user_id):'عملیات سرور')}</td><td>${e({INSERT:'ایجاد',UPDATE:'ویرایش',DELETE:'حذف'}[r.action]||r.action)}</td><td>${e(r.table_name)}</td><td><details><summary>قبل و بعد</summary><pre dir="ltr">${e(JSON.stringify({before:r.old_data,after:r.new_data},null,2))}</pre></details></td></tr>`))+V.pager(page,count||0);
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#loadAudit',async()=>{page=0;await draw();});await draw();};
})();
