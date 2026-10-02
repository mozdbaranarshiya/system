(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.routes.attendance=async()=>{
const staff=V.staff();let page=0;
V.page('حضور و غیاب',staff?'ثبت سریع حضور جلسه و مشاهده سوابق':'سوابق حضور و غیاب من',`<div class="card no-print"><div class="form-grid">${V.select('attClass','کلاس',V.classOptions())}${V.select('attSubject','درس',[], '',!staff)}${V.dateField('attDate','تاریخ جلسه')}${staff?V.select('attSession','جلسه برنامه هفتگی',[],'',true):''}</div>${V.toolbar(V.button('loadAttendance',staff?'نمایش دانش‌آموزان':'مشاهده سوابق')+(staff?V.button('allPresent','همه حاضر','btn-ghost')+V.button('saveAttendance','ثبت گروهی'):'')+V.button('attHistory','گزارش سوابق','btn-ghost')+V.button('attendanceReports','گزارش‌های دوره‌ای','btn-ghost'))}</div><div class="card" id="attGrid"></div>`);
const loadSubjects=async()=>{
$('#attSubject').innerHTML=(staff?V.subjects(V.value('attClass')):s.subjects.filter(x=>x.grade_id===c.byId(s.classes,V.value('attClass'))?.grade_id)).map(x=>`<option value="${x.id}">${e(x.title)}</option>`).join('');
if(!staff)$('#attSubject').insertAdjacentHTML('afterbegin','<option value="">همه دروس</option>');await sessions();};
async function sessions(){if(!staff)return;
if(!V.value('attClass')||!V.value('attSubject')){$('#attSession').innerHTML='<option value="">جلسه دستی</option>';return;}
const rows=await V.query(s.sb.from('timetable_entries').select('*,school_periods(title,start_time)').eq('class_id',V.value('attClass')).eq('subject_id',V.value('attSubject')));
$('#attSession').innerHTML='<option value="">جلسه دستی</option>'+rows.map(x=>`<option value="${x.id}">${e(V.days[x.weekday])} · ${e(x.school_periods?.title)}</option>`).join('');}
async function grid(){
if(!staff)return history();
const date=V.gregorian(V.value('attDate')),cid=V.value('attClass'),sub=V.value('attSubject');
if(!cid||!sub){$('#attGrid').innerHTML='<p class="empty">کلاس و درس تخصیص‌یافته‌ای وجود ندارد.</p>';return;}
let q=s.sb.from('attendance_records').select('*').eq('class_id',cid).eq('subject_id',sub).eq('attendance_date',date);
q=V.value('attSession')?q.eq('schedule_entry_id',V.value('attSession')):q.is('schedule_entry_id',null);
const records=await V.query(q),students=V.students(cid);
$('#attGrid').innerHTML=c.table(['دانش‌آموز','وضعیت','دقیقه تأخیر / خروج','یادداشت'],students.map(p=>{const r=records.find(x=>x.student_id===p.id);return `<tr data-student="${p.id}"><td>${e(p.full_name)}</td><td><select class="att-status">${Object.entries(V.labels).filter(([id])=>['present','absent','excused','unexcused','late','early_departure'].includes(id)).map(([id,title])=>`<option value="${id}" ${r?.status===id?'selected':''}>${title}</option>`).join('')}</select></td><td><input class="att-minutes" type="number" min="0" max="720" value="${r?.delay_minutes||0}"></td><td><input class="att-note" maxlength="2000" value="${e(r?.note||'')}"></td></tr>`;}));
document.querySelectorAll('.att-status').forEach(el=>{el.onchange=()=>{const minutes=el.closest('tr').querySelector('.att-minutes');minutes.disabled=!['late','early_departure'].includes(el.value);if(minutes.disabled)minutes.value=0;};el.onchange();});}
async function history(){
let q=s.sb.from('attendance_records').select('*',{count:'exact'}).order('attendance_date',{ascending:false}).range(page*50,page*50+49);
if(V.value('attClass'))q=q.eq('class_id',V.value('attClass'));if(V.value('attSubject'))q=q.eq('subject_id',V.value('attSubject'));
const {data,error,count}=await q;if(error)throw error;
$('#attGrid').innerHTML=c.table(['تاریخ','دانش‌آموز','کلاس','درس','وضعیت','دقیقه','یادداشت'],(data||[]).map(r=>`<tr><td>${V.date(r.attendance_date+'T12:00:00Z')}</td><td>${e(c.userName(r.student_id))}</td><td>${e(c.className(r.class_id))}</td><td>${e(c.subjectName(r.subject_id))}</td><td>${V.badge(r.status)}</td><td>${r.delay_minutes}</td><td>${e(r.note)}</td></tr>`))+V.pager(page,count||0);
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await history();});V.bind('#nextPage',async()=>{page++;await history();});}
$('#attClass').onchange=()=>loadSubjects().catch(err=>c.toast(c.errText(err),true));$('#attSubject').onchange=()=>sessions().catch(err=>c.toast(c.errText(err),true));
V.bind('#attendanceReports',async()=>{V.reportKind='attendance';await c.navigate('reports');});V.bind('#loadAttendance',grid);V.bind('#attHistory',async()=>{page=0;await history();});V.bind('#allPresent',()=>document.querySelectorAll('.att-status').forEach(el=>{el.value='present';el.onchange();}));
V.bind('#saveAttendance',async()=>{const records=[...document.querySelectorAll('#attGrid tr[data-student]')].map(row=>({student_id:row.dataset.student,status:row.querySelector('.att-status').value,delay_minutes:Number(row.querySelector('.att-minutes').value),note:row.querySelector('.att-note').value.trim()}));
if(!records.length)throw new Error('ابتدا فهرست دانش‌آموزان را نمایش دهید.');
await V.rpc('save_attendance',{p_class:V.value('attClass'),p_subject:V.value('attSubject'),p_date:V.gregorian(V.value('attDate')),p_schedule:V.value('attSession')||null,p_records:records});c.toast('حضور و غیاب ذخیره شد.');});
await loadSubjects();if(staff)await grid();else await history();};
})();
