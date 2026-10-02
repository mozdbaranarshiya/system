(() => {
"use strict";
async function render(api){
  api.setPage("داشبورد","نمای امروز و موارد نیازمند توجه");
  const {data,error}=await api.state.sb.rpc("dashboard_v7");
  if(error)throw error;

  const schedule=(data.today_schedule||[]).map(x=>`<article class="today-class"><span class="badge">${api.toFaDigits(String(x.start_time||"").slice(0,5))}</span><div><strong>${api.esc(api.subjectName(x.subject_id))}</strong><small>${api.esc(api.className(x.class_id))} — ${api.esc(x.period_title||"")}</small></div></article>`).join("");
  if(data.role==="manager"){
    const cards=[
      ["دانش‌آموزان",data.students,"studentProfile"],
      ["دبیران",data.teachers,"users"],
      ["کلاس‌ها",data.classes,"structure"],
      ["غیبت امروز",data.absent_today,"attendance"],
      ["آزمون‌های ۷ روز آینده",data.upcoming_exams,"exams"],
      ["تکالیف فعال",data.active_homework,"homeworkGrades"],
      ["اعتراض‌های در انتظار",data.pending_objections,"objections"],
      ["فرم‌های فعال",data.active_forms,"forms"],
      ["نظرسنجی‌های فعال",data.active_polls,"polls"],
      ["فوق‌برنامه‌ها",data.active_extracurricular,"extracurricular"],
      ["ملاقات‌های در انتظار",data.pending_appointments,"appointments"],
      ["رویدادهای نزدیک",data.near_events,"calendar"]
    ];
    document.querySelector("#content").innerHTML=`<div class="dashboard-kpis">${cards.map(([t,v,r])=>`<button class="dashboard-kpi" data-route="${r}"><span>${api.esc(t)}</span><b>${api.toFaDigits(v||0)}</b><small>مشاهده جزئیات</small></button>`).join("")}</div><div class="dashboard-panels"><div class="card dashboard-welcome"><span class="eyebrow">مدیریت مدرسه</span><h3>وضعیت امروز سامانه</h3><p class="muted">موارد مهم آموزشی و اجرایی از بخش‌های مختلف در این داشبورد تجمیع شده‌اند.</p></div><div class="card"><div class="panel-head"><h3>اعلان‌های خوانده‌نشده</h3><span class="badge">${api.toFaDigits(data.unread_notifications||0)}</span></div><button class="btn btn-ghost full dashboard-route" data-route="notifications">مشاهده مرکز اعلان‌ها</button></div></div>`;
  }else if(data.role==="teacher"){
    document.querySelector("#content").innerHTML=`
      <div class="dashboard-kpis">
        <button class="dashboard-kpi" data-route="homework"><span>تکالیف در انتظار بررسی</span><b>${api.toFaDigits(data.pending_homework||0)}</b><small>بررسی تکالیف</small></button>
        <button class="dashboard-kpi" data-route="exams"><span>آزمون‌ها</span><b>${api.toFaDigits(data.exams||0)}</b><small>مدیریت آزمون</small></button>
        <button class="dashboard-kpi" data-route="objections"><span>اعتراض‌های در انتظار</span><b>${api.toFaDigits(data.pending_objections||0)}</b><small>رسیدگی</small></button>
        <button class="dashboard-kpi" data-route="appointments"><span>درخواست ملاقات</span><b>${api.toFaDigits(data.pending_appointments||0)}</b><small>مدیریت ملاقات</small></button>
      </div>
      <div class="dashboard-panels"><div class="card"><div class="panel-head"><h3>برنامه امروز من</h3><button class="btn btn-ghost btn-sm dashboard-route" data-route="timetable">برنامه کامل</button></div><div class="today-schedule">${schedule||'<div class="empty">امروز کلاس ثبت‌شده‌ای ندارید.</div>'}</div></div><div class="card"><div class="panel-head"><h3>اعلان‌های جدید</h3><span class="badge">${api.toFaDigits(data.unread_notifications||0)}</span></div><button class="btn btn-ghost full dashboard-route" data-route="notifications">مشاهده اعلان‌ها</button></div></div>`;
  }else{
    const scores=(data.latest_scores||[]).map(s=>`<div class="latest-score"><span>${api.esc(api.subjectName(s.subject_id))}</span><strong>${s.lesson_score??"-"}</strong><small>${api.esc(s.period||"")}</small></div>`).join("");
    document.querySelector("#content").innerHTML=`
      <div class="dashboard-kpis">
        <button class="dashboard-kpi" data-route="homework"><span>تکالیف ۷ روز آینده</span><b>${api.toFaDigits(data.due_homework||0)}</b><small>مشاهده تکالیف</small></button>
        <button class="dashboard-kpi" data-route="exams"><span>آزمون‌های آینده</span><b>${api.toFaDigits(data.upcoming_exams||0)}</b><small>آزمون‌ها</small></button>
        <button class="dashboard-kpi" data-route="attendance"><span>کل غیبت</span><b>${api.toFaDigits(data.absence_count||0)}</b><small>سوابق حضور</small></button>
        <button class="dashboard-kpi" data-route="notifications"><span>اعلان جدید</span><b>${api.toFaDigits(data.unread_notifications||0)}</b><small>اعلان‌ها</small></button>
      </div>
      <div class="dashboard-panels">
        <div class="card"><div class="panel-head"><h3>برنامه امروز</h3><button class="btn btn-ghost btn-sm dashboard-route" data-route="timetable">برنامه هفتگی</button></div><div class="today-schedule">${schedule||'<div class="empty">امروز کلاسی ثبت نشده است.</div>'}</div></div>
        <div class="card"><div class="panel-head"><h3>آخرین نمرات</h3><button class="btn btn-ghost btn-sm dashboard-route" data-route="report">کارنامه</button></div><div class="latest-scores">${scores||'<div class="empty">نمره‌ای ثبت نشده است.</div>'}</div></div>
        <div class="card dashboard-mini-links">
          <button class="dashboard-route" data-route="forms"><span>فرم‌های فعال</span><b>${api.toFaDigits(data.active_forms||0)}</b></button>
          <button class="dashboard-route" data-route="polls"><span>نظرسنجی‌ها</span><b>${api.toFaDigits(data.active_polls||0)}</b></button>
          <button class="dashboard-route" data-route="extracurricular"><span>فوق‌برنامه باز</span><b>${api.toFaDigits(data.available_extracurricular||0)}</b></button>
          <button class="dashboard-route" data-route="appointments"><span>ملاقات آینده</span><b>${api.toFaDigits(data.upcoming_appointments||0)}</b></button>
        </div>
      </div>`;
  }
  document.querySelectorAll(".dashboard-kpi,.dashboard-route").forEach(b=>b.onclick=()=>api.navigate(b.dataset.route));
}
window.SystemV7Dashboard={render};
})();