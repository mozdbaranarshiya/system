(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.routes.dashboard=async()=>{
const d=await V.rpc('get_school_dashboard');
const labels={students:'دانش‌آموزان',teachers:'دبیران',classes:'کلاس‌ها',absences_today:'غیبت امروز',exams:'آزمون‌های آینده',homework:'تکالیف فعال',objections:'اعتراض‌های باز',forms:'فرم‌های فعال',polls:'نظرسنجی‌های فعال',extracurricular:'فوق‌برنامه‌ها',appointments:'ملاقات‌های در انتظار',notifications:'اعلان‌های جدید',pending_homework:'تکالیف نیازمند بررسی'};
const keys=V.manager()?Object.keys(labels):s.profile.role==='teacher'?['classes','pending_homework','exams','objections','appointments','notifications']:['homework','exams','absences_today','forms','polls','extracurricular','appointments','notifications'];
const periods=await V.query(s.sb.from('school_periods').select('*').order('period_order'));
const schedule=d.today_schedule.filter(t=>s.profile.role!=='teacher'||t.teacher_id===s.profile.id);
const nowTime=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tehran'}).format(new Date(d.server_now));
const next=schedule.find(t=>(periods.find(p=>p.id===t.period_id)?.end_time||'')>nowTime);
V.page('داشبورد','نمای کلی مدرسه و برنامه امروز',`<div class="stats v7-stats">${keys.map(k=>`<div class="stat"><span>${labels[k]}</span><b>${d.stats[k]||0}</b></div>`).join('')}</div><div class="v7-dashboard-grid"><div class="card"><h3>برنامه امروز</h3>${next?`<p class="alert alert-info">کلاس بعدی / جاری: ${e(c.subjectName(next.subject_id))} · ${e(periods.find(p=>p.id===next.period_id)?.title)}</p>`:''}${c.table(['زنگ','کلاس','درس','دبیر'],schedule.map(t=>`<tr><td>${e(periods.find(p=>p.id===t.period_id)?.title)}</td><td>${e(c.className(t.class_id))}</td><td>${e(c.subjectName(t.subject_id))}</td><td>${e(c.userName(t.teacher_id))}</td></tr>`))}${V.toolbar(V.button('dashAttendance','حضور و غیاب','btn-ghost')+V.button('dashTimetable','برنامه هفتگی','btn-ghost'))}</div><div class="card"><h3>رویدادهای هفت روز آینده</h3>${d.upcoming.slice(0,12).map(x=>`<div class="v7-upcoming"><strong>${e(x.title)}</strong><small>${e(V.label(x.type))} · ${V.datetime(x.start_at)}</small></div>`).join('')||'<p class="empty">رویدادی ثبت نشده است.</p>'}${V.toolbar(V.button('dashCalendar','تقویم آموزشی','btn-ghost'))}</div></div>`);
V.bind('#dashAttendance',()=>c.navigate('attendance'));V.bind('#dashTimetable',()=>c.navigate('timetable'));V.bind('#dashCalendar',()=>c.navigate('calendar'));
if(s.profile.role==='student'){
const scores=await V.query(s.sb.from('scores').select('*').eq('student_id',s.profile.id).order('updated_at',{ascending:false}).limit(5));
$('#content').insertAdjacentHTML('beforeend',`<div class="card"><h3>آخرین نمرات</h3>${c.table(['درس','نوبت','تکوینی','پایانی','نهایی'],scores.map(x=>`<tr><td>${e(c.subjectName(x.subject_id))}</td><td>${e(x.period)}</td><td>${x.continuous_score??'—'}</td><td>${x.final_score??'—'}</td><td>${x.lesson_score??'—'}</td></tr>`))}</div>`);}
};
})();
