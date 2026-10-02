(() => {
"use strict";
const api=window.SystemV7API;
if(!api)return;
const $=api.$;
const days=["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه"];

function friendly(e){
  const m=e?.message||String(e||"");
  const map={
    TIMETABLE_CLASS_CONFLICT:"برای این کلاس در این زنگ برنامه دیگری ثبت شده است.",
    TIMETABLE_TEACHER_CONFLICT:"این دبیر در این ساعت در کلاس دیگری برنامه دارد.",
    TEACHER_NOT_ASSIGNED:"این دبیر برای این کلاس و درس تخصیص داده نشده است.",
    INVALID_WEEKDAY:"روز هفته معتبر نیست.",
    TIMETABLE_NOT_FOUND:"رکورد برنامه پیدا نشد."
  };
  return map[m]||api.errText(e);
}

async function load(){
  const [{data:periods,error:pe},{data:entries,error:te}]=await Promise.all([
    api.state.sb.from("school_periods").select("*").eq("active",true).order("period_order"),
    api.state.sb.from("timetable_entries").select("*").order("weekday").order("created_at")
  ]);
  if(pe)throw pe;if(te)throw te;
  return {periods:periods||[],entries:entries||[]};
}

function cell(entry){
  if(!entry)return '<span class="muted">—</span>';
  return `<div class="timetable-cell"><strong>${api.esc(api.subjectName(entry.subject_id))}</strong><small>${api.esc(api.userName(entry.teacher_id))}</small><button class="btn btn-ghost btn-sm timetable-edit" data-id="${entry.id}">ویرایش</button></div>`;
}

async function render(){
  api.setPage("برنامه هفتگی","برنامه کلاس‌ها و زنگ‌های مدرسه");
  const {periods,entries}=await load();
  const st=api.state;
  let visible=entries;

  if(st.profile.role==="teacher")visible=entries.filter(x=>x.teacher_id===st.profile.id);
  if(st.profile.role==="student"){
    const classIds=st.classStudents.filter(x=>x.student_id===st.profile.id).map(x=>x.class_id);
    visible=entries.filter(x=>classIds.includes(x.class_id));
  }

  const manager=st.profile.role==="manager";
  const classFilter=manager?st.classes[0]?.id:null;
  const teacherFilter=st.profile.role==="teacher"?st.profile.id:null;

  const header=`<div class="panel-head page-actions"><div><h3>برنامه هفتگی</h3><p class="muted">شنبه تا پنجشنبه؛ جلوگیری از تداخل کلاس و دبیر در دیتابیس انجام می‌شود.</p></div>
    ${manager?'<div class="actions"><button class="btn btn-ghost" id="managePeriods">مدیریت زنگ‌ها</button><button class="btn btn-primary" id="addTimetable">+ برنامه جدید</button></div>':""}
  </div>`;

  const rows=periods.map(p=>{
    const cells=days.map((_,d)=>{
      const e=visible.find(x=>x.period_id===p.id&&x.weekday===d&&(manager?x.class_id===classFilter:true));
      return `<td>${cell(e)}</td>`;
    }).join("");
    return `<tr><td><strong>${api.esc(p.title)}</strong><small class="period-time">${api.toFaDigits(String(p.start_time).slice(0,5))} تا ${api.toFaDigits(String(p.end_time).slice(0,5))}</small></td>${cells}</tr>`;
  }).join("");

  const mobile=days.map((day,d)=>{
    const dayRows=visible.filter(x=>x.weekday===d&&(manager?x.class_id===classFilter:true));
    return `<section class="timetable-day"><h4>${day}</h4>${dayRows.length?dayRows.map(e=>{
      const p=periods.find(x=>x.id===e.period_id);
      return `<div class="timetable-day-row"><span>${api.esc(p?.title||"-")}</span><strong>${api.esc(api.subjectName(e.subject_id))}</strong><small>${api.esc(api.userName(e.teacher_id))}</small></div>`;
    }).join(""):'<div class="empty">برنامه‌ای ثبت نشده است.</div>'}</section>`;
  }).join("");

  const selector=manager?`<div class="card timetable-filter"><label><span>کلاس</span><select id="timetableClassFilter">${st.classes.map((x,i)=>`<option value="${x.id}" ${i===0?"selected":""}>${api.esc(api.className(x.id))}</option>`).join("")}</select></label></div>`:"";

  $("#content").innerHTML=`${header}${selector}<div class="card timetable-desktop"><div class="table-wrap"><table class="timetable-table"><thead><tr><th>زنگ</th>${days.map(d=>`<th>${d}</th>`).join("")}</tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">ابتدا زنگ‌های مدرسه را تعریف کنید.</td></tr>'}</tbody></table></div></div><div class="timetable-mobile">${mobile}</div>`;

  if(manager){
    $("#managePeriods").onclick=()=>periodsModal(periods);
    $("#addTimetable").onclick=()=>entryModal(null,periods);
    $("#timetableClassFilter").onchange=()=>renderForClass($("#timetableClassFilter").value,periods,entries);
    document.querySelectorAll(".timetable-edit").forEach(b=>b.onclick=()=>entryModal(entries.find(x=>x.id===b.dataset.id),periods));
  }
}

function renderForClass(classId,periods,entries){
  const tbody=document.querySelector(".timetable-table tbody");
  if(!tbody)return;
  tbody.innerHTML=periods.map(p=>`<tr><td><strong>${api.esc(p.title)}</strong><small class="period-time">${api.toFaDigits(String(p.start_time).slice(0,5))} تا ${api.toFaDigits(String(p.end_time).slice(0,5))}</small></td>${days.map((_,d)=>`<td>${cell(entries.find(x=>x.class_id===classId&&x.period_id===p.id&&x.weekday===d))}</td>`).join("")}</tr>`).join("");
  document.querySelectorAll(".timetable-edit").forEach(b=>b.onclick=()=>entryModal(entries.find(x=>x.id===b.dataset.id),periods));
}

function entryModal(entry,periods){
  const st=api.state;
  const classId=entry?.class_id||st.classes[0]?.id||"";
  const relevantSubjects=st.subjects.filter(s=>s.grade_id===st.classes.find(c=>c.id===classId)?.grade_id);
  const body=`<div class="form-grid">
    <label><span>کلاس</span><select id="ttClass">${st.classes.map(x=>`<option value="${x.id}" ${x.id===classId?"selected":""}>${api.esc(api.className(x.id))}</option>`).join("")}</select></label>
    <label><span>درس</span><select id="ttSubject">${relevantSubjects.map(x=>`<option value="${x.id}" ${x.id===entry?.subject_id?"selected":""}>${api.esc(x.title)}</option>`).join("")}</select></label>
    <label><span>دبیر</span><select id="ttTeacher"></select></label>
    <label><span>روز</span><select id="ttDay">${days.map((d,i)=>`<option value="${i}" ${i===entry?.weekday?"selected":""}>${d}</option>`).join("")}</select></label>
    <label><span>زنگ</span><select id="ttPeriod">${periods.map(x=>`<option value="${x.id}" ${x.id===entry?.period_id?"selected":""}>${api.esc(x.title)}</option>`).join("")}</select></label>
    <label><span>سال تحصیلی</span><input id="ttYear" value="${api.esc(entry?.academic_year||st.classes.find(c=>c.id===classId)?.academic_year||"۱۴۰۵-۱۴۰۶")}"></label>
    ${entry?'<div class="wide"><button type="button" class="btn btn-ghost danger" id="ttDelete">حذف این برنامه</button></div>':""}
  </div>`;

  api.modal(entry?"ویرایش برنامه":"برنامه جدید",body,async()=>{
    const {data,error}=await st.sb.rpc("save_timetable_entry",{
      p_id:entry?.id||null,
      p_class:$("#ttClass").value,
      p_subject:$("#ttSubject").value,
      p_teacher:$("#ttTeacher").value,
      p_weekday:Number($("#ttDay").value),
      p_period:$("#ttPeriod").value,
      p_academic_year:$("#ttYear").value.trim()
    });
    if(error)throw new Error(friendly(error));
    api.toast("برنامه ذخیره شد.");
    render();
  });

  const refreshTeachers=()=>{
    const c=$("#ttClass").value,s=$("#ttSubject").value;
    const ids=st.assignments.filter(a=>a.class_id===c&&a.subject_id===s).map(a=>a.teacher_id);
    $("#ttTeacher").innerHTML=ids.map(id=>`<option value="${id}" ${id===entry?.teacher_id?"selected":""}>${api.esc(api.userName(id))}</option>`).join("");
  };
  const refreshSubjects=()=>{
    const cl=st.classes.find(x=>x.id===$("#ttClass").value);
    const subs=st.subjects.filter(x=>x.grade_id===cl?.grade_id);
    $("#ttSubject").innerHTML=subs.map(x=>`<option value="${x.id}">${api.esc(x.title)}</option>`).join("");
    refreshTeachers();
  };
  $("#ttClass").onchange=refreshSubjects;
  $("#ttSubject").onchange=refreshTeachers;
  refreshTeachers();

  if($("#ttDelete"))$("#ttDelete").onclick=async()=>{
    if(!confirm("این برنامه حذف شود؟"))return;
    const {error}=await st.sb.from("timetable_entries").delete().eq("id",entry.id);
    if(error)return api.toast(friendly(error),true);
    $("#modal").close();api.toast("برنامه حذف شد.");render();
  };
}

function periodsModal(periods){
  const rows=periods.map(p=>`<tr><td>${api.esc(p.title)}</td><td>${p.period_order}</td><td>${api.toFaDigits(String(p.start_time).slice(0,5))}</td><td>${api.toFaDigits(String(p.end_time).slice(0,5))}</td><td><button class="btn btn-ghost danger del-period" data-id="${p.id}">حذف</button></td></tr>`).join("");
  api.modal("مدیریت زنگ‌ها",`<div class="form-grid"><label><span>عنوان زنگ</span><input id="periodTitle" placeholder="زنگ اول"></label><label><span>ترتیب</span><input id="periodOrder" inputmode="numeric"></label><label><span>شروع</span><input id="periodStart" type="time"></label><label><span>پایان</span><input id="periodEnd" type="time"></label></div><br><div class="table-wrap"><table><thead><tr><th>عنوان</th><th>ترتیب</th><th>شروع</th><th>پایان</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">زنگی تعریف نشده است.</td></tr>'}</tbody></table></div>`,async()=>{
    const payload={title:$("#periodTitle").value.trim(),period_order:Number(api.toEnDigits($("#periodOrder").value)),start_time:$("#periodStart").value,end_time:$("#periodEnd").value,active:true};
    if(!payload.title||!payload.period_order||!payload.start_time||!payload.end_time)throw new Error("همه مشخصات زنگ را کامل کنید.");
    const {error}=await api.state.sb.from("school_periods").insert(payload);
    if(error)throw error;
    api.toast("زنگ جدید ثبت شد.");render();
  },"افزودن زنگ");
  document.querySelectorAll(".del-period").forEach(b=>b.onclick=async()=>{
    const {error}=await api.state.sb.from("school_periods").delete().eq("id",b.dataset.id);
    if(error)return api.toast("زنگی که در برنامه استفاده شده قابل حذف نیست.",true);
    $("#modal").close();render();
  });
}

api.registerModule({
  nav:{
    manager:[["timetable","برنامه هفتگی"]],
    teacher:[["timetable","برنامه هفتگی من"]],
    student:[["timetable","برنامه هفتگی"]]
  },
  routes:{timetable:render}
});
})();