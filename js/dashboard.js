(() => {
"use strict";
const V=window.SchoolV8;

const card=(label,value,icon,route="")=>`
  <button class="v8-stat-card ${route?"clickable":""}" ${route?`data-route="${route}"`:""}>
    <span class="v8-stat-icon">${icon}</span>
    <span class="v8-stat-label">${V.escape(label)}</span>
    <strong>${V.fa(value??0)}</strong>
  </button>`;

V.registerRoute("dashboard",async()=>{
  const A=V.app(),s=V.state(),role=s.profile.role;
  A.setPage("داشبورد","خلاصه هوشمند فعالیت‌های مدرسه");
  try{await V.rpc("materialize_my_reminders")}catch(_){}
  const data=await V.rpc("dashboard_v8");

  let cards=[];
  if(role==="manager"){
    cards=[
      card("دانش‌آموزان",data.students,"دان","studentProfile"),
      card("دبیران",data.teachers,"دب","users"),
      card("کلاس‌ها",data.classes,"ک","structure"),
      card("غیبت امروز",data.absent_today,"غ","attendance"),
      card("آزمون‌های آینده",data.upcoming_exams,"آ","exams"),
      card("تکالیف فعال",data.active_homework,"ت","homeworkGrades"),
      card("اعتراض‌های در انتظار",data.pending_objections,"!","objections"),
      card("فرم‌های فعال",data.active_forms,"ف","forms"),
      card("نظرسنجی‌های فعال",data.active_polls,"ن","polls"),
      card("فوق‌برنامه",data.extracurricular,"فوق","extracurricular"),
      card("ملاقات‌های در انتظار",data.pending_appointments,"م","appointments"),
      card("اعلان‌های خوانده‌نشده",data.unread_notifications,"●","notifications")
    ];
  }else if(role==="teacher"){
    cards=[
      card("کلاس‌های امروز",data.today_schedule,"ک","timetable"),
      card("تکالیف در انتظار بررسی",data.pending_homework,"ت","homework"),
      card("آزمون‌های آینده",data.upcoming_exams,"آ","exams"),
      card("اعتراض‌های در انتظار",data.pending_objections,"!","objections"),
      card("ملاقات‌های در انتظار",data.pending_appointments,"م","appointments"),
      card("اعلان‌های جدید",data.unread_notifications,"●","notifications")
    ];
  }else{
    cards=[
      card("تکالیف نزدیک",data.upcoming_homework,"ت","homework"),
      card("آزمون‌های آینده",data.upcoming_exams,"آ","exams"),
      card("غیبت‌ها",data.absences,"غ","attendance"),
      card("فرم‌های فعال",data.active_forms,"ف","forms"),
      card("نظرسنجی‌ها",data.active_polls,"ن","polls"),
      card("اعلان‌های جدید",data.unread_notifications,"●","notifications")
    ];
  }

  const now=new Date(),end=new Date(now.getTime()+3*86400000);
  let events=[];
  try{events=await V.rpc("calendar_feed_v8",{p_start:now.toISOString(),p_end:end.toISOString()})||[]}catch(_){}

  document.querySelector("#content").innerHTML=`
    <div class="v8-dashboard-grid">${cards.join("")}</div>
    <div class="grid-2 dashboard-lower">
      <section class="card">
        <div class="panel-head"><div><h3>موارد نزدیک</h3><p class="muted">سه روز آینده</p></div><button class="btn btn-ghost btn-sm" data-route="calendar">تقویم</button></div>
        <div class="timeline-list">
          ${events.length?events.slice(0,8).map(x=>`
            <button class="timeline-item" data-route="${V.escape(x.link||"calendar")}">
              <span class="timeline-dot"></span>
              <span><strong>${V.escape(x.title)}</strong><small>${V.dateTime(x.starts_at)}</small></span>
            </button>`).join(""):'<div class="empty">مورد نزدیکی ثبت نشده است.</div>'}
        </div>
      </section>
      <section class="card quick-actions">
        <h3>دسترسی سریع</h3>
        <div class="quick-action-grid">
          <button data-route="timetable">برنامه هفتگی</button>
          <button data-route="attendance">حضور و غیاب</button>
          <button data-route="calendar">تقویم</button>
          <button data-route="notifications">اعلان‌ها</button>
          <button data-route="accountSecurity">امنیت حساب</button>
          ${role!=="student"?'<button data-route="reports">گزارش‌ها</button>':""}
        </div>
      </section>
    </div>`;

  document.querySelectorAll("#content [data-route]").forEach(b=>b.onclick=()=>V.route(b.dataset.route));
});
})();