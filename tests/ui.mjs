import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {database} from './database-setup.mjs';
import {seed,migrate,ids,asUser,rpc} from './fixtures.mjs';
import {adapter} from './adapter.mjs';
const db=await database();await seed(db);await migrate(db);const query=adapter(db);let checks=0;
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const errors=[],sessions=[];
async function session(user){
const console=new VirtualConsole();console.on('jsdomError',error=>{if(!error.message.includes('Not implemented'))errors.push(error.message);});
const dom=new JSDOM(await readFile('index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/index.html',virtualConsole:console});
sessions.push(dom);
const w=dom.window;w.__TEST_USER=ids[user];w.fetch=async(url,options)=>({json:async()=>{try{return await query(JSON.parse(options.body));}catch(error){return {data:null,error:{message:error.message,code:error.code}};}}});
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
Object.defineProperty(w.document,'fonts',{value:{ready:Promise.resolve()}});w.print=()=>{};
await w.eval(await readFile('tests/mock-supabase.js','utf8'));
for(const file of ['config.js','app.js','js/core.js','js/auth.js','js/timetable.js','js/attendance.js','js/exams.js','js/calendar.js','js/notifications.js','js/forms.js','js/polls.js','js/extracurricular.js','js/appointments.js','js/behavior.js','js/search.js','js/dashboard.js','js/reports.js','js/student-profile.js','js/admin.js'])w.eval(await readFile(file,'utf8'));
await w.SystemCore.init();await pause();return dom;}
async function route(dom,name){await dom.window.SystemCore.navigate(name);await pause();assert.equal(dom.window.document.querySelectorAll('#content .alert-warning').length,0,'Failed route '+name+': '+dom.window.document.querySelector('#content').textContent);checks++;}
try{
const manager=await session('manager');
for(const name of ['users','structure','assignments','scores','homeworkGrades','excel','announcements','settings','timetable','attendance','exams','question-bank','calendar','notifications','student-profile','behavior','forms','polls','extracurricular','appointments','reports','search','security','audit'])await route(manager,name);
await route(manager,'forms');let doc=manager.window.document;await doc.querySelector('#newForm').onclick({target:doc.querySelector('#newForm')});assert.equal(doc.querySelector('#modal').open,true);
doc.querySelector('#fTitle').value='فرم یکپارچه UI';doc.querySelector('.field-label').value='نام تیم';await doc.querySelector('#modalSubmit').onclick();await pause();assert.equal(doc.querySelector('#modal').open,false);assert.match(doc.querySelector('#formList').textContent,/فرم یکپارچه UI/);checks++;
manager.window.SchoolV7.focusStudent=ids.student;await route(manager,'student-profile');await doc.querySelector('#profileReport').onclick({});await pause();assert.match(doc.querySelector('#content').textContent,/۱۷.۵۰/);checks++;
assert.equal(doc.querySelector('#mainNav').textContent.includes('تکالیف'),true);manager.window.SchoolV7.cleanup();manager.window.close();
const teacher=await session('teacher');for(const name of ['dashboard','scores','homework','groups','announcements','objections','timetable','attendance','exams','question-bank','calendar','notifications','student-profile','behavior','forms','polls','extracurricular','appointments','reports','search','security'])await route(teacher,name);teacher.window.SchoolV7.cleanup();teacher.window.close();
await asUser(db,ids.teacher,async()=>{const question=await rpc(db,'save_bank_question',{p_question:{subject_id:ids.subject,question_type:'essay',question_text:'پاسخ خود را بنویسید.',default_score:20},p_options:[]});await rpc(db,'create_school_exam',{p_exam:{class_id:ids.class,subject_id:ids.subject,teacher_id:ids.teacher,title:'آزمون ذخیره خودکار',start_at:new Date(Date.now()-60000).toISOString(),end_at:new Date(Date.now()+3600000).toISOString(),duration_minutes:30,published:true},p_questions:[{question_id:question,score:20}]});});
const student=await session('student');for(const name of ['report','homework','groups','announcements','teachers','objections','timetable','attendance','exams','calendar','notifications','student-profile','behavior','forms','polls','extracurricular','appointments','reports','search','security'])await route(student,name);
assert.equal(student.window.document.querySelector('#mainNav').textContent.includes('امنیت حساب'),true);
await route(student,'exams');let studentDoc=student.window.document;await studentDoc.querySelector('.start-exam').onclick({});await pause();const text=studentDoc.querySelector('#examAnswers textarea');
text.value='پاسخ هنگام تایپ';text.dispatchEvent(new student.window.Event('input'));await new Promise(resolve=>setTimeout(resolve,350));assert.equal((await db.query('select answer_text from exam_answers order by updated_at desc limit 1')).rows[0].answer_text,'پاسخ هنگام تایپ');checks++;
text.value='پاسخ نهایی بدون خروج از فیلد';text.dispatchEvent(new student.window.Event('input'));await studentDoc.querySelector('#submitExam').onclick({});await pause();assert.equal((await db.query('select answer_text from exam_answers order by updated_at desc limit 1')).rows[0].answer_text,'پاسخ نهایی بدون خروج از فیلد');assert.equal(studentDoc.querySelector('#examAnswers textarea').disabled,true);checks++;
student.window.SchoolV7.cleanup();student.window.close();
const initial=await session('initial');assert.equal(initial.window.document.querySelector('#passwordView').classList.contains('hidden'),false);assert.equal(initial.window.document.querySelector('#appView').classList.contains('hidden'),true);checks++;initial.window.SchoolV7.cleanup();initial.window.close();
assert.deepEqual(errors,[]);console.log(`UI integration tests: ${checks} passed using the real PostgreSQL test database and a DOM environment.`);
}catch(error){console.error('UI integration failed:',error.message,errors);process.exitCode=1;}finally{for(const dom of sessions){dom.window.SchoolV7?.cleanup();dom.window.close();}await db.close();}
