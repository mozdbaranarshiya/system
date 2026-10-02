(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const catLabel={remedial:"تقویتی",sports:"ورزشی",art:"هنری",cultural:"فرهنگی",language:"زبان",olympiad:"المپیاد",laboratory:"آزمایشگاه",other:"سایر"};
async function render(){
  api.setPage("کلاس‌های فوق‌برنامه","ثبت‌نام و مدیریت فعالیت‌های تکمیلی");
  const st=api.state;
  const [{data:classes,error:ce},{data:enroll,error:ee}]=await Promise.all([
    st.sb.from("extracurricular_classes").select("*").order("registration_start",{ascending:false}),
    st.sb.from("extracurricular_enrollments").select("*").order("registered_at",{ascending:false})
  ]);
  if(ce)throw ce;if(ee)throw ee;
  const manager=st.profile.role==="manager",teacher=st.profile.role==="teacher";
  const cards=(classes||[]).map(c=>{
    const mine=(enroll||[]).find(e=>e.class_id===c.id&&e.student_id===st.profile.id);
    const count=(enroll||[]).filter(e=>e.class_id===c.id&&["pending","approved"].includes(e.status)).length;
    const staff=manager||(teacher&&c.teacher_id===st.profile.id);
    return `<article class="extra-card"><div class="panel-head"><div><span class="badge">${catLabel[c.category]||c.category}</span><h3>${api.esc(c.title)}</h3></div><div class="actions">${staff?`<button class="btn btn-ghost extra-members" data-id="${c.id}">اعضا</button><button class="btn btn-ghost extra-sessions" data-id="${c.id}">جلسات</button>`:st.profile.role==="student"?(mine?`<span class="badge">${api.esc(mine.status)}</span>`:`<button class="btn btn-primary extra-register" data-id="${c.id}">درخواست ثبت‌نام</button>`):""}</div></div><p class="muted">${api.esc(c.description||"")}</p><div class="pill-row"><span class="badge">ظرفیت ${api.toFaDigits(count)} / ${api.toFaDigits(c.capacity)}</span><span class="badge">${api.esc(api.userName(c.teacher_id))}</span><span class="badge">${api.esc(c.location||"بدون مکان")}</span></div></article>`;
  }).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>فوق‌برنامه‌ها</h3><p class="muted">تقویتی، ورزشی، هنری، فرهنگی و سایر فعالیت‌ها</p></div>${manager?'<button class="btn btn-primary" id="newExtra">+ کلاس جدید</button>':""}</div><div class="extra-grid">${cards||'<div class="card empty">کلاس فوق‌برنامه‌ای تعریف نشده است.</div>'}</div>`;
  if($("#newExtra"))$("#newExtra").onclick=classModal;
  document.querySelectorAll(".extra-register").forEach(b=>b.onclick=async()=>{const {error}=await st.sb.rpc("register_extracurricular",{p_class:b.dataset.id});if(error){const m=error.message;return api.toast(m.includes("CLASS_FULL")?"ظرفیت این کلاس تکمیل شده است.":m.includes("ALREADY_REGISTERED")?"قبلاً ثبت‌نام کرده‌اید.":m.includes("REGISTRATION_CLOSED")?"مهلت ثبت‌نام پایان یافته است.":api.errText(error),true)}api.toast("درخواست ثبت‌نام ارسال شد.");render();});
  document.querySelectorAll(".extra-members").forEach(b=>b.onclick=()=>membersModal(b.dataset.id,enroll||[]));
  document.querySelectorAll(".extra-sessions").forEach(b=>b.onclick=()=>sessionsModal(b.dataset.id));
}
function classModal(){
  const st=api.state,teachers=st.profiles.filter(p=>p.role==="teacher"),now=new Date(),regEnd=new Date(Date.now()+7*86400000),start=new Date(Date.now()+10*86400000),end=new Date(Date.now()+60*86400000),local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  api.modal("کلاس فوق‌برنامه جدید",`<div class="form-grid"><label class="wide"><span>عنوان</span><input id="ecTitle"></label><label><span>دسته</span><select id="ecCat">${Object.entries(catLabel).map(([v,t])=>`<option value="${v}">${t}</option>`).join("")}</select></label><label><span>دبیر مسئول</span><select id="ecTeacher"><option value="">بدون دبیر</option>${teachers.map(t=>`<option value="${t.id}">${api.esc(t.full_name)}</option>`).join("")}</select></label><label><span>ظرفیت</span><input id="ecCap" inputmode="numeric" value="20"></label><label><span>مکان</span><input id="ecLoc"></label><label><span>شروع ثبت‌نام</span><input id="ecRegStart" type="datetime-local" value="${local(now)}"></label><label><span>پایان ثبت‌نام</span><input id="ecRegEnd" type="datetime-local" value="${local(regEnd)}"></label><label><span>شروع دوره</span><input id="ecStart" type="datetime-local" value="${local(start)}"></label><label><span>پایان دوره</span><input id="ecEnd" type="datetime-local" value="${local(end)}"></label><label class="wide"><span>توضیحات</span><textarea id="ecDesc"></textarea></label></div>`,async()=>{const p={title:$("#ecTitle").value.trim(),description:$("#ecDesc").value.trim()||null,category:$("#ecCat").value,teacher_id:$("#ecTeacher").value||null,capacity:Number(api.toEnDigits($("#ecCap").value)),location:$("#ecLoc").value.trim()||null,registration_start:new Date($("#ecRegStart").value).toISOString(),registration_end:new Date($("#ecRegEnd").value).toISOString(),starts_at:new Date($("#ecStart").value).toISOString(),ends_at:new Date($("#ecEnd").value).toISOString(),active:true,created_by:st.profile.id};if(!p.title||!p.capacity)throw new Error("عنوان و ظرفیت الزامی است.");const {error}=await st.sb.from("extracurricular_classes").insert(p);if(error)throw error;api.toast("کلاس فوق‌برنامه ایجاد شد.");render();},"ثبت کلاس");
}
function membersModal(classId,enrollments){
  const list=enrollments.filter(e=>e.class_id===classId),rows=list.map(e=>`<tr><td>${api.esc(api.userName(e.student_id))}</td><td><span class="badge">${api.esc(e.status)}</span></td><td><div class="actions"><button class="btn btn-ghost review-extra" data-id="${e.id}" data-status="approved">تأیید</button><button class="btn btn-ghost review-extra" data-id="${e.id}" data-status="rejected">رد</button></div></td></tr>`).join("");
  api.modal("اعضای فوق‌برنامه",`<div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>وضعیت</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="3" class="empty">درخواستی وجود ندارد.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
  document.querySelectorAll(".review-extra").forEach(b=>b.onclick=async()=>{const {error}=await api.state.sb.rpc("review_extracurricular",{p_enrollment:b.dataset.id,p_status:b.dataset.status});if(error)return api.toast(error.message.includes("CLASS_FULL")?"ظرفیت کلاس تکمیل شده است.":api.errText(error),true);$("#modal").close();render();});
}
async function sessionsModal(classId){
  const {data,error}=await api.state.sb.from("extracurricular_sessions").select("*").eq("class_id",classId).order("starts_at");if(error)return api.toast(api.errText(error),true);
  const rows=(data||[]).map(s=>`<tr><td>${api.faDateTime(s.starts_at)}</td><td>${api.faDateTime(s.ends_at)}</td><td>${api.esc(s.location||"-")}</td><td>${api.esc(s.note||"-")}</td></tr>`).join("");
  const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16),start=new Date(Date.now()+86400000),end=new Date(Date.now()+90000000);
  api.modal("جلسات فوق‌برنامه",`<div class="form-grid"><label><span>شروع</span><input id="esStart" type="datetime-local" value="${local(start)}"></label><label><span>پایان</span><input id="esEnd" type="datetime-local" value="${local(end)}"></label><label><span>مکان</span><input id="esLoc"></label><label><span>توضیح</span><input id="esNote"></label></div><br><div class="table-wrap"><table><thead><tr><th>شروع</th><th>پایان</th><th>مکان</th><th>توضیح</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">جلسه‌ای ثبت نشده است.</td></tr>'}</tbody></table></div>`,async()=>{const {error}=await api.state.sb.from("extracurricular_sessions").insert({class_id:classId,starts_at:new Date($("#esStart").value).toISOString(),ends_at:new Date($("#esEnd").value).toISOString(),location:$("#esLoc").value.trim()||null,note:$("#esNote").value.trim()||null});if(error)throw error;api.toast("جلسه ثبت شد.");render();},"افزودن جلسه");
}
api.registerModule({nav:{manager:[["extracurricular","فوق‌برنامه"]],teacher:[["extracurricular","فوق‌برنامه"]],student:[["extracurricular","فوق‌برنامه"]]},routes:{extracurricular:render}});
})();