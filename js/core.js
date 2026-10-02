(() => {
'use strict';
const c=window.SystemCore,{state:s,$,esc:e}=c;
const V=window.SchoolV7={routes:{},focusStudent:null,timer:null,cleanupTasks:[]};
V.labels={present:'حاضر',absent:'غایب',excused:'غیبت موجه',unexcused:'غیبت غیرموجه',late:'تأخیر',early_departure:'خروج زودهنگام',
pending:'در انتظار',approved:'تأییدشده',rejected:'ردشده',cancelled:'لغوشده',completed:'انجام‌شده',in_progress:'در حال پاسخ',submitted:'ارسال‌شده',graded:'تصحیح‌شده',
positive:'مثبت',negative:'منفی',neutral:'خنثی',multiple_choice:'چهارگزینه‌ای',true_false:'صحیح و غلط',short_answer:'پاسخ کوتاه',essay:'تشریحی',
exam:'آزمون',holiday:'تعطیلی',parents_meeting:'جلسه اولیا',trip:'اردو',competition:'مسابقه',cultural:'فرهنگی',school_meeting:'جلسه مدرسه',deadline:'مهلت مهم',other:'سایر',
short_text:'متن کوتاه',long_text:'متن بلند',number:'عدد',date:'تاریخ',time:'ساعت',single_choice:'انتخاب تکی',multiple_choice_field:'انتخاب چندگانه',boolean:'بله / خیر',
student:'دانش‌آموز',teacher:'دبیر',class:'کلاس',grade:'پایه',subject:'درس',homework:'تکلیف',announcement:'اطلاعیه',form:'فرم',extracurricular:'فوق‌برنامه',appointment:'ملاقات'};
V.label=x=>V.labels[x]||x||'—';
V.manager=()=>s.profile?.role==='manager'; V.staff=()=>['manager','teacher'].includes(s.profile?.role);
V.query=async q=>{const {data,error}=await q;if(error)throw error;return data||[];};
V.rpc=(name,args={})=>V.query(s.sb.rpc(name,args));
V.page=(title,subtitle,html)=>{c.setPage(title,subtitle);$('#content').innerHTML=html;};
V.field=(id,title,type='text',value='',required=true)=>`<label><span>${e(title)}</span><input id="${id}" type="${type}" value="${e(value)}" ${required?'required':''}></label>`;
V.select=(id,title,rows,value='',empty=false)=>`<label><span>${e(title)}</span><select id="${id}">${empty?'<option value="">همه / انتخاب نشده</option>':''}${rows.map(r=>`<option value="${e(r.id)}" ${String(r.id)===String(value)?'selected':''}>${e(r.title)}</option>`).join('')}</select></label>`;
V.options=obj=>Object.entries(obj).map(([id,title])=>({id,title}));
V.value=id=>c.toEnDigits($('#'+id)?.value||'').trim();
V.number=id=>Number(V.value(id));
V.date=(x)=>x?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeZone:'Asia/Tehran'}).format(new Date(x)):'—';
V.datetime=x=>x?new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(x)):'—';
V.today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
V.shamsi=(x=new Date())=>{
const parts=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'}).formatToParts(new Date(x));
return ['year','month','day'].map(t=>parts.find(p=>p.type===t).value).join('/');};
V.gregorian=text=>{
const [y,m,d]=c.toEnDigits(text).split(/[/-]/).map(Number);
if(!y||m<1||m>12||d<1||d>31)throw new Error('تاریخ شمسی را به صورت سال/ماه/روز وارد کنید.');
const target=y*10000+m*100+d;let lo=Math.floor(Date.UTC(y+621,0,1)/86400000),hi=Math.floor(Date.UTC(y+622,11,31)/86400000);
while(lo<=hi){const mid=Math.floor((lo+hi)/2),day=new Date(mid*86400000+43200000),parts=V.shamsi(day).split('/').map(Number),v=parts[0]*10000+parts[1]*100+parts[2];
if(v===target)return day.toISOString().slice(0,10);if(v<target)lo=mid+1;else hi=mid-1;}
throw new Error('تاریخ شمسی معتبر نیست.');};
V.dateField=(id,title,value=new Date(),withTime=false)=>`<label><span>${e(title)} (شمسی)</span><input id="${id}" value="${e(V.shamsi(value))}" placeholder="۱۴۰۵/۰۷/۱۰" required inputmode="numeric"></label>${withTime?V.field(id+'Time','ساعت (تهران)','text',new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Tehran'}).format(new Date(value))):''}`;
V.stamp=id=>{const time=V.value(id+'Time');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new Error('ساعت را به صورت ۰۸:۳۰ وارد کنید.');return V.gregorian(V.value(id))+'T'+time+':00+03:30';};
V.classes=()=>s.classes.filter(x=>V.manager()||s.assignments.some(a=>a.class_id===x.id&&a.teacher_id===s.profile.id)||s.classStudents.some(a=>a.class_id===x.id&&a.student_id===s.profile.id));
V.classOptions=()=>V.classes().map(x=>({id:x.id,title:c.className(x.id)}));
V.subjects=classId=>s.subjects.filter(x=>V.manager()?x.grade_id===c.byId(s.classes,classId)?.grade_id:s.assignments.some(a=>a.class_id===classId&&a.subject_id===x.id&&a.teacher_id===s.profile.id));
V.students=classId=>s.profiles.filter(x=>x.role==='student'&&s.classStudents.some(a=>a.class_id===classId&&a.student_id===x.id));
V.personOptions=role=>s.profiles.filter(x=>!role||x.role===role).map(x=>({id:x.id,title:x.full_name}));
V.bind=(selector,fn)=>document.querySelectorAll(selector).forEach(b=>b.onclick=async event=>{
if(b.disabled)return;b.disabled=true;try{await fn(b,event);}catch(error){c.toast(c.errText(error),true);}finally{if(b.isConnected)b.disabled=false;}});
V.badge=x=>`<span class="badge ${['absent','unexcused','negative','rejected'].includes(x)?'warn':''}">${e(V.label(x))}</span>`;
V.toolbar=(buttons='')=>`<div class="v7-toolbar no-print">${buttons}</div>`;
V.button=(id,title,cls='btn-primary')=>`<button type="button" class="btn ${cls}" id="${id}">${e(title)}</button>`;
V.pager=(page,total,size=50,prefix='')=>`<div class="v7-pager no-print">${V.button(prefix+'prevPage','قبلی','btn-ghost')}<span>صفحه ${page+1} · ${total} مورد</span>${V.button(prefix+'nextPage','بعدی','btn-ghost')}</div>`;
V.audience=()=>V.select('targetType','مخاطب',V.options({all:'همه',role:'یک نقش',grade:'یک پایه',class:'یک کلاس',user:'یک کاربر'}))+
V.select('targetRole','نقش',V.options({student:'دانش‌آموز',teacher:'دبیر',manager:'مدیر'}))+
V.select('targetGrade','پایه',s.grades)+V.select('targetClass','کلاس',V.classOptions())+V.select('targetUser','کاربر',V.personOptions());
V.audienceValue=()=>{const t=V.value('targetType');return {target_type:t,target_role:t==='role'?V.value('targetRole'):null,
target_grade_id:t==='grade'?V.value('targetGrade'):null,target_class_id:t==='class'?V.value('targetClass'):null,target_user_id:t==='user'?V.value('targetUser'):null};};
V.leave=()=>{V.beforeLeave=null;clearInterval(V.timer);V.timer=null;V.cleanupTasks.splice(0).forEach(f=>f());};
V.cleanup=()=>{V.leave();clearInterval(V.notificationTimer);V.focusStudent=null;V.reportClass=null;V.reportStudent=null;$('#searchResults')?.replaceChildren();};
V.menu=()=>{
const common=[['timetable','برنامه هفتگی'],['attendance','حضور و غیاب'],['exams','آزمون‌ها'],['calendar','تقویم آموزشی'],['notifications','اعلان‌ها'],
['student-profile',V.staff()?'پرونده دانش‌آموز':'پرونده من'],['behavior','رفتار و تشویق'],['forms','فرم‌ها'],['polls','نظرسنجی‌ها'],['extracurricular','فوق‌برنامه'],['appointments','ملاقات‌ها'],['reports','گزارش‌ها'],['search','جست‌وجو'],['security','امنیت حساب']];
if(V.manager())common.push(['audit','گزارش تغییرات']);return common;};
})();
