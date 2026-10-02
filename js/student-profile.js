(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.routes['student-profile']=async()=>{
const students=V.personOptions('student');if(!V.staff())V.focusStudent=s.profile.id;
const id=V.focusStudent||students[0]?.id;
if(!id){V.page('پرونده دانش‌آموز','', '<div class="card empty">دانش‌آموزی در دسترس نیست.</div>');return;}
V.focusStudent=id;const d=await V.rpc('get_student_profile',{p_student:id});if(!d.profile)throw new Error('ACCESS_DENIED');
const p=d.profile,avg=V.reportData(d).annual,cls=d.classes[0];
const tabs={scores:'نمرات',attendance:'حضور و غیاب',homework:'تکالیف',exams:'آزمون‌ها',behavior:'رفتار و انضباط',objections:'اعتراض‌ها',extracurricular:'فوق‌برنامه',forms:'فرم‌ها'};
V.page('پرونده دانش‌آموز',p.full_name,`${V.staff()?`<div class="card no-print">${V.select('profileStudent','دانش‌آموز',students,id)}${V.toolbar(V.button('showStudentProfile','نمایش پرونده'))}</div>`:''}<div class="card"><div class="v7-student-heading"><div class="avatar">${e(p.full_name[0])}</div><div><h2>${e(p.full_name)}</h2><p>کد ملی: ${e(p.national_id)} · پایه: ${e(c.byId(s.grades,cls?.grade_id)?.title||'—')} · ${e(cls?c.className(cls.id):'بدون کلاس')}</p><p>${p.active?'حساب فعال':'حساب غیرفعال'} · ایجاد حساب: ${V.date(p.created_at)}</p></div></div><div class="stats v7-stats"><div class="stat"><span>معدل سالانه</span><b>${avg===null?'—':avg.toFixed(2)}</b></div><div class="stat"><span>غیبت</span><b>${d.attendance_summary.total}</b></div><div class="stat"><span>امتیاز مثبت</span><b>${d.behavior_summary.positive}</b></div><div class="stat"><span>امتیاز منفی</span><b>${d.behavior_summary.negative}</b></div><div class="stat"><span>تکالیف ثبت‌شده</span><b>${d.homework.length}</b></div><div class="stat"><span>آزمون‌ها</span><b>${d.exams.length}</b></div><div class="stat"><span>انضباط</span><b>${d.discipline[0]?.score??'—'}</b></div><div class="stat"><span>اعتراض‌ها</span><b>${d.objections.length}</b></div></div><div class="v7-tabs no-print">${Object.entries(tabs).map(([key,title])=>`<button class="btn btn-ghost profile-tab" data-tab="${key}">${title}</button>`).join('')}${V.button('profileReport','کارنامه','btn-ghost')}</div><div id="profileTab"></div><p class="hint">در هر بخش آخرین ۲۰۰ مورد نمایش داده می‌شود. برای فیلتر و خروجی کامل از گزارش‌ها استفاده کنید.</p>${V.toolbar(V.button('profileReports','گزارش کامل','btn-ghost'))}</div>`);
function draw(key){let rows=d[key]||[];const show=(headers,values)=>$('#profileTab').innerHTML=c.table(headers,values.map(row=>'<tr>'+row.map(x=>`<td>${e(x)}</td>`).join('')+'</tr>'));
if(key==='scores')show(['درس','نوبت','تکوینی','پایانی','نهایی'],rows.map(r=>[c.subjectName(r.subject_id),r.period,r.continuous_score??'—',r.final_score??'—',r.lesson_score??'—']));
if(key==='attendance')show(['تاریخ','درس','وضعیت','دقیقه','یادداشت'],rows.map(r=>[V.date(r.attendance_date+'T12:00:00Z'),c.subjectName(r.subject_id),V.label(r.status),r.delay_minutes,r.note]));
if(key==='homework')show(['تکلیف','درس','نمره','منبع','تاریخ'],rows.map(r=>[r.title,c.subjectName(r.subject_id),r.score,{automatic:'خودکار',submission:'ارسال تکلیف',manager:'مدیر'}[r.source],V.datetime(r.updated_at)]));
if(key==='exams')show(['عنوان / آزمون','وضعیت','نمره','تاریخ'],rows.map(r=>[r.title||'آزمون',V.label(r.status),r.total_score??'در انتظار نتیجه',V.datetime(r.submitted_at)]));
if(key==='behavior')show(['تاریخ','عنوان','نوع','امتیاز'],rows.map(r=>[V.date(r.event_date+'T12:00:00Z'),r.title,V.label(r.event_type),r.points]).concat(d.discipline.map(r=>[V.date(r.updated_at),'انضباط',r.note||'نمره انضباط',r.score])));
if(key==='objections')show(['علت','وضعیت','پاسخ','تاریخ'],rows.map(r=>[r.reason,V.label(r.status),r.teacher_response,V.datetime(r.created_at)]));
if(key==='extracurricular')show(['کلاس فوق‌برنامه','وضعیت','تاریخ ثبت‌نام'],rows.map(r=>[r.title,V.label(r.status),V.datetime(r.registered_at)]));
if(key==='forms')show(['فرم','شماره پاسخ','تاریخ ارسال'],rows.map(r=>[r.title,r.submission_number,V.datetime(r.submitted_at)]));
document.querySelectorAll('.profile-tab').forEach(b=>b.classList.toggle('btn-primary',b.dataset.tab===key));}
V.bind('.profile-tab',b=>draw(b.dataset.tab));V.bind('#showStudentProfile',async()=>{V.focusStudent=V.value('profileStudent');await c.navigate('student-profile');});V.bind('#profileReport',()=>c.navigate('student-report'));V.bind('#profileReports',()=>c.navigate('reports'));draw('scores');};
})();
