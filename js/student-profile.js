(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
function studentsForRole(){
  const st=api.state;
  if(st.profile.role==="student")return [st.profile];
  if(st.profile.role==="manager")return st.profiles.filter(p=>p.role==="student");
  const classIds=[...new Set(st.assignments.filter(a=>a.teacher_id===st.profile.id).map(a=>a.class_id))];
  const ids=[...new Set(st.classStudents.filter(cs=>classIds.includes(cs.class_id)).map(cs=>cs.student_id))];
  return st.profiles.filter(p=>p.role==="student"&&ids.includes(p.id));
}
async function render(studentId=null){
  api.setPage("پرونده دانش‌آموز","نمای جامع تحصیلی و اجرایی");
  const list=studentsForRole(),sid=studentId||list[0]?.id;
  if(!sid){$("#content").innerHTML='<div class="card empty">دانش‌آموزی در دسترس نیست.</div>';return}
  const {data,error}=await api.state.sb.rpc("student_profile_bundle",{p_student:sid});if(error)throw error;
  const p=data.profile||{},scores=data.scores||[],attendance=data.attendance||[],behavior=data.behavior||[],homework=data.homework_grades||[],exams=data.exam_attempts||[];
  const lesson=scores.filter(s=>s.lesson_score!=null).map(s=>Number(s.lesson_score)),avg=lesson.length?lesson.reduce((a,b)=>a+b,0)/lesson.length:null;
  const abs=attendance.filter(a=>["absent","excused_absence","unexcused_absence"].includes(a.status)).length;
  const unexc=attendance.filter(a=>a.status==="unexcused_absence").length;
  const pos=behavior.filter(b=>b.points>0).reduce((a,b)=>a+Number(b.points),0),neg=behavior.filter(b=>b.points<0).reduce((a,b)=>a+Number(b.points),0);
  const selector=api.state.profile.role==="student"?"":`<div class="card student-profile-selector"><label><span>دانش‌آموز</span><select id="profileStudent">${list.map(s=>`<option value="${s.id}" ${s.id===sid?"selected":""}>${api.esc(s.full_name)} — ${api.esc(s.national_id)}</option>`).join("")}</select></label></div>`;
  const scoreRows=scores.map(s=>`<tr><td>${api.esc(api.subjectName(s.subject_id))}</td><td>${api.esc(s.period)}</td><td>${s.continuous_score??"-"}</td><td>${s.final_score??"-"}</td><td><strong>${s.lesson_score??"-"}</strong></td></tr>`);
  const attRows=attendance.slice(0,100).map(a=>`<tr><td>${api.toFaDigits(a.attendance_date)}</td><td>${api.esc(api.subjectName(a.subject_id))}</td><td>${api.esc(a.status)}</td><td>${a.delay_minutes||"-"}</td></tr>`);
  const behRows=behavior.slice(0,100).map(b=>`<tr><td>${api.toFaDigits(b.event_date)}</td><td>${api.esc(b.title)}</td><td>${api.esc(b.category)}</td><td>${b.points>0?"+":""}${b.points}</td></tr>`);
  const hwRows=homework.map(h=>`<tr><td>${h.assignment_id.slice(0,8)}…</td><td>${h.score}</td><td>${api.esc(h.source)}</td></tr>`);
  const exRows=exams.map(e=>`<tr><td>${e.exam_id.slice(0,8)}…</td><td>${api.esc(e.status)}</td><td>${e.total_score}</td><td>${api.faDateTime(e.started_at)}</td></tr>`);
  $("#content").innerHTML=`${selector}<section class="student-profile-head card"><div class="avatar student-profile-avatar">${api.esc((p.full_name||"د").charAt(0))}</div><div><h2>${api.esc(p.full_name||"-")}</h2><p class="muted">کد ملی: ${api.esc(p.national_id||"-")} · ${api.esc((data.classes||[]).map(c=>c.class_title).join("، ")||"-")}</p></div><span class="badge">${p.active?"فعال":"غیرفعال"}</span></section>
  <div class="stats"><div class="stat"><span>معدل نمرات ثبت‌شده</span><b>${avg==null?"-":api.toFaDigits(avg.toFixed(2))}</b></div><div class="stat"><span>کل غیبت</span><b>${api.toFaDigits(abs)}</b></div><div class="stat"><span>غیبت غیرموجه</span><b>${api.toFaDigits(unexc)}</b></div><div class="stat"><span>امتیاز رفتار</span><b>${api.toFaDigits(pos+neg)}</b></div></div>
  <div class="profile-tabs"><button class="btn btn-primary profile-tab" data-tab="scores">نمرات</button><button class="btn btn-ghost profile-tab" data-tab="attendance">حضور و غیاب</button><button class="btn btn-ghost profile-tab" data-tab="homework">تکالیف</button><button class="btn btn-ghost profile-tab" data-tab="exams">آزمون‌ها</button><button class="btn btn-ghost profile-tab" data-tab="behavior">رفتار و انضباط</button><button class="btn btn-ghost profile-tab" data-tab="extra">فوق‌برنامه</button></div>
  <div id="profileTabBody">
    <div class="profile-panel" data-panel="scores">${api.table(["درس","نوبت","تکوینی","پایانی","نهایی"],scoreRows,"نمره‌ای ثبت نشده است.")}</div>
    <div class="profile-panel hidden" data-panel="attendance">${api.table(["تاریخ","درس","وضعیت","دقیقه"],attRows,"سابقه‌ای ثبت نشده است.")}</div>
    <div class="profile-panel hidden" data-panel="homework">${api.table(["تکلیف","نمره","منبع"],hwRows,"نمره تکلیفی وجود ندارد.")}</div>
    <div class="profile-panel hidden" data-panel="exams">${api.table(["آزمون","وضعیت","نمره","شروع"],exRows,"آزمونی ثبت نشده است.")}</div>
    <div class="profile-panel hidden" data-panel="behavior">${api.table(["تاریخ","عنوان","دسته","امتیاز"],behRows,"رویداد رفتاری وجود ندارد.")}</div>
    <div class="profile-panel hidden" data-panel="extra">${(data.extracurricular||[]).map(x=>`<article class="card"><h4>${api.esc(x.class?.title||"-")}</h4><span class="badge">${api.esc(x.enrollment?.status||"-")}</span></article>`).join("")||'<div class="empty">عضویت فوق‌برنامه‌ای وجود ندارد.</div>'}</div>
  </div>`;
  if($("#profileStudent"))$("#profileStudent").onchange=e=>render(e.target.value);
  document.querySelectorAll(".profile-tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".profile-tab").forEach(x=>{x.classList.toggle("btn-primary",x===b);x.classList.toggle("btn-ghost",x!==b)});document.querySelectorAll(".profile-panel").forEach(pn=>pn.classList.toggle("hidden",pn.dataset.panel!==b.dataset.tab));});
}
api.registerModule({nav:{manager:[["studentProfile","پرونده دانش‌آموز"]],teacher:[["studentProfile","پرونده دانش‌آموز"]],student:[["studentProfile","پرونده من"]]},routes:{studentProfile:()=>{const selected=window.SystemV7SelectedStudent||null;window.SystemV7SelectedStudent=null;return render(selected)}}});
})();