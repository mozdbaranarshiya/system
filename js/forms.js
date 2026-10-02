(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
const types={short_text:'متن کوتاه',long_text:'متن بلند',number:'عدد',date:'تاریخ',time:'ساعت',single_choice:'انتخاب تکی',multiple_choice:'انتخاب چندگانه',boolean:'بله / خیر'};
V.routes.forms=async()=>{
let page=0;
V.page('فرم‌های مدرسه','رضایت‌نامه، ثبت‌نام و درخواست‌های مدرسه',`<div class="card">${V.toolbar(V.manager()?V.button('newForm','فرم جدید'):'')}<div id="formList"></div></div>`);
async function draw(){const {data,error,count}=await s.sb.from('forms').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*50,page*50+49);if(error)throw error;
$('#formList').innerHTML=c.table(['عنوان','شروع','پایان','وضعیت','عملیات'],(data||[]).map(f=>`<tr><td>${e(f.title)}</td><td>${V.datetime(f.opens_at)}</td><td>${V.datetime(f.closes_at)}</td><td>${f.active?'فعال':'غیرفعال'}</td><td>${V.manager()?`<button class="btn btn-ghost form-toggle" data-id="${f.id}">${f.active?'غیرفعال':'فعال'}</button><button class="btn btn-ghost form-results" data-id="${f.id}">پاسخ‌ها</button><button class="btn btn-ghost form-order" data-id="${f.id}">ترتیب فیلدها</button>`:`<button class="btn btn-primary fill-form" data-id="${f.id}">تکمیل فرم</button>`}</td></tr>`))+V.pager(page,count||0);
V.bind('.form-toggle',async b=>{const f=data.find(x=>x.id===b.dataset.id);await V.query(s.sb.from('forms').update({active:!f.active}).eq('id',f.id));await draw();});
V.bind('.fill-form',b=>fillForm(data.find(x=>x.id===b.dataset.id)));V.bind('.form-results',async b=>{V.formResultId=b.dataset.id;await c.navigate('form-results');});
V.bind('.form-order',async b=>{const fields=await V.query(s.sb.from('form_fields').select('*').eq('form_id',b.dataset.id).order('sort_order'));
c.modal('ترتیب فیلدهای فرم','<div id="fieldOrder"></div>',async()=>{await V.rpc('reorder_form_fields',{p_form:b.dataset.id,p_fields:fields.map(x=>x.id)});c.toast('ترتیب فیلدها ذخیره شد.');});
const render=()=>{$('#fieldOrder').innerHTML=fields.map((f,i)=>`<div class="v7-order-row"><span>${e(f.label)}</span><button type="button" class="btn btn-ghost order-up" data-index="${i}" ${i===0?'disabled':''}>بالا</button><button type="button" class="btn btn-ghost order-down" data-index="${i}" ${i===fields.length-1?'disabled':''}>پایین</button></div>`).join('');
V.bind('.order-up,.order-down',b=>{const i=Number(b.dataset.index),j=i+(b.classList.contains('order-up')?-1:1);[fields[i],fields[j]]=[fields[j],fields[i]];render();});};render();});
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#newForm',newForm);await draw();};
function newForm(){
c.modal('ساخت فرم',`<div class="form-grid">${V.field('fTitle','عنوان فرم')}<label><span>توضیح</span><textarea id="fDescription"></textarea></label>${V.audience()}${V.dateField('fOpen','شروع',new Date(),true)}${V.dateField('fClose','پایان',new Date(Date.now()+7*86400000),true)}<label><span>فعال</span><input id="fActive" type="checkbox" checked></label><label><span>اجازه چند پاسخ برای هر کاربر</span><input id="fMultiple" type="checkbox"></label><div class="wide" id="fieldBuilder"></div><button type="button" class="btn btn-ghost wide" id="addFormField">افزودن فیلد</button></div>`,async()=>{
const fields=[...document.querySelectorAll('.v7-builder-field')].map(row=>({field_type:row.querySelector('.field-type').value,label:row.querySelector('.field-label').value.trim(),placeholder:row.querySelector('.field-placeholder').value.trim(),required:row.querySelector('.field-required').checked,options:row.querySelector('.field-options').value.split('\n').map(x=>x.trim()).filter(Boolean)}));
if(!fields.length)throw new Error('حداقل یک فیلد تعریف کنید.');
await V.rpc('create_school_form',{p_form:{title:$('#fTitle').value.trim(),description:$('#fDescription').value.trim(),...V.audienceValue(),opens_at:V.stamp('fOpen'),closes_at:V.stamp('fClose'),active:$('#fActive').checked,allow_multiple:$('#fMultiple').checked},p_fields:fields});c.toast('فرم ساخته شد.');await c.navigate('forms');});
const add=()=>{const row=document.createElement('div');row.className='v7-builder-field';row.innerHTML=`<div class="form-grid"><label><span>عنوان فیلد</span><input class="field-label" required></label><label><span>نوع فیلد</span><select class="field-type">${Object.entries(types).map(([id,title])=>`<option value="${id}">${title}</option>`).join('')}</select></label><label><span>متن راهنما</span><input class="field-placeholder"></label><label><span>الزامی</span><input class="field-required" type="checkbox"></label><label class="wide field-options-label"><span>گزینه‌ها (هر گزینه در یک خط)</span><textarea class="field-options"></textarea></label></div><div class="actions"><button type="button" class="btn btn-ghost field-up">بالا</button><button type="button" class="btn btn-ghost field-down">پایین</button><button type="button" class="btn btn-ghost field-remove">حذف فیلد</button></div>`;
$('#fieldBuilder').append(row);const update=()=>row.querySelector('.field-options-label').classList.toggle('hidden',!['single_choice','multiple_choice'].includes(row.querySelector('.field-type').value));row.querySelector('.field-type').onchange=update;update();
row.querySelector('.field-remove').onclick=()=>row.remove();row.querySelector('.field-up').onclick=()=>{if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling);};row.querySelector('.field-down').onclick=()=>{if(row.nextElementSibling)row.parentElement.insertBefore(row.nextElementSibling,row);};};$('#addFormField').onclick=add;add();}
async function fillForm(form){
const fields=await V.query(s.sb.from('form_fields').select('*').eq('form_id',form.id).order('sort_order'));
const fieldHtml=f=>{const id='ff'+f.id,required=f.required?'required':'',options=f.options||[];let input;
if(f.field_type==='long_text')input=`<textarea id="${id}" ${required} maxlength="16000"></textarea>`;
else if(f.field_type==='single_choice')input=`<select id="${id}" ${required}><option value="">انتخاب کنید</option>${options.map(x=>`<option value="${e(x)}">${e(x)}</option>`).join('')}</select>`;
else if(f.field_type==='multiple_choice')input=options.map(x=>`<label class="v7-choice"><input class="${id}" type="checkbox" value="${e(x)}"><span>${e(x)}</span></label>`).join('');
else if(f.field_type==='boolean')input=`<select id="${id}" ${required}><option value="">انتخاب کنید</option><option value="true">بله</option><option value="false">خیر</option></select>`;
else input=`<input id="${id}" type="${f.field_type==='number'?'number':'text'}" step="any" ${required} placeholder="${e(f.field_type==='date'?'۱۴۰۵/۰۷/۱۰ (شمسی)':f.field_type==='time'?'۰۸:۳۰':f.placeholder||'')}">`;
return `<div class="v7-form-field"><label for="${id}">${e(f.label)}${f.required?' *':''}</label>${input}</div>`;};
c.modal(form.title,`<p>${e(form.description||'')}</p><div class="form-grid">${fields.map(fieldHtml).join('')}</div>`,async()=>{
const answers={};for(const f of fields){const id='ff'+f.id;let value;
if(f.field_type==='multiple_choice')value=[...document.querySelectorAll('.'+id+':checked')].map(x=>x.value);
else {const raw=$('#'+id).value;if(!raw){value=null;}else value=f.field_type==='number'?Number(c.toEnDigits(raw)):f.field_type==='boolean'?raw==='true':f.field_type==='date'?V.gregorian(raw):f.field_type==='time'?c.toEnDigits(raw):raw;}
answers[f.id]=value;}
await V.rpc('submit_school_form',{p_form:form.id,p_answers:answers});c.toast('فرم ارسال شد.');},'ارسال فرم');}
V.routes['form-results']=async()=>{
if(!V.manager()||!V.formResultId)throw new Error('ACCESS_DENIED');let page=0;let exportRows=[];
const [form,fields]=await Promise.all([V.query(s.sb.from('forms').select('*').eq('id',V.formResultId).single()),V.query(s.sb.from('form_fields').select('*').eq('form_id',V.formResultId).order('sort_order'))]);
V.page('پاسخ‌های فرم',form.title,`<div class="card">${V.toolbar(V.button('exportForm','خروجی Excel')+V.button('backForms','فرم‌ها','btn-ghost'))}<div id="formResponses"></div></div>`);
async function rows(offset,size){const {data,error,count}=await s.sb.from('form_submissions').select('*',{count:'exact'}).eq('form_id',form.id).order('submitted_at').range(offset,offset+size-1);if(error)throw error;
const answers=data.length?await V.query(s.sb.from('form_answers').select('*').in('submission_id',data.map(x=>x.id))):[];
return {count,values:data.map(r=>[c.userName(r.user_id),V.datetime(r.submitted_at),...fields.map(f=>{const v=answers.find(a=>a.submission_id===r.id&&a.field_id===f.id)?.value;return typeof v==='boolean'?v?'بله':'خیر':Array.isArray(v)?v.join('، '):f.field_type==='date'&&v?V.date(v+'T12:00:00Z'):v??'—';})])};}
const headers=['کاربر','تاریخ ارسال',...fields.map(f=>f.label)];
async function draw(){const r=await rows(page*50,50);exportRows=r.values;$('#formResponses').innerHTML=c.table(headers,r.values.map(row=>'<tr>'+row.map(x=>`<td>${e(x)}</td>`).join('')+'</tr>'))+V.pager(page,r.count||0);
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(r.count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#exportForm',async()=>{let all=[],offset=0,r;do{r=await rows(offset,200);all.push(...r.values);offset+=200;}while(offset<(r.count||0));await V.exportRows(headers,all,form.title);});V.bind('#backForms',()=>c.navigate('forms'));await draw();};
})();
