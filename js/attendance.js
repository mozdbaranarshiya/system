(() => {
"use strict";
const api=window.SystemV7API;
if(!api)return;
const $=api.$;
const statusLabels={
  present:"حاضر",
  absent:"غایب",
  excused_absence:"غیبت موجه",
  unexcused_absence:"غیبت غیرموجه",
  late:"تأخیر",
  early_leave:"خروج زودهنگام"
};
const statusOptions=Object.entries(statusLabels).map(([v,t])=>`<option value="${v}">${t}</option>`).join("");

function friendly(e){
  const m=e?.message||String(e||"");
  const map={
    STUDENT_NOT_IN_CLASS:"دانش‌آموز عضو این کلاس نیست.",
    INVALID_SCHEDULE_ENTRY:"جلسه انتخاب‌شده با این کلاس و درس سازگار نیست.",
    INVALID_DELAY_MINUTES:"تعداد دقیقه معتبر نیست.",
    INVALID_ATTENDANCE_DATE:"تاریخ حضور و غیاب معتبر نیست.",
    ACCESS_DENIED:"شما اجازه ثبت حضور و غیاب این کلاس را ندارید."
  };
  return map[m]||api.errText(e);
}
function isoToday(){
  const d=new Date(),off=d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
}
function periodRange(kind,anchor){
  const d=new Date(anchor+"T12:00:00");
  const start=new Date(d),end=new Date(d);
  if(kind==="day"){}
  else if(kind==="week"){
    const day=(d.getDay()+1)%7;
    start.setDate(d.getDate()-day);end.setDate(start.getDate()+6);
  }else if(kind==="month"){
    start.setDate(1);end.setMonth(start.getMonth()+1,0);
  }else{
    start.setMonth(0,1);end.setMonth(11,31);
  }
  const fmt=x=>new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10);
  return [fmt(start),fmt(end)];
}
function statusSelect(value){
  return `<select class="att-status">${Object.entries(statusLabels).map(([v,t])=>`<option value="${v}" ${v===value?"selected":""}>${t}</option>`).join("")}</select>`;
}

async function renderStudent(){
  api.setPage("حضور و غیاب من","سوابق حضور، غیبت و تأخیر");
  const {data,error}=await api.state.sb.from("attendance_records")
    .select("*").eq("student_id",api.state.profile.id)
    .order("attendance_date",{ascending:false}).limit(200);
  if(error)throw error;
  const rows=(data||[]).map(r=>`<tr><td>${api.toFaDigits(r.attendance_date)}</td><td>${api.esc(api.className(r.class_id))}</td><td>${api.esc(api.subjectName(r.subject_id))}</td><td><span class="badge ${["absent","unexcused_absence"].includes(r.status)?"warn":""}">${statusLabels[r.status]||r.status}</span></td><td>${r.delay_minutes||"-"}</td><td>${api.esc(r.note||"-")}</td></tr>`);
  const records=data||[];
  const absent=records.filter(x=>["absent","excused_absence","unexcused_absence"].includes(x.status)).length;
  const unexcused=records.filter(x=>x.status==="unexcused_absence").length;
  const late=records.filter(x=>x.status==="late").length;
  $("#content").innerHTML=`<div class="stats">
    <div class="stat"><span>کل غیبت</span><b>${api.toFaDigits(absent)}</b></div>
    <div class="stat"><span>غیبت غیرموجه</span><b>${api.toFaDigits(unexcused)}</b></div>
    <div class="stat"><span>تأخیر</span><b>${api.toFaDigits(late)}</b></div>
  </div><div class="card">${api.table(["تاریخ","کلاس","درس","وضعیت","دقیقه","توضیح"],rows,"سابقه‌ای ثبت نشده است.")}</div>`;
}

async function render(){
  if(api.state.profile.role==="student")return renderStudent();
  api.setPage("حضور و غیاب","ثبت سریع و گزارش حضور کلاس‌ها");
  const st=api.state;
  const mappings=st.profile.role==="teacher"
    ? st.assignments.filter(x=>x.teacher_id===st.profile.id)
    : st.classes.flatMap(c=>st.subjects.filter(s=>s.grade_id===c.grade_id).map(s=>({class_id:c.id,subject_id:s.id})));
  const uniq=[];const seen=new Set();
  for(const m of mappings){const k=m.class_id+"|"+m.subject_id;if(!seen.has(k)){seen.add(k);uniq.push(m)}}
  if(!uniq.length){$("#content").innerHTML='<div class="card empty">کلاس/درسی برای حضور و غیاب در دسترس نیست.</div>';return}
  $("#content").innerHTML=`
    <div class="card"><div class="toolbar">
      <label><span>کلاس و درس</span><select id="attCourse">${uniq.map(m=>`<option value="${m.class_id}|${m.subject_id}">${api.esc(api.className(m.class_id))} — ${api.esc(api.subjectName(m.subject_id))}</option>`).join("")}</select></label>
      <label><span>تاریخ</span><input id="attDate" type="date" value="${isoToday()}"></label>
      <label><span>جلسه برنامه هفتگی</span><select id="attSchedule"><option value="">جلسه آزاد</option></select></label>
      <button class="btn btn-primary" id="loadAttendance">نمایش کلاس</button>
    </div></div>
    <div id="attendanceGrid"></div>
    <div class="card attendance-report-card">
      <div class="panel-head"><div><h3>گزارش حضور و غیاب</h3><p class="muted">روزانه، هفتگی، ماهانه یا سالانه</p></div></div>
      <div class="toolbar">
        <label><span>بازه</span><select id="attReportKind"><option value="day">روزانه</option><option value="week">هفتگی</option><option value="month">ماهانه</option><option value="year">سالانه</option></select></label>
        <label><span>تاریخ مبنا</span><input id="attReportDate" type="date" value="${isoToday()}"></label>
        <button class="btn btn-ghost" id="loadAttendanceReport">نمایش گزارش</button>
      </div>
      <div id="attendanceReport"></div>
    </div>`;
  $("#loadAttendance").onclick=loadGrid;
  $("#attCourse").onchange=refreshSchedules;
  $("#loadAttendanceReport").onclick=loadReport;
  await refreshSchedules();
  await loadGrid();
}

async function refreshSchedules(){
  const [classId,subjectId]=($("#attCourse").value||"|").split("|");
  const {data,error}=await api.state.sb.from("timetable_entries").select("id,weekday,period_id,teacher_id").eq("class_id",classId).eq("subject_id",subjectId);
  if(error)return;
  const {data:periods}=await api.state.sb.from("school_periods").select("id,title,period_order").order("period_order");
  const pm=new Map((periods||[]).map(p=>[p.id,p]));
  $("#attSchedule").innerHTML='<option value="">جلسه آزاد</option>'+((data||[]).map(x=>`<option value="${x.id}">${api.esc(pm.get(x.period_id)?.title||"جلسه")} — ${["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه"][x.weekday]||""}</option>`).join(""));
}

async function loadGrid(){
  const [classId,subjectId]=($("#attCourse").value||"|").split("|");
  const date=$("#attDate").value;
  const schedule=$("#attSchedule").value||null;
  const ids=api.state.classStudents.filter(x=>x.class_id===classId).map(x=>x.student_id);
  const students=api.state.profiles.filter(p=>p.role==="student"&&ids.includes(p.id));
  let q=api.state.sb.from("attendance_records").select("*").eq("class_id",classId).eq("attendance_date",date).eq("subject_id",subjectId);
  if(schedule)q=q.eq("schedule_entry_id",schedule);else q=q.is("schedule_entry_id",null);
  const {data,error}=await q;if(error)throw error;
  const map=new Map((data||[]).map(x=>[x.student_id,x]));
  const rows=students.map(s=>{
    const r=map.get(s.id)||{status:"present",delay_minutes:0,note:""};
    return `<tr data-student="${s.id}"><td>${api.esc(s.full_name)}</td><td>${statusSelect(r.status)}</td><td><input class="att-minutes" inputmode="numeric" value="${r.delay_minutes||""}" placeholder="دقیقه"></td><td><input class="att-note" value="${api.esc(r.note||"")}" placeholder="توضیح اختیاری"></td></tr>`;
  }).join("");
  $("#attendanceGrid").innerHTML=`<div class="card"><div class="panel-head"><div><h3>${api.esc(api.className(classId))} — ${api.esc(api.subjectName(subjectId))}</h3><p class="muted">همه دانش‌آموزان به‌صورت پیش‌فرض حاضر هستند.</p></div><div class="actions"><button class="btn btn-ghost" id="allPresent">همه حاضر</button><button class="btn btn-primary" id="saveAttendance">ذخیره حضور و غیاب</button></div></div><br><div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>وضعیت</th><th>دقیقه</th><th>توضیح</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  document.querySelectorAll(".att-status").forEach(sel=>sel.onchange=()=>{
    const tr=sel.closest("tr"),minutes=tr.querySelector(".att-minutes");
    if(!["late","early_leave"].includes(sel.value))minutes.value="";
  });
  $("#allPresent").onclick=()=>document.querySelectorAll("#attendanceGrid tbody tr").forEach(tr=>{tr.querySelector(".att-status").value="present";tr.querySelector(".att-minutes").value="";});
  $("#saveAttendance").onclick=async()=>{
    const btn=$("#saveAttendance"),old=btn.textContent;btn.disabled=true;btn.textContent="در حال ذخیره…";
    try{
      const records=[...document.querySelectorAll("#attendanceGrid tbody tr")].map(tr=>({
        student_id:tr.dataset.student,status:tr.querySelector(".att-status").value,
        delay_minutes:Number(api.toEnDigits(tr.querySelector(".att-minutes").value||"0")),
        note:tr.querySelector(".att-note").value.trim()
      }));
      const {error}=await api.state.sb.rpc("save_attendance_bulk",{p_class:classId,p_subject:subjectId,p_schedule:schedule,p_date:date,p_records:records});
      if(error)throw new Error(friendly(error));
      api.toast("حضور و غیاب کلاس ذخیره شد.");
    }catch(e){api.toast(friendly(e),true)}
    finally{btn.disabled=false;btn.textContent=old}
  };
}

async function loadReport(){
  const [classId]=($("#attCourse").value||"|").split("|");
  const [from,to]=periodRange($("#attReportKind").value,$("#attReportDate").value);
  const {data,error}=await api.state.sb.rpc("attendance_summary",{p_from:from,p_to:to,p_class:classId});
  if(error)return api.toast(friendly(error),true);
  const rows=(data||[]).map(x=>`<tr><td>${api.esc(api.userName(x.student_id))}</td><td>${x.present_count}</td><td>${Number(x.absent_count)+Number(x.excused_count)+Number(x.unexcused_count)}</td><td>${x.excused_count}</td><td><strong>${x.unexcused_count}</strong></td><td>${x.late_count}</td><td>${x.delay_minutes}</td></tr>`);
  $("#attendanceReport").innerHTML='<br>'+api.table(["دانش‌آموز","حاضر","کل غیبت","موجه","غیرموجه","تأخیر","دقیقه تأخیر"],rows,"در این بازه رکوردی وجود ندارد.");
}

api.registerModule({
  nav:{
    manager:[["attendance","حضور و غیاب"]],
    teacher:[["attendance","حضور و غیاب"]],
    student:[["attendance","حضور و غیاب من"]]
  },
  routes:{attendance:render}
});
})();