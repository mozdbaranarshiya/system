(() => {
"use strict";
const V=window.SchoolV8;
async function loadData(){
  const [p,e]=await Promise.all([
    V.sb().from("school_periods").select("*").eq("active",true).order("period_order"),
    V.sb().from("timetable_entries").select("*").order("weekday")
  ]);
  if(p.error)throw p.error;if(e.error)throw e.error;
  return {periods:p.data||[],entries:e.data||[]};
}
function label(e){return `<strong>${V.escape(V.subjectLabel(e.subject_id))}</strong><small>${V.escape(V.classLabel(e.class_id))}<br>${V.escape(V.userLabel(e.teacher_id))}</small>`}
async function render(){
  const A=V.app(),s=V.state(),role=s.profile.role;
  A.setPage("برنامه هفتگی",role==="manager"?"مدیریت زنگ‌ها و برنامه کلاس‌ها":role==="teacher"?"برنامه تدریس هفتگی شما":"برنامه هفتگی کلاس شما");
  const {periods,entries:all}=await loadData();let entries=all;
  if(role==="teacher")entries=all.filter(x=>x.teacher_id===s.profile.id);
  if(role==="student")entries=all.filter(x=>x.class_id===V.studentClassId());
  if(V.context.classId){entries=all.filter(x=>x.class_id===V.context.classId);delete V.context.classId}
  const rows=periods.map(p=>`<tr><th><b>${V.escape(p.title)}</b><small>${String(p.start_time).slice(0,5)} تا ${String(p.end_time).slice(0,5)}</small></th>${V.weekdays.map((_,d)=>{const list=entries.filter(x=>x.period_id===p.id&&Number(x.weekday)===d);return `<td>${list.map(x=>`<div class="schedule-chip" data-id="${x.id}">${label(x)}</div>`).join("")||'<span class="schedule-empty">—</span>'}</td>`}).join("")}</tr>`).join("");
  document.querySelector("#content").innerHTML=`${role==="manager"?`<div class="panel-head page-actions"><div><h3>برنامه آموزشی</h3><p class="muted">تداخل کلاس و دبیر در دیتابیس مسدود می‌شود.</p></div><div class="actions"><button class="btn btn-ghost" id="managePeriods">مدیریت زنگ‌ها</button><button class="btn btn-primary" id="addSchedule">+ برنامه جدید</button></div></div>`:""}<section class="card"><div class="timetable-desktop table-wrap"><table class="timetable-table"><thead><tr><th>زنگ</th>${V.weekdays.map((_,d)=>{}).join("")}</tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">برنامه‌ای ثبت نشده است.</td></tr>'}</tbody></table></div><div class="timetable-mobile"><label><span>روز</span><select id="mobileTimetableDay">${V.weekdays.map((x,i)=>`<option value="${i}">${x}</option>`).join("")}</select></label><div id="mobileTimetableList"></div></div></section>`;
  const renderMobile=()=>{const d=Number(document.querySelector("#mobileTimetableDay")?.value||0);document.querySelector("#mobileTimetableList").innerHTML=periods.map(p=>{const x=entries.find(e=>e.period_id===p.id&&Number(e.weekday)===d);return `<div class="mobile-schedule-row"><span><b>${V.escape(p.title)}</b><small>${String(p.start_time).slice(0,5)}</small></span><div>${x?label(x):'<span class="muted">آزاد</span>'}</div></div>`}).join("")};
  document.querySelector("#mobileTimetableDay")?.addEventListener("change",renderMobile);renderMobile();
  if(role==="manager"){
    document.querySelector("#managePeriods").onclick=()=>periodModal(periods);
    document.querySelector("#addSchedule").onclick=()=>scheduleModal(periods);
  }
}
function periodModal(periods){
  const A=V.app();
  A.modal("مدیریت زنگ‌ها",`<div class="form-grid"><label><span>عنوان زنگ</span><input id="periodTitle" placeholder="مثلاً زنگ اول"></label><label><span>ترتیب</span><input id="periodOrder" inputmode="numeric" value="${periods.length+1}"></label><label><span>شروع</span><input id="periodStart" type="time"></label><label><span>پایان</span><input id="periodEnd" type="time"></label></div><br>${periods.length?`<div class="table-wrap"><table><thead><tr><th>عنوان</th><th>زمان</th></tr></thead><tbody>${periods.map(p=>`<tr><td>${V.escape(p.title)}</td><td>${String(p.start_time).slice(0,5)} تا ${String(p.end_time).slice(0,5)}</td></tr>`).join("")}</tbody></table></div>`:""}`,async()=>{const payload={title:document.querySelector("#periodTitle").value.trim(),period_order:Number(V.en(document.querySelector("#periodOrder").value)),start_time:document.querySelector("#periodStart").value,end_time:document.querySelector("#periodEnd").value,active:true};if(!payload.title||!payload.start_time||!payload.end_time)throw new Error("اطلاعات زنگ کامل نیست.");const {error}=await V.sb().from("school_periods").insert(payload);if(error)throw error;V.success("زنگ جدید ثبت شد.");render()},"ثبت زنگ");
}
function scheduleModal(periods){
  const A=V.app(),s=V.state(),teachers=s.profiles.filter(p=>p.role==="teacher"&&p.active);
  A.modal("ثبت برنامه هفتگی",`<div class="form-grid"><label><span>کلاس</span><select id="ttClass">${s.classes.map(c=>`<option value="${c.id}">${V.escape(V.classLabel(c.id))}</option>`).join("")}</select></label><label><span>درس</span><select id="ttSubject">${s.subjects.map(x=>`<option value="${x.id}">${V.escape(x.title)}</option>`).join("")}</select></label><label><span>دبیر</span><select id="ttTeacher">${teachers.map(x=>`<option value="${x.id}">${V.escape(x.full_name)}</option>`).join("")}</select></label><label><span>روز</span><select id="ttDay">${V.weekdays.map((x,i)=>`<option value="${i}">${x}</option>`).join("")}</select></label><label><span>زنگ</span><select id="ttPeriod">${periods.map(p=>`<option value="${p.id}">${V.escape(p.title)} — ${String(p.start_time).slice(0,5)}</option>`).join("")}</select></label><label><span>سال تحصیلی</span><input id="ttYear" value="${V.escape(s.classes[0]?.academic_year||"۱۴۰۵-۱۴۰۶")}"></label></div>`,async()=>{const payload={class_id:document.querySelector("#ttClass").value,subject_id:document.querySelector("#ttSubject").value,teacher_id:document.querySelector("#ttTeacher").value,weekday:Number(document.querySelector("#ttDay").value),period_id:document.querySelector("#ttPeriod").value,academic_year:document.querySelector("#ttYear").value.trim()};const {error}=await V.sb().from("timetable_entries").insert(payload);if(error)throw error;V.success("برنامه ثبت شد.");render()},"ثبت برنامه");
}
V.registerRoute("timetable",render);
})();
