(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
const days=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
V.days=days;
V.routes.timetable=async()=>{
const [entries,periods]=await Promise.all([V.query(s.sb.from('timetable_entries').select('*').order('weekday')),V.query(s.sb.from('school_periods').select('*').order('period_order'))]);
const draw=()=>{
const cls=$('#ttClass').value,teacher=$('#ttTeacher').value,grade=$('#ttGrade').value,year=V.value('ttYear'),day=$('#ttDay').value;
const rows=entries.filter(t=>(!cls||t.class_id===cls)&&(!teacher||t.teacher_id===teacher)&&(!year||t.academic_year===year)&&(!grade||c.byId(s.classes,t.class_id)?.grade_id===grade));
const cell=t=>`<div class="v7-lesson"><strong>${e(c.subjectName(t.subject_id))}</strong><small>${e(c.className(t.class_id))} · ${e(c.userName(t.teacher_id))}</small>${V.manager()?`<button class="btn btn-ghost edit-lesson" data-id="${t.id}">ویرایش</button>`:''}</div>`;
$('#ttGrid').innerHTML=`<div class="v7-weekly table-wrap"><table><thead><tr><th>زنگ</th>${days.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>${periods.map(p=>`<tr><th>${e(p.title)}<small class="v7-block">${e(p.start_time.slice(0,5))} تا ${e(p.end_time.slice(0,5))}</small></th>${days.map((d,i)=>`<td>${rows.filter(t=>t.weekday===i&&t.period_id===p.id).map(cell).join('')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="v7-daily">${periods.map(p=>`<div class="card"><h4>${e(p.title)} · ${e(p.start_time.slice(0,5))}</h4>${rows.filter(t=>String(t.weekday)===day&&t.period_id===p.id).map(cell).join('')||'<p class="muted">برنامه‌ای ثبت نشده است.</p>'}</div>`).join('')}</div>`;
V.bind('.edit-lesson',b=>lessonModal(entries.find(x=>x.id===b.dataset.id),periods));};
V.page('برنامه هفتگی',s.profile.role==='teacher'?'برنامه هفتگی من':'جدول زنگ‌ها و برنامه مدرسه',`<div class="card no-print"><div class="form-grid">${V.select('ttClass','کلاس',V.classOptions(),'',true)}${V.select('ttTeacher','دبیر',V.personOptions('teacher'),s.profile.role==='teacher'?s.profile.id:'',true)}${V.select('ttGrade','پایه',s.grades,'',true)}${V.field('ttYear','سال تحصیلی','text',V.classes()[0]?.academic_year||'',false)}${V.select('ttDay','نمای روزانه موبایل',days.map((title,id)=>({id,title})),(new Date().getUTCDay()+1)%7)}</div>${V.toolbar(V.manager()?V.button('addLesson','برنامه جدید')+V.button('managePeriods','مدیریت زنگ‌ها','btn-ghost'):'')}</div><div id="ttGrid"></div>`);
['ttClass','ttTeacher','ttGrade','ttDay','ttYear'].forEach(id=>$('#'+id).onchange=draw);draw();
V.bind('#addLesson',()=>lessonModal(null,periods));V.bind('#managePeriods',()=>periodModal(periods));};
function periodModal(periods){
c.modal('مدیریت زنگ‌های مدرسه',`<div class="form-grid">${V.select('periodId','زنگ برای ویرایش',periods,'',true)}${V.field('periodTitle','عنوان زنگ')}${V.field('periodOrder','ترتیب','number',periods.length+1)}${V.field('periodStart','از ساعت','time','08:00')}${V.field('periodEnd','تا ساعت','time','09:15')}<label><span>فعال</span><input id="periodActive" type="checkbox" checked></label></div>`,async()=>{
const id=V.value('periodId'),p={title:$('#periodTitle').value.trim(),period_order:V.number('periodOrder'),start_time:V.value('periodStart'),end_time:V.value('periodEnd'),active:$('#periodActive').checked};
await V.query(id?s.sb.from('school_periods').update(p).eq('id',id):s.sb.from('school_periods').insert(p));await c.navigate('timetable');});
$('#periodId').onchange=()=>{const p=periods.find(x=>x.id===V.value('periodId'));if(!p)return;$('#periodTitle').value=p.title;$('#periodOrder').value=p.period_order;$('#periodStart').value=p.start_time;$('#periodEnd').value=p.end_time;$('#periodActive').checked=p.active;};}
function lessonModal(t,periods){
if(!periods.some(p=>p.active))return c.toast('ابتدا زنگ‌های مدرسه را تعریف کنید.',true);
c.modal(t?'ویرایش برنامه':'برنامه جدید',`<div class="form-grid">${V.select('lessonClass','کلاس',V.classOptions(),t?.class_id)}${V.select('lessonSubject','درس',[],t?.subject_id)}${V.select('lessonTeacher','دبیر',[],t?.teacher_id)}${V.select('lessonDay','روز',days.map((title,id)=>({id,title})),t?.weekday)}${V.select('lessonPeriod','زنگ',periods.filter(p=>p.active),t?.period_id)}${V.field('lessonYear','سال تحصیلی','text',t?.academic_year||V.classes()[0]?.academic_year||'1405-1406')}</div>`,async()=>{
const p={class_id:V.value('lessonClass'),subject_id:V.value('lessonSubject'),teacher_id:V.value('lessonTeacher'),weekday:V.number('lessonDay'),period_id:V.value('lessonPeriod'),academic_year:V.value('lessonYear')};
await V.query(t?s.sb.from('timetable_entries').update(p).eq('id',t.id):s.sb.from('timetable_entries').insert(p));await c.navigate('timetable');});
const teachers=()=>{const rows=s.assignments.filter(a=>a.class_id===V.value('lessonClass')&&a.subject_id===V.value('lessonSubject'));$('#lessonTeacher').innerHTML=rows.map(a=>`<option value="${a.teacher_id}">${e(c.userName(a.teacher_id))}</option>`).join('');if(t&&rows.some(a=>a.teacher_id===t.teacher_id))$('#lessonTeacher').value=t.teacher_id;};
const subjects=()=>{$('#lessonSubject').innerHTML=V.subjects(V.value('lessonClass')).map(x=>`<option value="${x.id}">${e(x.title)}</option>`).join('');if(t)$('#lessonSubject').value=t.subject_id;$('#lessonYear').value=c.byId(s.classes,V.value('lessonClass'))?.academic_year||'';teachers();};
$('#lessonClass').onchange=subjects;$('#lessonSubject').onchange=teachers;subjects();}
})();
