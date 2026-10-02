(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.routes.exams=async()=>{
const staff=V.staff();let page=0;
V.page('آزمون‌های آنلاین',staff?'طراحی آزمون، بانک سؤال و تصحیح پاسخ‌ها':'شرکت در آزمون‌های کلاس',`<div class="card">${V.toolbar(staff?V.button('newExam','آزمون جدید')+V.button('questionBank','بانک سؤال','btn-ghost'):'')}<div id="examList"></div></div>`);
async function draw(){
const {data,error,count}=await s.sb.from('exams').select('*',{count:'exact'}).order('start_at',{ascending:false}).range(page*50,page*50+49);if(error)throw error;
$('#examList').innerHTML=c.table(['عنوان','کلاس / درس','شروع','پایان','مدت','انتشار','عملیات'],(data||[]).map(x=>`<tr><td>${e(x.title)}</td><td>${e(c.className(x.class_id))}<br>${e(c.subjectName(x.subject_id))}</td><td>${V.datetime(x.start_at)}</td><td>${V.datetime(x.end_at)}</td><td>${x.duration_minutes} دقیقه</td><td>${x.published?'منتشرشده':'پیش‌نویس'}</td><td>${staff?`<button class="btn btn-ghost grade-exam" data-id="${x.id}">پاسخ‌ها</button><button class="btn btn-ghost publish-exam" data-id="${x.id}">${x.published?'توقف انتشار':'انتشار'}</button><button class="btn btn-ghost results-exam" data-id="${x.id}">${x.show_result_after_submit?'بستن نتیجه':'نمایش نتیجه'}</button>`:`<button class="btn btn-primary start-exam" data-id="${x.id}">ورود / ادامه / نتیجه</button>`}</td></tr>`))+V.pager(page,count||0);
V.bind('.start-exam',async b=>{V.activeAttempt=await V.rpc('start_exam',{p_exam:b.dataset.id});await c.navigate('exam-session');});
V.bind('.grade-exam',async b=>{V.gradingExam=b.dataset.id;await c.navigate('exam-grading');});
V.bind('.publish-exam',async b=>{const x=data.find(x=>x.id===b.dataset.id);await V.query(s.sb.from('exams').update({published:!x.published}).eq('id',x.id));await draw();});
V.bind('.results-exam',async b=>{const x=data.find(x=>x.id===b.dataset.id);await V.query(s.sb.from('exams').update({show_result_after_submit:!x.show_result_after_submit}).eq('id',x.id));await draw();});
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#questionBank',()=>c.navigate('question-bank'));V.bind('#newExam',newExam);await draw();};
V.routes['question-bank']=async()=>{
if(!V.staff())throw new Error('ACCESS_DENIED');let page=0;
V.page('بانک سؤال','سؤال‌های عینی و تشریحی',`<div class="card">${V.toolbar(V.button('newQuestion','سؤال جدید')+V.button('backExams','آزمون‌ها','btn-ghost'))}<div id="bankList"></div></div>`);
async function draw(){const {data,error,count}=await s.sb.from('question_bank').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*50,page*50+49);if(error)throw error;
$('#bankList').innerHTML=c.table(['متن سؤال','درس','نوع','بارم'],(data||[]).map(q=>`<tr><td>${e(q.question_text)}</td><td>${e(c.subjectName(q.subject_id))}</td><td>${e(V.label(q.question_type))}</td><td>${q.default_score}</td></tr>`))+V.pager(page,count||0);
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#newQuestion',()=>{
const subjects=s.subjects.filter(x=>V.manager()||s.assignments.some(a=>a.teacher_id===s.profile.id&&a.subject_id===x.id));
c.modal('سؤال جدید',`<div class="form-grid">${V.select('qSubject','درس',subjects)}${V.select('qType','نوع سؤال',V.options({multiple_choice:'چهارگزینه‌ای',true_false:'صحیح و غلط',short_answer:'پاسخ کوتاه',essay:'تشریحی'}))}<label class="wide"><span>متن سؤال</span><textarea id="qText" required maxlength="12000"></textarea></label>${V.field('qScore','بارم پیش‌فرض','number',1)}<div id="qOptions" class="wide"></div></div>`,async()=>{
const type=V.value('qType'),options=[...document.querySelectorAll('.q-option')].map((input,i)=>({option_text:input.value.trim(),is_correct:i===V.number('qCorrect')}));
await V.rpc('save_bank_question',{p_question:{subject_id:V.value('qSubject'),question_type:type,question_text:$('#qText').value.trim(),default_score:V.number('qScore')},p_options:options});c.toast('سؤال ذخیره شد.');await draw();});
const options=()=>{const type=V.value('qType'),n=type==='true_false'?2:type==='multiple_choice'?4:0;
$('#qOptions').innerHTML=n?`<div class="form-grid">${Array.from({length:n},(_,i)=>`<label><span>گزینه ${i+1}</span><input class="q-option" value="${type==='true_false'?(i?'غلط':'صحیح'):''}" required></label>`).join('')}${V.select('qCorrect','گزینه صحیح',Array.from({length:n},(_,i)=>({id:i,title:'گزینه '+(i+1)})))}</div>`:'<p class="hint">پاسخ این سؤال توسط دبیر تصحیح می‌شود.</p>';};
$('#qType').onchange=options;options();});V.bind('#backExams',()=>c.navigate('exams'));await draw();};
async function newExam(){
const questions=await V.query(s.sb.from('question_bank').select('*').order('created_at',{ascending:false}).limit(500));
if(!questions.length)return c.toast('ابتدا سؤال‌ها را در بانک سؤال ثبت کنید.',true);
c.modal('طراحی آزمون',`<div class="form-grid">${V.field('exTitle','عنوان آزمون')}${V.select('exClass','کلاس',V.classOptions())}${V.select('exSubject','درس',[])}${V.select('exTeacher','دبیر مسئول',[])}${V.dateField('exStart','شروع',new Date(),true)}${V.dateField('exEnd','پایان',new Date(Date.now()+3600000),true)}${V.field('exDuration','مدت پاسخ‌گویی (دقیقه)','number',30)}<label><span>انتشار</span><input type="checkbox" id="exPublish" checked></label><label><span>نمایش نتیجه پس از پایان آزمون و تصحیح</span><input type="checkbox" id="exResult" checked></label><label class="wide"><span>توضیح</span><textarea id="exDescription"></textarea></label><div id="exQuestions" class="wide"></div></div>`,async()=>{
const selected=[...document.querySelectorAll('.ex-question:checked')].map(input=>({question_id:input.value,score:Number(input.closest('.v7-question-pick').querySelector('.ex-score').value)}));
if(!selected.length)throw new Error('حداقل یک سؤال انتخاب کنید.');
await V.rpc('create_school_exam',{p_exam:{title:$('#exTitle').value.trim(),description:$('#exDescription').value.trim(),class_id:V.value('exClass'),subject_id:V.value('exSubject'),teacher_id:V.value('exTeacher'),start_at:V.stamp('exStart'),end_at:V.stamp('exEnd'),duration_minutes:V.number('exDuration'),published:$('#exPublish').checked,show_result_after_submit:$('#exResult').checked},p_questions:selected});c.toast('آزمون ساخته شد.');await c.navigate('exams');});
const updateQuestions=()=>{const sub=V.value('exSubject');$('#exTeacher').innerHTML=s.assignments.filter(a=>a.class_id===V.value('exClass')&&a.subject_id===sub&&(V.manager()||a.teacher_id===s.profile.id)).map(a=>`<option value="${a.teacher_id}">${e(c.userName(a.teacher_id))}</option>`).join('');
$('#exQuestions').innerHTML='<h4>انتخاب سؤال و بارم</h4>'+questions.filter(q=>q.subject_id===sub).map(q=>`<div class="v7-question-pick"><label><input type="checkbox" class="ex-question" value="${q.id}"><span>${e(q.question_text)}</span></label><input aria-label="بارم سؤال" class="ex-score" type="number" min="0.01" step="0.01" value="${q.default_score}"></div>`).join('');};
const updateSubjects=()=>{$('#exSubject').innerHTML=V.subjects(V.value('exClass')).map(x=>`<option value="${x.id}">${e(x.title)}</option>`).join('');updateQuestions();};$('#exClass').onchange=updateSubjects;$('#exSubject').onchange=updateQuestions;updateSubjects();}
V.routes['exam-session']=async()=>{
if(!V.activeAttempt)return c.navigate('exams');const a=await V.rpc('get_exam_attempt',{p_attempt:V.activeAttempt}),live=a.status==='in_progress';
const remaining=new Date(a.deadline_at)-new Date(a.server_now),origin=performance.now();
const pending=new Set(),queues=new Map(),debounces=new Map(),dirty=new Set(),revisions=new Map();let finishing=false;
V.page(a.title,live?'پاسخ‌ها پس از تغییر به‌صورت خودکار ذخیره می‌شوند.':'پاسخ‌های ثبت‌شده و وضعیت تصحیح',`<div class="card"><div class="v7-exam-head"><span>${V.badge(a.status)}</span><strong id="examTimer" aria-live="polite"></strong>${a.total_score!==null?`<b>نمره: ${a.total_score} از ${a.max_score}</b>`:''}</div><form id="examAnswers">${a.questions.map((q,i)=>{const v=a.answers.find(x=>x.question_id===q.id)||{},key=a.keys.find(x=>x.question_id===q.id);return `<fieldset class="v7-exam-question" data-question="${q.id}"><legend>${i+1}. ${e(q.text)} (${q.score} نمره)</legend>${q.options.length?q.options.map(o=>`<label class="v7-choice"><input type="radio" name="q${q.id}" value="${o.id}" ${v.selected_option_id===o.id?'checked':''} ${live?'':'disabled'}><span>${e(o.text)}</span>${key?.correct_option_id===o.id?' <span class="badge">پاسخ صحیح</span>':''}</label>`).join(''):`<textarea maxlength="12000" ${live?'':'disabled'}>${e(v.answer_text||'')}</textarea>`}<small class="answer-state">${live?'':'پاسخ ارسال شده'}${v.awarded_score!==null&&v.awarded_score!==undefined?' · نمره '+v.awarded_score:''}</small>${v.feedback?`<p>${e(v.feedback)}</p>`:''}</fieldset>`;}).join('')}</form>${V.toolbar((live?V.button('submitExam','پایان و ارسال آزمون'):'')+V.button('backExamList','بازگشت','btn-ghost'))}</div>`);
$('#examAnswers').onsubmit=event=>event.preventDefault();
const save=field=>{
clearTimeout(debounces.get(field));debounces.delete(field);
const revision=revisions.get(field),option=field.querySelector('input:checked')?.value||null,text=field.querySelector('textarea')?.value||null,out=field.querySelector('.answer-state');
// Serialize writes per question so a slow older request cannot overwrite newer text.
const work=(queues.get(field)||Promise.resolve()).catch(()=>{}).then(async()=>{
out.textContent='در حال ذخیره…';try{await V.rpc('save_exam_answer',{p_attempt:a.id,p_question:field.dataset.question,p_option:option,p_text:text});
if(revisions.get(field)===revision){dirty.delete(field);field.dataset.failed='';out.textContent='ذخیره شد';}}
catch(error){field.dataset.failed='true';out.textContent=c.errText(error);throw error;}});
queues.set(field,work);pending.add(work);work.catch(()=>{}).finally(()=>pending.delete(work));return work;};
async function flush(){for(const field of dirty)save(field);await Promise.allSettled([...pending]);if(dirty.size)throw new Error('بعضی پاسخ‌ها ذخیره نشده‌اند؛ اتصال را بررسی و دوباره تلاش کنید.');}
if(live)document.querySelectorAll('#examAnswers input,#examAnswers textarea').forEach(input=>{
const changed=()=>{if(finishing)return;const field=input.closest('fieldset');dirty.add(field);revisions.set(field,(revisions.get(field)||0)+1);field.querySelector('.answer-state').textContent='در انتظار ذخیره…';clearTimeout(debounces.get(field));
if(input.tagName==='TEXTAREA')debounces.set(field,setTimeout(()=>save(field),250));else save(field);};
if(input.tagName==='TEXTAREA'){input.oninput=changed;input.onchange=()=>{if(dirty.has(input.closest('fieldset')))save(input.closest('fieldset'));};}else input.onchange=changed;});
const warn=event=>{if(dirty.size||pending.size){event.preventDefault();event.returnValue='';}};
if(live){V.beforeLeave=flush;window.addEventListener('beforeunload',warn);V.cleanupTasks.push(()=>{for(const timer of debounces.values())clearTimeout(timer);window.removeEventListener('beforeunload',warn);});}
async function finish(auto=false){if(finishing)return;finishing=true;$('#submitExam').disabled=true;
document.querySelectorAll('#examAnswers input,#examAnswers textarea').forEach(input=>input.disabled=true);
try{if(auto||remaining-(performance.now()-origin)<=0){try{await flush();}catch{/* Server will submit only the answers received before the deadline. */}}else await flush();
await V.rpc('submit_exam',{p_attempt:a.id});V.beforeLeave=null;c.toast(auto?'زمان آزمون پایان یافت؛ پاسخ‌های ذخیره‌شده ارسال شدند.':'آزمون ارسال شد.');await c.navigate('exam-session');}
catch(error){finishing=false;document.querySelectorAll('#examAnswers input,#examAnswers textarea').forEach(input=>input.disabled=false);throw error;}}
const tick=()=>{const left=Math.max(0,remaining-(performance.now()-origin));$('#examTimer').textContent=live?c.toFaDigits(Math.floor(left/60000)+':'+String(Math.floor(left/1000)%60).padStart(2,'0')):'';
if(live&&left===0){clearInterval(V.timer);V.timer=null;finish(true).catch(err=>{c.toast(c.errText(err),true);$('#submitExam').disabled=false;});}};
if(live)V.timer=setInterval(tick,1000);tick();V.bind('#submitExam',()=>finish(false));V.bind('#backExamList',()=>c.navigate('exams'));};
V.routes['exam-grading']=async()=>{
if(!V.staff()||!V.gradingExam)throw new Error('ACCESS_DENIED');
let page=0;
V.page('تصحیح آزمون','انتخاب دانش‌آموز و ثبت بارم پاسخ‌های تشریحی',`<div class="card">${V.select('gradeAttempt','دانش‌آموز',[])}<div id="attemptPager"></div>${V.toolbar(V.button('loadAttempt','نمایش پاسخ‌ها')+V.button('returnExams','آزمون‌ها','btn-ghost'))}<div id="gradeAnswers"></div></div>`);
async function draw(){const {data,error,count}=await s.sb.from('exam_attempts').select('*',{count:'exact'}).eq('exam_id',V.gradingExam).order('started_at').range(page*50,page*50+49);if(error)throw error;
$('#gradeAttempt').innerHTML=data.map(a=>`<option value="${a.id}">${e(c.userName(a.student_id)+' · '+V.label(a.status))}</option>`).join('');$('#gradeAnswers').replaceChildren();$('#loadAttempt').disabled=!data.length;
$('#attemptPager').innerHTML=V.pager(page,count||0);$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*50>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#returnExams',()=>c.navigate('exams'));V.bind('#loadAttempt',async()=>{
const a=await V.rpc('get_exam_attempt',{p_attempt:V.value('gradeAttempt')});$('#gradeAnswers').innerHTML=a.questions.map(q=>{const v=a.answers.find(x=>x.question_id===q.id)||{},manual=['essay','short_answer'].includes(q.type);return `<div class="v7-exam-question"><h4>${e(q.text)}</h4><p>${e(v.answer_text||q.options.find(o=>o.id===v.selected_option_id)?.text||'بدون پاسخ')}</p>${manual&&a.status!=='in_progress'?`<div class="form-grid">${V.field('mark'+q.id,'نمره از '+q.score,'number',v.awarded_score??0)}${V.field('feedback'+q.id,'بازخورد','text',v.feedback||'',false)}</div><button class="btn btn-primary grade-answer" data-id="${q.id}">ثبت نمره</button>`:`<span class="badge">نمره: ${v.awarded_score??'در انتظار'}</span>`}</div>`;}).join('');
V.bind('.grade-answer',async b=>{await V.rpc('grade_exam_answer',{p_attempt:a.id,p_question:b.dataset.id,p_score:V.number('mark'+b.dataset.id),p_feedback:$('#feedback'+b.dataset.id).value.trim()});c.toast('نمره ثبت شد.');});});await draw();};
})();
