(() => {
"use strict";
const V=window.SchoolV8;
const statusOptions=(selected="present")=>Object.entries(V.attendanceLabels).map(([v,t])=>`<option value="${v}" ${v===selected?"selected":""}>${t}</option>`).join("");
async function renderStudent(){
  const A=V.app();const {data,error}=await V.sb().from("attendance_records").select("*").order("attendance_date",{ascending:false}).limit(180);if(error)throw error;
  const rows=data||[],absent=rows.filter(x=>["absent","excused_absent","unexcused_absent"].includes(x.status)).length,late=rows.filter(x=>x.status==="late").length;
  A.setPage("حضور و غیاب من","سوابق ثبت‌شده حضور، غیبت و تأخیر");
  document.querySelector("#content").innerHTML=`<div class="stats"><div class="stat"><span>کل جلسات ثبت‌شده</span><b>${V.fa(rows.length)}</b></div><div class="stat"><span>غیبت</span><b>${V.fa(absent)}</b></div><div class="stat"><span>تأخیر</span><b>${V.fa(late)}</b></div></div><section class="card">${A.table(["تاریخ","درس","وضعیت","دقیقه","توضیح"],rows.map(x=>`<tr><td>${V.dateOnly(x.attendance_date)}</td><td>${V.escape(V.subjectLabel(x.subject_id))}</td><td><span class="badge">${V.attendanceLabels[x.status]||x.status}</span></td><td>${V.fa(x.delay_minutes||0)}</td><td>${V.escape(x.note||"-")}</td></tr>`),"سابقه‌ای ثبت نشده است.")}</section>`;
}
async function renderStaff(){
  const A=V.app(),s=V.state(),role=s.profile.role;A.setPage("حضور و غیاب",role==="manager"?"ثبت، اصلاح و گزارش حضور تمام کلاس‌ها":"ثبت سریع حضور کلاس‌های شما");
  const {data:entries,error}=await V.sb().from("timetable_entries").select("*").order("weekday");if(error)throw error;
  const list=(entries||[]).filter(x=>role==="manager"||x.teacher_id===s.profile.id);
  document.querySelector("#content").innerHTML=`<section class="card"><div class="toolbar"><label><span>جلسه</span><select id="attendanceSchedule">${list.map(x=>`<option value="${x.id}">${V.escape(V.classLabel(x.class_id))} — ${V.escape(V.subjectLabel(x.subject_id))} — ${V.weekdays[x.weekday]}</option>`).join("")}</select></label><label><span>تاریخ</span><input id="attendanceDate" type="date" value="${V.isoDate()}"></label><button class="btn btn-primary" id="loadAttendance">نمایش دانش‌آموزان</button></div></section><div id="attendanceArea"></div>`;
  if(!list.length){document.querySelector("#attendanceArea").innerHTML='<div class="card empty">جلسه‌ای برای ثبت حضور در دسترس نیست.</div>';return}
  document.querySelector("#loadAttendance").onclick=()=>loadGrid(list);await loadGrid(list);
}
async function loadGrid(entries){
  const scheduleId=document.querySelector("#attendanceSchedule").value,date=document.querySelector("#attendanceDate").value,entry=entries.find(x=>x.id===scheduleId);if(!entry)return;
  const students=V.classStudents(entry.class_id);const {data,error}=await V.sb().from("attendance_records").select("*").eq("schedule_entry_id",scheduleId).eq("attendance_date",date);if(error)throw error;const map=new Map((data||[]).map(x=>[x.student_id,x]));
  const rows=students.map(st=>{const old=map.get(st.id)||{status:"present",delay_minutes:0,note:""};return `<tr data-student="${st.id}"><td>${V.escape(st.full_name)}</td><td><select class="att-status">${statusOptions(old.status)}</select></td><td><input class="att-minutes" inputmode="numeric" value="${V.fa(old.delay_minutes||0)}" ${["late","early_leave"].includes(old.status)?"":"disabled"}></td><td><input class="att-note" value="${V.escape(old.note||"")}" placeholder="توضیح اختیاری"></td></tr>`});
  document.querySelector("#attendanceArea").innerHTML=`<section class="card"><div class="panel-head"><div><h3>${V.escape(V.classLabel(entry.class_id))} — ${V.escape(V.subjectLabel(entry.subject_id))}</h3><p class="muted">${V.dateOnly(date)}</p></div><div class="actions"><button class="btn btn-ghost" id="allPresent">همه حاضر</button><button class="btn btn-primary" id="saveAttendance">ثبت گروهی</button></div></div><br>${V.app().table(["دانش‌آموز","وضعیت","دقیقه","توضیح"],rows,"دانش‌آموزی در کلاس نیست.")}</section>`;
  document.querySelectorAll(".att-status").forEach(sel=>sel.onchange=()=>{const r=sel.closest("tr"),m=r.querySelector(".att-minutes"),need=["late","early_leave"].includes(sel.value);m.disabled=!need;if(!need)m.value="۰"});
  document.querySelector("#allPresent").onclick=()=>document.querySelectorAll("#attendanceArea tbody tr").forEach(r=>{r.querySelector(".att-status").value="present";r.querySelector(".att-minutes").value="۰";r.querySelector(".att-minutes").disabled=true});
  document.querySelector("#saveAttendance").onclick=async e=>{try{await V.withBusy(e.currentTarget,async()=>{const records=[...document.querySelectorAll("#attendanceArea tbody tr")].map(r=>({student_id:r.dataset.student,status:r.querySelector(".att-status").value,delay_minutes:Number(V.en(r.querySelector(".att-minutes").value)||0),note:r.querySelector(".att-note").value.trim()}));const count=await V.rpc("save_attendance_batch",{p_schedule:scheduleId,p_date:date,p_records:records});V.success(`${V.fa(count)} رکورد حضور و غیاب ذخیره شد.`)},"در حال ثبت…")}catch(err){V.showError(err)}};
}
V.registerRoute("attendance",()=>V.state().profile.role==="student"?renderStudent():renderStaff());
})();
