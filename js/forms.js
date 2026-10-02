(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const fieldLabels={short_text:"متن کوتاه",long_text:"متن بلند",number:"عدد",date:"تاریخ",time:"ساعت",single_choice:"انتخاب تکی",multi_choice:"انتخاب چندگانه",yes_no:"بله/خیر"};
async function render(){
  api.setPage("فرم‌ها","فرم‌ساز داخلی و پاسخ‌های مدرسه");
  const {data:forms,error}=await api.state.sb.from("forms").select("*").order("created_at",{ascending:false});if(error)throw error;
  const manager=api.state.profile.role==="manager";
  const cards=(forms||[]).map(f=>`<article class="form-card"><div class="panel-head"><div><span class="badge ${f.active?"":"warn"}">${f.active?"فعال":"غیرفعال"}</span><h3>${api.esc(f.title)}</h3></div><div class="actions">${manager?`<button class="btn btn-ghost edit-form-fields" data-id="${f.id}">فیلدها</button><button class="btn btn-ghost form-results" data-id="${f.id}">نتایج</button>`:`<button class="btn btn-primary fill-form" data-id="${f.id}">تکمیل فرم</button>`}</div></div><p class="muted">${api.esc(f.description||"")}</p><small>${f.opens_at?"شروع: "+api.faDateTime(f.opens_at):""} ${f.closes_at?" · پایان: "+api.faDateTime(f.closes_at):""}</small></article>`).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>فرم‌های مدرسه</h3><p class="muted">فرم‌های یک‌پاسخه، زمان‌بندی‌شده و هدفمند</p></div>${manager?'<button class="btn btn-primary" id="newForm">+ فرم جدید</button>':""}</div><div class="form-list">${cards||'<div class="card empty">فرمی وجود ندارد.</div>'}</div>`;
  if($("#newForm"))$("#newForm").onclick=formModal;
  document.querySelectorAll(".edit-form-fields").forEach(b=>b.onclick=()=>fieldsModal(b.dataset.id));
  document.querySelectorAll(".form-results").forEach(b=>b.onclick=()=>resultsModal(b.dataset.id));
  document.querySelectorAll(".fill-form").forEach(b=>b.onclick=()=>fillModal(b.dataset.id));
}
function formModal(){
  const st=api.state,now=new Date(),later=new Date(Date.now()+7*86400000),local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  api.modal("فرم جدید",`<div class="form-grid"><label class="wide"><span>عنوان</span><input id="fmTitle"></label><label class="wide"><span>توضیحات</span><textarea id="fmDesc"></textarea></label><label><span>مخاطب</span><select id="fmTarget"><option value="all">همه</option><option value="role">یک نقش</option><option value="grade">یک پایه</option><option value="class">یک کلاس</option></select></label><label><span>نقش</span><select id="fmRole"><option value="student">دانش‌آموز</option><option value="teacher">دبیر</option></select></label><label><span>پایه</span><select id="fmGrade">${st.grades.map(g=>`<option value="${g.id}">${api.esc(g.title)}</option>`).join("")}</select></label><label><span>کلاس</span><select id="fmClass">${st.classes.map(c=>`<option value="${c.id}">${api.esc(api.className(c.id))}</option>`).join("")}</select></label><label><span>شروع</span><input id="fmOpen" type="datetime-local" value="${local(now)}"></label><label><span>پایان</span><input id="fmClose" type="datetime-local" value="${local(later)}"></label><label><span>یک پاسخ برای هر کاربر</span><select id="fmOne"><option value="true">بله</option><option value="false">خیر</option></select></label></div>`,async()=>{
    const target=$("#fmTarget").value,p={title:$("#fmTitle").value.trim(),description:$("#fmDesc").value.trim()||null,target_type:target,target_role:null,target_grade_id:null,target_class_id:null,opens_at:new Date($("#fmOpen").value).toISOString(),closes_at:new Date($("#fmClose").value).toISOString(),active:true,one_response_per_user:$("#fmOne").value==="true",created_by:st.profile.id};
    if(!p.title)throw new Error("عنوان فرم الزامی است.");if(target==="role")p.target_role=$("#fmRole").value;if(target==="grade")p.target_grade_id=$("#fmGrade").value;if(target==="class")p.target_class_id=$("#fmClass").value;
    const {data,error}=await st.sb.from("forms").insert(p).select().single();if(error)throw error;api.toast("فرم ساخته شد؛ اکنون فیلدها را تعریف کنید.");$("#modal").close();fieldsModal(data.id);
  },"ساخت فرم");
}
async function fieldsModal(formId){
  const {data:fields,error}=await api.state.sb.from("form_fields").select("*").eq("form_id",formId).order("sort_order");if(error)return api.toast(api.errText(error),true);
  const rows=(fields||[]).map(f=>`<tr><td>${api.esc(f.label)}</td><td>${fieldLabels[f.field_type]}</td><td>${f.required?"بله":"خیر"}</td><td>${f.sort_order}</td><td><button class="btn btn-ghost danger del-form-field" data-id="${f.id}">حذف</button></td></tr>`).join("");
  api.modal("فیلدهای فرم",`<div class="form-grid"><label><span>نوع فیلد</span><select id="ffType">${Object.entries(fieldLabels).map(([v,t])=>`<option value="${v}">${t}</option>`).join("")}</select></label><label><span>عنوان فیلد</span><input id="ffLabel"></label><label><span>Placeholder</span><input id="ffPlaceholder"></label><label><span>الزامی</span><select id="ffRequired"><option value="false">خیر</option><option value="true">بله</option></select></label><label><span>ترتیب</span><input id="ffOrder" inputmode="numeric" value="${(fields||[]).length+1}"></label><label class="wide"><span>گزینه‌ها برای فیلدهای انتخابی؛ هر خط یک گزینه</span><textarea id="ffOptions"></textarea></label></div><br><div class="table-wrap"><table><thead><tr><th>عنوان</th><th>نوع</th><th>الزامی</th><th>ترتیب</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">فیلدی تعریف نشده است.</td></tr>'}</tbody></table></div>`,async()=>{
    const type=$("#ffType").value,opts=$("#ffOptions").value.split("\n").map(x=>x.trim()).filter(Boolean),payload={form_id:formId,field_type:type,label:$("#ffLabel").value.trim(),placeholder:$("#ffPlaceholder").value.trim()||null,required:$("#ffRequired").value==="true",options:["single_choice","multi_choice"].includes(type)?opts:null,sort_order:Number(api.toEnDigits($("#ffOrder").value||"0"))};
    if(!payload.label)throw new Error("عنوان فیلد الزامی است.");if(["single_choice","multi_choice"].includes(type)&&opts.length<2)throw new Error("حداقل دو گزینه تعریف کنید.");
    const {error}=await api.state.sb.from("form_fields").insert(payload);if(error)throw error;api.toast("فیلد اضافه شد.");$("#modal").close();fieldsModal(formId);
  },"افزودن فیلد");
  document.querySelectorAll(".del-form-field").forEach(b=>b.onclick=async()=>{const {error}=await api.state.sb.from("form_fields").delete().eq("id",b.dataset.id);if(error)return api.toast(api.errText(error),true);$("#modal").close();fieldsModal(formId);});
}
function control(f){
  const id=`field_${f.id}`,ph=api.esc(f.placeholder||"");
  if(f.field_type==="long_text")return `<textarea id="${id}" data-field="${f.id}" data-type="${f.field_type}" placeholder="${ph}"></textarea>`;
  if(["short_text","number","date","time"].includes(f.field_type))return `<input id="${id}" data-field="${f.id}" data-type="${f.field_type}" type="${f.field_type==="short_text"?"text":f.field_type}" placeholder="${ph}">`;
  if(f.field_type==="yes_no")return `<select id="${id}" data-field="${f.id}" data-type="${f.field_type}"><option value="">انتخاب کنید</option><option value="yes">بله</option><option value="no">خیر</option></select>`;
  const opts=Array.isArray(f.options)?f.options:[];if(f.field_type==="single_choice")return `<select id="${id}" data-field="${f.id}" data-type="${f.field_type}"><option value="">انتخاب کنید</option>${opts.map(o=>`<option value="${api.esc(o)}">${api.esc(o)}</option>`).join("")}</select>`;
  return `<div class="multi-choice" data-field="${f.id}" data-type="multi_choice">${opts.map(o=>`<label><input type="checkbox" value="${api.esc(o)}"><span>${api.esc(o)}</span></label>`).join("")}</div>`;
}
async function fillModal(formId){
  const [{data:form,error:fe},{data:fields,error:ffe}]=await Promise.all([api.state.sb.from("forms").select("*").eq("id",formId).single(),api.state.sb.from("form_fields").select("*").eq("form_id",formId).order("sort_order")]);if(fe||ffe)return api.toast(api.errText(fe||ffe),true);
  api.modal(form.title,`<p class="muted">${api.esc(form.description||"")}</p><div class="form-response-fields">${(fields||[]).map(f=>`<label><span>${api.esc(f.label)} ${f.required?"*":""}</span>${control(f)}</label>`).join("")}</div>`,async()=>{
    const answers=(fields||[]).map(f=>{let value;if(f.field_type==="multi_choice"){value=[...document.querySelectorAll(`.multi-choice[data-field="${f.id}"] input:checked`)].map(x=>x.value)}else{value=$(`#field_${f.id}`).value}return {field_id:f.id,value};});
    const {error}=await api.state.sb.rpc("submit_form",{p_form:formId,p_answers:answers});if(error){const m=error.message;throw new Error(m.includes("FORM_ALREADY_SUBMITTED")?"این فرم قبلاً ارسال شده است.":m.includes("FORM_CLOSED")?"مهلت ارسال این فرم پایان یافته است.":m.includes("REQUIRED_FIELD_MISSING")?"همه فیلدهای الزامی را تکمیل کنید.":m)}
    api.toast("فرم با موفقیت ارسال شد.");render();
  },"ارسال فرم");
}
async function resultsModal(formId){
  const [{data:subs,error:se},{data:fields,error:fe}]=await Promise.all([api.state.sb.from("form_submissions").select("*").eq("form_id",formId).order("submitted_at",{ascending:false}),api.state.sb.from("form_fields").select("*").eq("form_id",formId).order("sort_order")]);if(se||fe)return api.toast(api.errText(se||fe),true);
  const ids=(subs||[]).map(x=>x.id);let answers=[];if(ids.length){const r=await api.state.sb.from("form_answers").select("*").in("submission_id",ids);if(r.error)return api.toast(api.errText(r.error),true);answers=r.data||[]}
  const amap=new Map();answers.forEach(a=>amap.set(a.submission_id+"|"+a.field_id,a.value));
  const rows=(subs||[]).map(s=>`<tr><td>${api.esc(api.userName(s.user_id))}</td><td>${api.faDateTime(s.submitted_at)}</td>${(fields||[]).map(f=>`<td>${api.esc(Array.isArray(amap.get(s.id+"|"+f.id))?amap.get(s.id+"|"+f.id).join("، "):String(amap.get(s.id+"|"+f.id)??"-"))}</td>`).join("")}</tr>`).join("");
  api.modal("نتایج فرم",`<div class="table-wrap"><table><thead><tr><th>کاربر</th><th>زمان</th>${(fields||[]).map(f=>`<th>${api.esc(f.label)}</th>`).join("")}</tr></thead><tbody>${rows||'<tr><td colspan="2" class="empty">پاسخی ثبت نشده است.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
}
api.registerModule({nav:{manager:[["forms","فرم‌ها"]],teacher:[["forms","فرم‌ها"]],student:[["forms","فرم‌ها"]]},routes:{forms:render}});
})();