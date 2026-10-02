(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const typeLabel={positive:"مثبت",negative:"منفی",neutral:"خنثی"};
async function render(){
  api.setPage("رفتار و تشویق","ثبت و مشاهده رویدادهای رفتاری");
  const st=api.state;
  const [{data:events,error:ee},{data:cats,error:ce}]=await Promise.all([
    st.sb.from("behavior_events").select("*").order("event_date",{ascending:false}).limit(300),
    st.sb.from("behavior_categories").select("*").order("title")
  ]);
  if(ee)throw ee;if(ce)throw ce;
  if(st.profile.role==="student"){
    const mine=events||[],pos=mine.filter(x=>x.points>0).reduce((a,b)=>a+b.points,0),neg=mine.filter(x=>x.points<0).reduce((a,b)=>a+b.points,0);
    const rows=mine.map(e=>`<tr><td>${api.toFaDigits(e.event_date)}</td><td>${api.esc(e.category)}</td><td>${api.esc(e.title)}</td><td><span class="badge ${e.event_type==="negative"?"warn":""}">${typeLabel[e.event_type]}</span></td><td><strong>${e.points>0?"+":""}${api.toFaDigits(e.points)}</strong></td><td>${api.esc(e.description||"-")}</td></tr>`);
    $("#content").innerHTML=`<div class="stats"><div class="stat"><span>امتیاز مثبت</span><b>+${api.toFaDigits(pos)}</b></div><div class="stat"><span>امتیاز منفی</span><b>${api.toFaDigits(neg)}</b></div><div class="stat"><span>مجموع</span><b>${api.toFaDigits(pos+neg)}</b></div></div><div class="card">${api.table(["تاریخ","دسته","عنوان","نوع","امتیاز","توضیح"],rows,"رویدادی ثبت نشده است.")}</div>`;return;
  }
  const allowedClasses=st.profile.role==="manager"?st.classes:[...new Set(st.assignments.filter(a=>a.teacher_id===st.profile.id).map(a=>a.class_id))].map(id=>st.classes.find(c=>c.id===id)).filter(Boolean);
  const cards=(events||[]).map(e=>`<article class="behavior-card"><div><span class="badge ${e.event_type==="negative"?"warn":""}">${typeLabel[e.event_type]}</span><h3>${api.esc(e.title)}</h3><p class="muted">${api.esc(api.userName(e.student_id))} — ${api.esc(api.className(e.class_id))}</p><small>${api.toFaDigits(e.event_date)} · ${api.esc(e.category)} · ${e.points>0?"+":""}${e.points}</small></div>${st.profile.role==="manager"?`<button class="btn btn-ghost danger delete-behavior" data-id="${e.id}">حذف</button>`:""}</article>`).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>رویدادهای رفتاری</h3><p class="muted">امتیازهای مثبت و منفی در پرونده دانش‌آموز تجمیع می‌شوند.</p></div><div class="actions">${st.profile.role==="manager"?'<button class="btn btn-ghost" id="manageBehaviorCategories">دسته‌ها</button>':""}<button class="btn btn-primary" id="newBehavior">+ رویداد جدید</button></div></div><div class="behavior-list">${cards||'<div class="card empty">رویدادی ثبت نشده است.</div>'}</div>`;
  $("#newBehavior").onclick=()=>eventModal(cats||[],allowedClasses);
  if($("#manageBehaviorCategories"))$("#manageBehaviorCategories").onclick=()=>categoriesModal(cats||[]);
  document.querySelectorAll(".delete-behavior").forEach(b=>b.onclick=async()=>{if(!confirm("این رویداد حذف شود؟"))return;const {error}=await st.sb.from("behavior_events").delete().eq("id",b.dataset.id);if(error)return api.toast(api.errText(error),true);render();});
}
function eventModal(cats,classes){
  const st=api.state,first=classes[0]?.id||"";
  const studentsFor=c=>st.classStudents.filter(x=>x.class_id===c).map(x=>st.profiles.find(p=>p.id===x.student_id)).filter(Boolean);
  api.modal("رویداد رفتاری",`<div class="form-grid"><label><span>کلاس</span><select id="beClass">${classes.map(c=>`<option value="${c.id}">${api.esc(api.className(c.id))}</option>`).join("")}</select></label><label><span>دانش‌آموز</span><select id="beStudent"></select></label><label><span>دسته</span><select id="beCategory">${cats.map(c=>`<option value="${c.id}" data-type="${c.default_event_type}" data-points="${c.default_points}">${api.esc(c.title)}</option>`).join("")}</select></label><label><span>نوع</span><select id="beType"><option value="positive">مثبت</option><option value="negative">منفی</option><option value="neutral">خنثی</option></select></label><label><span>امتیاز</span><input id="bePoints" inputmode="numeric"></label><label><span>تاریخ</span><input id="beDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label><label class="wide"><span>عنوان</span><input id="beTitle"></label><label class="wide"><span>توضیح</span><textarea id="beDesc"></textarea></label></div>`,async()=>{
    const cat=cats.find(x=>x.id===$("#beCategory").value);
    const payload={student_id:$("#beStudent").value,class_id:$("#beClass").value,event_date:$("#beDate").value,category_id:cat?.id||null,category:cat?.title||"سایر",event_type:$("#beType").value,title:$("#beTitle").value.trim(),description:$("#beDesc").value.trim()||null,points:Number(api.toEnDigits($("#bePoints").value||"0")),recorded_by:st.profile.id};
    if(!payload.student_id||!payload.title)throw new Error("دانش‌آموز و عنوان الزامی است.");
    const {error}=await st.sb.from("behavior_events").insert(payload);if(error)throw error;api.toast("رویداد رفتاری ثبت شد.");render();
  },"ثبت رویداد");
  const fillStudents=()=>{$("#beStudent").innerHTML=studentsFor($("#beClass").value).map(s=>`<option value="${s.id}">${api.esc(s.full_name)}</option>`).join("")};
  const fillCategory=()=>{const o=$("#beCategory").selectedOptions[0];$("#beType").value=o?.dataset.type||"neutral";$("#bePoints").value=o?.dataset.points||0};
  $("#beClass").onchange=fillStudents;$("#beCategory").onchange=fillCategory;fillStudents();fillCategory();
}
function categoriesModal(cats){
  api.modal("دسته‌های رفتار",`<div class="form-grid"><label><span>عنوان</span><input id="bcTitle"></label><label><span>نوع پیش‌فرض</span><select id="bcType"><option value="positive">مثبت</option><option value="negative">منفی</option><option value="neutral">خنثی</option></select></label><label><span>امتیاز پیش‌فرض</span><input id="bcPoints" inputmode="numeric" value="0"></label></div><br><div class="table-wrap"><table><thead><tr><th>عنوان</th><th>نوع</th><th>امتیاز</th></tr></thead><tbody>${cats.map(c=>`<tr><td>${api.esc(c.title)}</td><td>${typeLabel[c.default_event_type]}</td><td>${c.default_points}</td></tr>`).join("")}</tbody></table></div>`,async()=>{const {error}=await api.state.sb.from("behavior_categories").insert({title:$("#bcTitle").value.trim(),default_event_type:$("#bcType").value,default_points:Number(api.toEnDigits($("#bcPoints").value||"0")),created_by:api.state.profile.id});if(error)throw error;api.toast("دسته اضافه شد.");render();},"افزودن");
}
api.registerModule({nav:{manager:[["behavior","رفتار و تشویق"]],teacher:[["behavior","رفتار و تشویق"]],student:[["behavior","رفتار من"]]},routes:{behavior:render}});
})();