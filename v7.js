(function(){
"use strict";

var A=null;
var routes=new Set([
  "attendance","timetable","exams","calendar","notifications","reports","studentProfile",
  "behavior","forms","polls","extracurricular","appointments","audit","security"
]);
var attendanceLabels={present:"حاضر",absent:"غایب",excused:"غیبت موجه",unexcused:"غیبت غیرموجه",late:"تأخیر",early_leave:"خروج زودهنگام"};
var weekdays=["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه"];
var eventLabels={exam:"امتحان",holiday:"تعطیلی",parent_meeting:"جلسه اولیا",trip:"اردو",competition:"مسابقه",cultural:"فرهنگی",school_meeting:"جلسه مدرسه",deadline:"مهلت مهم",other:"سایر"};
var typeLabels={positive:"مثبت",negative:"منفی",neutral:"خنثی"};
var formTypeLabels={short_text:"متن کوتاه",long_text:"متن بلند",number:"عدد",date:"تاریخ",time:"ساعت",single_choice:"انتخاب تکی",multi_choice:"انتخاب چندگانه",yes_no:"بله/خیر"};
var examTypeLabels={multiple_choice:"چهارگزینه‌ای",true_false:"صحیح/غلط",short_answer:"پاسخ کوتاه",essay:"تشریحی"};
var notifTimer=null;

function bind(app){A=app}
function hasRoute(r){return routes.has(r)}
function menuFor(role){
  if(role==="manager") return [
    ["attendance","حضور و غیاب"],["timetable","برنامه هفتگی"],["exams","آزمون‌ها"],["calendar","تقویم"],
    ["notifications","اعلان‌ها"],["reports","گزارش‌ها"],["studentProfile","پرونده دانش‌آموز"],
    ["behavior","رفتار و تشویق"],["forms","فرم‌ساز"],["polls","نظرسنجی"],["extracurricular","فوق‌برنامه"],
    ["appointments","ملاقات‌ها"],["audit","گزارش فعالیت"],["security","امنیت حساب"]
  ];
  if(role==="teacher") return [
    ["attendance","حضور و غیاب"],["timetable","برنامه هفتگی"],["exams","آزمون‌ها"],["calendar","تقویم"],
    ["notifications","اعلان‌ها"],["studentProfile","پرونده دانش‌آموز"],["behavior","رفتار و تشویق"],
    ["forms","فرم‌ها"],["polls","نظرسنجی"],["extracurricular","فوق‌برنامه"],["appointments","ملاقات‌ها"],["security","امنیت حساب"]
  ];
  return [
    ["attendance","حضور و غیاب"],["timetable","برنامه هفتگی"],["exams","آزمون‌ها"],["calendar","تقویم"],
    ["notifications","اعلان‌ها"],["forms","فرم‌ها"],["polls","نظرسنجی"],["extracurricular","فوق‌برنامه"],
    ["appointments","ملاقات‌ها"],["security","امنیت حساب"]
  ];
}
function q(s){return document.querySelector(s)}
function qa(s){return Array.from(document.querySelectorAll(s))}
function esc(v){return A.esc(v)}
function fa(v){return A.toFaDigits(v==null?"":v)}
function en(v){return A.toEnDigits(v==null?"":v)}
function dt(v){return v?new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"-"}
function d(v){return v?new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"medium"}).format(new Date(v)):"-"}
function iso(v){if(!v)return null; var x=new Date(v); return Number.isNaN(x.getTime())?null:x.toISOString()}
function localInput(v){var x=v?new Date(v):new Date(); var z=new Date(x.getTime()-x.getTimezoneOffset()*60000); return z.toISOString().slice(0,16)}
function role(){return A.state.profile.role}
function isManager(){return role()==="manager"}
function isTeacher(){return role()==="teacher"}
function isStudent(){return role()==="student"}
function opt(list,getValue,getText,selected){
  return (list||[]).map(function(x){var v=getValue(x),t=getText(x);return '<option value="'+esc(v)+'" '+(String(v)===String(selected)?"selected":"")+'>'+esc(t)+'</option>'}).join("")
}
function card(title,body,actions){
  return '<section class="card v7-card"><div class="panel-head"><div><h3>'+esc(title)+'</h3></div>'+(actions||"")+'</div>'+body+'</section>'
}
function badge(text,cls){return '<span class="badge '+(cls||"")+'">'+esc(text)+'</span>'}
function empty(text){return '<div class="empty">'+esc(text||"اطلاعاتی ثبت نشده است.")+'</div>'}
function err(e){
  var m=e&&e.message?e.message:String(e||"خطا");
  var map={
    ACCESS_DENIED:"دسترسی مجاز نیست.",CLASS_NOT_AVAILABLE:"این کلاس در دسترس نیست.",REGISTRATION_NOT_STARTED:"ثبت‌نام هنوز شروع نشده است.",
    REGISTRATION_CLOSED:"مهلت ثبت‌نام پایان یافته است.",CLASS_FULL:"ظرفیت کلاس تکمیل شده است.",SLOT_NOT_AVAILABLE:"این زمان قابل رزرو نیست.",
    SLOT_FULL:"ظرفیت این زمان تکمیل شده است.",APPOINTMENT_OVERLAP:"در این بازه زمانی ملاقات دیگری دارید.",ALREADY_VOTED:"شما قبلاً در این نظرسنجی رأی داده‌اید.",
    POLL_NOT_STARTED:"نظرسنجی هنوز شروع نشده است.",POLL_CLOSED:"نظرسنجی پایان یافته است.",RESULTS_HIDDEN:"نتایج این نظرسنجی هنوز قابل مشاهده نیست.",
    EXAM_NOT_STARTED:"آزمون هنوز شروع نشده است.",EXAM_ENDED:"زمان آزمون پایان یافته است.",EXAM_CLOSED:"این آزمون بسته شده است.",
    INVALID_OPTION:"گزینه انتخاب‌شده معتبر نیست.",INVALID_QUESTION:"سؤال معتبر نیست."
  };
  Object.keys(map).some(function(k){if(m.indexOf(k)>=0){m=map[k];return true}return false});
  return A.errText?A.errText({message:m}):m
}
async function run(fn){
  try{return await fn()}catch(e){A.toast(err(e),true);throw e}
}
function targetFields(prefix,includeUser){
  prefix=prefix||"v7";
  return '<label><span>مخاطب</span><select id="'+prefix+'Target"><option value="all">همه</option><option value="role">نقش</option><option value="grade">پایه</option><option value="class">کلاس</option>'+(includeUser?'<option value="user">یک کاربر</option>':"")+'</select></label>'+
    '<label><span>نقش</span><select id="'+prefix+'Role"><option value="student">دانش‌آموز</option><option value="teacher">دبیر</option></select></label>'+
    '<label><span>پایه</span><select id="'+prefix+'Grade"><option value="">-</option>'+opt(A.state.grades,function(x){return x.id},function(x){return x.title})+'</select></label>'+
    '<label><span>کلاس</span><select id="'+prefix+'Class"><option value="">-</option>'+opt(A.state.classes,function(x){return x.id},function(x){return A.className(x.id)})+'</select></label>'+
    (includeUser?'<label class="wide"><span>کاربر</span><select id="'+prefix+'User"><option value="">-</option>'+opt(A.state.profiles,function(x){return x.id},function(x){return x.full_name+" - "+(x.role==="teacher"?"دبیر":x.role==="student"?"دانش‌آموز":"مدیر")})+'</select></label>':"")
}
function targetPayload(prefix){
  prefix=prefix||"v7";
  var t=q("#"+prefix+"Target").value;
  return {
    target_type:t,
    target_role:t==="role"?q("#"+prefix+"Role").value:null,
    target_grade_id:t==="grade"?(q("#"+prefix+"Grade").value||null):null,
    target_class_id:t==="class"?(q("#"+prefix+"Class").value||null):null,
    target_user_id:t==="user"?(q("#"+prefix+"User").value||null):null
  }
}

async function afterEnter(){
  if(!A||!A.state.profile)return;
  enhanceTopbar();
  if(A.state.profile.must_change_password)return;
  try{await A.state.sb.rpc("refresh_due_notifications")}catch(_){}
  await refreshNotificationBadge();
}
function enhanceTopbar(){
  if(q("#v7Tools"))return;
  var meta=q(".topbar-meta");
  if(!meta)return;
  var wrap=document.createElement("div");
  wrap.id="v7Tools";wrap.className="v7-top-tools";
  wrap.innerHTML='<div class="v7-search-wrap"><button id="v7SearchBtn" class="icon-btn" type="button" title="جست‌وجوی سراسری">⌕</button><div id="v7SearchBox" class="v7-search-box hidden"><input id="v7SearchInput" placeholder="جست‌وجوی دانش‌آموز، کلاس، تکلیف، آزمون…"><div id="v7SearchResults"></div></div></div>'+
    '<button id="v7Bell" class="icon-btn v7-bell" type="button" title="اعلان‌ها">♢<span id="v7BellCount" class="hidden">0</span></button>';
  meta.insertBefore(wrap,meta.firstChild);
  q("#v7Bell").onclick=function(){A.navigate("notifications")};
  q("#v7SearchBtn").onclick=function(){q("#v7SearchBox").classList.toggle("hidden");if(!q("#v7SearchBox").classList.contains("hidden"))q("#v7SearchInput").focus()};
  q("#v7SearchInput").oninput=function(){
    clearTimeout(notifTimer);
    var value=this.value.trim();
    notifTimer=setTimeout(function(){searchGlobal(value)},320);
  };
}
async function searchGlobal(value){
  var out=q("#v7SearchResults");if(!out)return;
  if(value.length<2){out.innerHTML="";return}
  out.innerHTML='<div class="v7-search-loading">در حال جست‌وجو…</div>';
  var res=await A.state.sb.rpc("global_search",{p_query:value});
  if(res.error){out.innerHTML='<div class="v7-search-loading">خطا در جست‌وجو</div>';return}
  var rows=res.data||[];
  out.innerHTML=rows.length?rows.map(function(x){
    return '<button class="v7-search-item" data-route="'+esc(x.route)+'" data-id="'+esc(x.id)+'"><b>'+esc(x.title)+'</b><small>'+esc(x.subtitle||x.category)+'</small></button>'
  }).join(""):empty("نتیجه‌ای پیدا نشد.");
  qa(".v7-search-item").forEach(function(b){b.onclick=function(){
    if(b.dataset.route==="studentProfile") sessionStorage.setItem("v7-student-profile",b.dataset.id);
    q("#v7SearchBox").classList.add("hidden");A.navigate(b.dataset.route);
  }})
}
async function refreshNotificationBadge(){
  if(!q("#v7BellCount"))return;
  var r=await A.state.sb.from("notifications").select("id",{count:"exact",head:true}).eq("user_id",A.state.profile.id).is("read_at",null);
  var n=r.count||0;q("#v7BellCount").textContent=fa(n);q("#v7BellCount").classList.toggle("hidden",!n)
}

async function forcePasswordChange(){
  if(!A)return;
  A.setPage("تغییر رمز اولیه","برای ادامه استفاده از سامانه، رمز اولیه را تغییر دهید.");
  q("#mainNav").innerHTML="";
  q("#content").innerHTML=card("امنیت حساب",
    '<div class="alert alert-warning">به دلیل استفاده از رمز اولیه، قبل از ورود به سایر بخش‌ها یک رمز جدید انتخاب کنید.</div>'+
    '<form id="v7InitialPassword" class="form-grid v7-narrow">'+
    '<label class="wide"><span>رمز جدید</span><input id="v7NewPassword" type="password" minlength="8" autocomplete="new-password" required></label>'+
    '<label class="wide"><span>تکرار رمز جدید</span><input id="v7NewPassword2" type="password" minlength="8" autocomplete="new-password" required></label>'+
    '<button class="btn btn-primary wide" type="submit">تغییر رمز و ادامه</button></form>');
  q("#v7InitialPassword").onsubmit=async function(e){
    e.preventDefault();
    var p=q("#v7NewPassword").value,p2=q("#v7NewPassword2").value;
    if(p.length<8)return A.toast("رمز جدید باید حداقل ۸ کاراکتر باشد.",true);
    if(p!==p2)return A.toast("تکرار رمز با رمز جدید یکسان نیست.",true);
    var b=e.submitter;b.disabled=true;
    try{
      var u=await A.state.sb.auth.updateUser({password:p});if(u.error)throw u.error;
      var r=await A.state.sb.rpc("complete_initial_password_change");if(r.error)throw r.error;
      A.state.profile.must_change_password=false;
      A.toast("رمز عبور با موفقیت تغییر کرد.");
      await A.refreshRefs(true);A.buildNav();await afterEnter();A.navigate("dashboard");
    }catch(x){A.toast(err(x),true);b.disabled=false}
  };
}

async function navigate(route){
  if(!A)return;
  if(A.state.profile.must_change_password)return forcePasswordChange();
  if(route==="attendance")return renderAttendance();
  if(route==="timetable")return renderTimetable();
  if(route==="exams")return renderExams();
  if(route==="calendar")return renderCalendar();
  if(route==="notifications")return renderNotifications();
  if(route==="reports")return renderReports();
  if(route==="studentProfile")return renderStudentProfile();
  if(route==="behavior")return renderBehavior();
  if(route==="forms")return renderForms();
  if(route==="polls")return renderPolls();
  if(route==="extracurricular")return renderExtracurricular();
  if(route==="appointments")return renderAppointments();
  if(route==="audit")return renderAudit();
  if(route==="security")return renderSecurity();
}

async function renderAttendance(){
  A.setPage("حضور و غیاب","ثبت و مشاهده وضعیت حضور دانش‌آموزان");
  if(isStudent()){
    var r=await A.state.sb.from("attendance_records").select("*").eq("student_id",A.state.profile.id).order("attendance_date",{ascending:false}).limit(200);
    if(r.error)throw r.error;
    var rows=r.data||[];
    var counts={present:0,absent:0,excused:0,unexcused:0,late:0,early_leave:0};
    rows.forEach(function(x){counts[x.status]=(counts[x.status]||0)+1});
    q("#content").innerHTML='<div class="stats">'+
      '<div class="stat"><span>حاضر</span><b>'+fa(counts.present)+'</b></div>'+
      '<div class="stat"><span>غیبت</span><b>'+fa(counts.absent+counts.excused+counts.unexcused)+'</b></div>'+
      '<div class="stat"><span>غیبت غیرموجه</span><b>'+fa(counts.unexcused)+'</b></div>'+
      '<div class="stat"><span>تأخیر</span><b>'+fa(counts.late)+'</b></div></div>'+
      card("سوابق",A.table(["تاریخ","کلاس","درس","وضعیت","دقیقه","توضیح"],rows.map(function(x){
        return '<tr><td>'+d(x.attendance_date)+'</td><td>'+esc(A.className(x.class_id))+'</td><td>'+esc(x.subject_id?A.subjectName(x.subject_id):"-")+'</td><td>'+badge(attendanceLabels[x.status]||x.status,x.status==="present"?"":"warn")+'</td><td>'+fa(x.delay_minutes||0)+'</td><td>'+esc(x.note||"-")+'</td></tr>'
      })));
    return;
  }
  var teaching=isManager()?A.state.classes:A.state.classes.filter(function(c){return A.state.assignments.some(function(a){return a.teacher_id===A.state.profile.id&&a.class_id===c.id})});
  q("#content").innerHTML=card("ثبت حضور",
    '<div class="form-grid v7-toolbar"><label><span>کلاس</span><select id="attClass">'+opt(teaching,function(x){return x.id},function(x){return A.className(x.id)})+'</select></label>'+
    '<label><span>درس</span><select id="attSubject"></select></label><label><span>تاریخ</span><input id="attDate" type="date" value="'+new Date().toISOString().slice(0,10)+'"></label>'+
    '<label><span>زنگ/جلسه</span><select id="attSchedule"><option value="">بدون زنگ مشخص</option></select></label></div>'+
    '<div class="panel-head v7-subhead"><h3>دانش‌آموزان</h3><div class="actions"><button id="attAllPresent" class="btn btn-ghost">همه حاضر</button><button id="attSave" class="btn btn-primary">ثبت حضور و غیاب</button></div></div>'+
    '<div id="attGrid">'+empty("کلاس را انتخاب کنید.")+'</div>');
  async function load(){
    var cid=q("#attClass").value;if(!cid)return;
    var subjects=isManager()?A.state.subjects.filter(function(s){return A.state.assignments.some(function(a){return a.class_id===cid&&a.subject_id===s.id})}):A.state.subjects.filter(function(s){return A.state.assignments.some(function(a){return a.class_id===cid&&a.subject_id===s.id&&a.teacher_id===A.state.profile.id})});
    q("#attSubject").innerHTML='<option value="">بدون درس مشخص</option>'+opt(subjects,function(x){return x.id},function(x){return x.title});
    await loadSchedule();
    await loadAttendanceGrid();
  }
  async function loadSchedule(){
    var cid=q("#attClass").value,sub=q("#attSubject").value;
    var x=await A.state.sb.from("timetable_entries").select("id,weekday,period_id,school_periods(title,start_time,end_time)").eq("class_id",cid);
    if(sub)x=x.eq("subject_id",sub);
    var rr=await x;if(rr.error)return;
    q("#attSchedule").innerHTML='<option value="">بدون زنگ مشخص</option>'+(rr.data||[]).map(function(t){return '<option value="'+t.id+'">'+weekdays[t.weekday]+' - '+esc(t.school_periods&&t.school_periods.title||"زنگ")+'</option>'}).join("")
  }
  async function loadAttendanceGrid(){
    var cid=q("#attClass").value,sub=q("#attSubject").value,date=q("#attDate").value,sch=q("#attSchedule").value;
    var students=A.state.classStudents.filter(function(x){return x.class_id===cid}).map(function(x){return A.state.profiles.find(function(p){return p.id===x.student_id})}).filter(Boolean);
    var query=A.state.sb.from("attendance_records").select("*").eq("class_id",cid).eq("attendance_date",date);
    if(sub)query=query.eq("subject_id",sub);else query=query.is("subject_id",null);
    if(sch)query=query.eq("schedule_entry_id",sch);else query=query.is("schedule_entry_id",null);
    var rr=await query;if(rr.error)throw rr.error;
    var map=new Map((rr.data||[]).map(function(x){return [x.student_id,x]}));
    q("#attGrid").innerHTML=A.table(["دانش‌آموز","وضعیت","دقیقه","توضیح"],students.map(function(st){
      var old=map.get(st.id)||{};
      return '<tr data-student="'+st.id+'"><td>'+esc(st.full_name)+'</td><td><select class="att-status">'+Object.keys(attendanceLabels).map(function(k){return '<option value="'+k+'" '+((old.status||"present")===k?"selected":"")+'>'+attendanceLabels[k]+'</option>'}).join("")+'</select></td>'+
        '<td><input class="att-min" inputmode="numeric" value="'+esc(old.delay_minutes||0)+'"></td><td><input class="att-note" value="'+esc(old.note||"")+'" placeholder="اختیاری"></td></tr>'
    }),"دانش‌آموزی در کلاس ثبت نشده است.");
  }
  q("#attClass").onchange=load;q("#attSubject").onchange=function(){loadSchedule();loadAttendanceGrid()};q("#attDate").onchange=loadAttendanceGrid;q("#attSchedule").onchange=loadAttendanceGrid;
  q("#attAllPresent").onclick=function(){qa(".att-status").forEach(function(x){x.value="present"});qa(".att-min").forEach(function(x){x.value=0})};
  q("#attSave").onclick=async function(){
    var btn=this;btn.disabled=true;
    try{
      var cid=q("#attClass").value,sub=q("#attSubject").value||null,date=q("#attDate").value,sch=q("#attSchedule").value||null;
      var payload=qa("#attGrid tbody tr").map(function(tr){return {student_id:tr.dataset.student,class_id:cid,subject_id:sub,schedule_entry_id:sch,attendance_date:date,status:tr.querySelector(".att-status").value,delay_minutes:Number(en(tr.querySelector(".att-min").value)||0),note:tr.querySelector(".att-note").value.trim()||null,recorded_by:A.state.profile.id,updated_at:new Date().toISOString()}});
      var r=await A.state.sb.from("attendance_records").upsert(payload,{onConflict:"student_id,class_id,attendance_date,schedule_entry_id,subject_id"});if(r.error)throw r.error;
      A.toast("حضور و غیاب ثبت شد.");await loadAttendanceGrid()
    }catch(x){A.toast(err(x),true)}finally{btn.disabled=false}
  };
  await load();
}

async function renderTimetable(){
  A.setPage("برنامه هفتگی","زنگ‌ها و برنامه کلاس‌ها");
  var periods=await A.state.sb.from("school_periods").select("*").order("period_order");
  if(periods.error)throw periods.error;
  var entries=await A.state.sb.from("timetable_entries").select("*").order("weekday");
  if(entries.error)throw entries.error;
  var es=entries.data||[],ps=periods.data||[];
  if(!isManager()){
    if(isTeacher())es=es.filter(function(x){return x.teacher_id===A.state.profile.id});
    if(isStudent()){var cs=A.state.classStudents.filter(function(x){return x.student_id===A.state.profile.id}).map(function(x){return x.class_id});es=es.filter(function(x){return cs.indexOf(x.class_id)>=0})}
  }
  var schedule=weekdays.map(function(day,wi){
    var cells=ps.map(function(p){
      var items=es.filter(function(x){return x.weekday===wi&&x.period_id===p.id});
      return '<td>'+(items.length?items.map(function(x){return '<div class="v7-slot"><b>'+esc(A.subjectName(x.subject_id))+'</b><small>'+esc(A.className(x.class_id))+'</small><small>'+esc(A.userName(x.teacher_id))+'</small></div>'}).join(""):"-")+'</td>'
    }).join("");
    return '<tr><th>'+day+'</th>'+cells+'</tr>'
  });
  var actions=isManager()?'<div class="actions"><button class="btn btn-ghost" id="managePeriods">مدیریت زنگ‌ها</button><button class="btn btn-primary" id="addTimetable">+ برنامه جدید</button></div>':"";
  q("#content").innerHTML=card("برنامه هفتگی",'<div class="table-wrap"><table class="v7-timetable"><thead><tr><th>روز</th>'+ps.map(function(p){return '<th>'+esc(p.title)+'<small>'+fa(String(p.start_time).slice(0,5))+' - '+fa(String(p.end_time).slice(0,5))+'</small></th>'}).join("")+'</tr></thead><tbody>'+schedule.join("")+'</tbody></table></div>',actions);
  if(!isManager())return;
  q("#managePeriods").onclick=function(){
    A.modal("زنگ‌های مدرسه",'<div id="periodRows">'+ps.map(function(p){return '<div class="form-grid v7-inline-row" data-id="'+p.id+'"><input class="p-title" value="'+esc(p.title)+'"><input class="p-order" inputmode="numeric" value="'+p.period_order+'"><input class="p-start" type="time" value="'+String(p.start_time).slice(0,5)+'"><input class="p-end" type="time" value="'+String(p.end_time).slice(0,5)+'"></div>'}).join("")+'</div><button type="button" class="btn btn-ghost full" id="addPeriodRow">+ زنگ جدید</button>',async function(){
      var payload=qa("#periodRows .v7-inline-row").map(function(r,i){return {id:r.dataset.id||undefined,title:r.querySelector(".p-title").value.trim(),period_order:Number(en(r.querySelector(".p-order").value)||i+1),start_time:r.querySelector(".p-start").value,end_time:r.querySelector(".p-end").value,active:true}});
      for(var i=0;i<payload.length;i++){var x=payload[i],id=x.id;delete x.id;var rr=id?await A.state.sb.from("school_periods").update(x).eq("id",id):await A.state.sb.from("school_periods").insert(x);if(rr.error)throw rr.error}
      A.toast("زنگ‌ها ذخیره شدند.");renderTimetable()
    });
    q("#addPeriodRow").onclick=function(){var el=document.createElement("div");el.className="form-grid v7-inline-row";el.innerHTML='<input class="p-title" placeholder="عنوان زنگ"><input class="p-order" inputmode="numeric" value="'+(qa("#periodRows .v7-inline-row").length+1)+'"><input class="p-start" type="time"><input class="p-end" type="time">';q("#periodRows").appendChild(el)}
  };
  q("#addTimetable").onclick=function(){
    A.modal("افزودن برنامه",'<div class="form-grid"><label><span>کلاس</span><select id="ttClass">'+opt(A.state.classes,function(x){return x.id},function(x){return A.className(x.id)})+'</select></label>'+
      '<label><span>درس</span><select id="ttSubject">'+opt(A.state.subjects,function(x){return x.id},function(x){return x.title})+'</select></label>'+
      '<label><span>دبیر</span><select id="ttTeacher">'+opt(A.state.profiles.filter(function(x){return x.role==="teacher"}),function(x){return x.id},function(x){return x.full_name})+'</select></label>'+
      '<label><span>روز</span><select id="ttDay">'+weekdays.map(function(x,i){return '<option value="'+i+'">'+x+'</option>'}).join("")+'</select></label>'+
      '<label><span>زنگ</span><select id="ttPeriod">'+opt(ps,function(x){return x.id},function(x){return x.title})+'</select></label>'+
      '<label><span>سال تحصیلی</span><input id="ttYear" value="'+esc(A.state.classes[0]&&A.state.classes[0].academic_year||"۱۴۰۵-۱۴۰۶")+'"></label></div>',async function(){
        var p={class_id:q("#ttClass").value,subject_id:q("#ttSubject").value,teacher_id:q("#ttTeacher").value,weekday:Number(q("#ttDay").value),period_id:q("#ttPeriod").value,academic_year:q("#ttYear").value.trim()};
        var r=await A.state.sb.from("timetable_entries").insert(p);if(r.error)throw r.error;A.toast("برنامه ثبت شد.");renderTimetable()
      })
  }
}

async function renderExams(){
  A.setPage("آزمون آنلاین","بانک سؤال، برگزاری و تصحیح آزمون");
  if(isStudent())return renderStudentExams();
  var exams=await A.state.sb.from("exams").select("*").order("start_at",{ascending:false});
  if(exams.error)throw exams.error;
  var list=exams.data||[];if(isTeacher())list=list.filter(function(x){return x.teacher_id===A.state.profile.id});
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>آزمون‌ها</h3><p class="muted">زمان معتبر سرور مبنای شروع و پایان آزمون است.</p></div><div class="actions"><button class="btn btn-ghost" id="questionBank">بانک سؤال</button><button class="btn btn-primary" id="newExam">+ آزمون جدید</button></div></div>'+
    '<div class="v7-grid">'+(list.length?list.map(function(e){
      var status=Date.now()<new Date(e.start_at).getTime()?"آینده":Date.now()>new Date(e.end_at).getTime()?"پایان‌یافته":"در حال برگزاری";
      return card(e.title,'<p class="muted">'+esc(A.className(e.class_id))+' — '+esc(A.subjectName(e.subject_id))+'</p><div class="pill-row">'+badge(status,status==="در حال برگزاری"?"":"warn")+badge(e.published?"منتشرشده":"پیش‌نویس")+'</div><small>'+dt(e.start_at)+' تا '+dt(e.end_at)+'</small>',
        '<div class="actions"><button class="btn btn-ghost exam-questions" data-id="'+e.id+'">سؤالات</button><button class="btn btn-ghost exam-results" data-id="'+e.id+'">نتایج</button><button class="btn btn-ghost exam-toggle" data-id="'+e.id+'" data-p="'+e.published+'">'+(e.published?"عدم انتشار":"انتشار")+'</button></div>')
    }).join(""):empty("آزمونی ثبت نشده است."))+'</div>';
  q("#questionBank").onclick=openQuestionBank;q("#newExam").onclick=openExamModal;
  qa(".exam-toggle").forEach(function(b){b.onclick=async function(){var r=await A.state.sb.from("exams").update({published:b.dataset.p!=="true",updated_at:new Date().toISOString()}).eq("id",b.dataset.id);if(r.error)return A.toast(err(r.error),true);renderExams()}});
  qa(".exam-questions").forEach(function(b){b.onclick=function(){manageExamQuestions(b.dataset.id)}});
  qa(".exam-results").forEach(function(b){b.onclick=function(){examResults(b.dataset.id)}});
}
async function openQuestionBank(){
  var qq=A.state.sb.from("question_bank").select("*").order("created_at",{ascending:false});if(isTeacher())qq=qq.eq("teacher_id",A.state.profile.id);
  var rr=await qq;if(rr.error)return A.toast(err(rr.error),true);
  A.modal("بانک سؤال",'<div class="panel-head"><p class="muted">سؤال‌ها فقط برای دبیر صاحب سؤال و مدیر قابل مشاهده‌اند.</p><button type="button" class="btn btn-primary" id="qbAdd">+ سؤال</button></div><div class="v7-question-list">'+(rr.data||[]).map(function(x){return '<div class="v7-question"><b>'+esc(x.question_text)+'</b><small>'+examTypeLabels[x.question_type]+' — '+fa(x.default_score)+' امتیاز</small></div>'}).join("")+'</div>',async function(){q("#modal").close()},"بستن");
  q("#qbAdd").onclick=function(){openQuestionModal()}
}
function openQuestionModal(){
  var teaching=isManager()?A.state.assignments:A.state.assignments.filter(function(x){return x.teacher_id===A.state.profile.id});
  A.modal("سؤال جدید",'<div class="form-grid"><label><span>درس</span><select id="qbSubject">'+opt(A.state.subjects.filter(function(s){return teaching.some(function(a){return a.subject_id===s.id})}),function(x){return x.id},function(x){return x.title})+'</select></label>'+
    '<label><span>نوع</span><select id="qbType">'+Object.keys(examTypeLabels).map(function(k){return '<option value="'+k+'">'+examTypeLabels[k]+'</option>'}).join("")+'</select></label>'+
    '<label class="wide"><span>متن سؤال</span><textarea id="qbText"></textarea></label><label><span>امتیاز پیش‌فرض</span><input id="qbScore" inputmode="decimal" value="1"></label>'+
    '<label class="wide"><span>گزینه‌ها برای سؤال تستی</span><textarea id="qbOptions" placeholder="هر گزینه در یک خط؛ ابتدای پاسخ صحیح * بگذارید.&#10;*گزینه صحیح&#10;گزینه دیگر"></textarea></label></div>',async function(){
      var p={teacher_id:isManager()?(teaching[0]&&teaching[0].teacher_id):A.state.profile.id,subject_id:q("#qbSubject").value,question_type:q("#qbType").value,question_text:q("#qbText").value.trim(),default_score:Number(en(q("#qbScore").value)||1)};
      if(!p.question_text)throw new Error("متن سؤال الزامی است.");
      var ins=await A.state.sb.from("question_bank").insert(p).select("*").single();if(ins.error)throw ins.error;
      if(["multiple_choice","true_false"].indexOf(p.question_type)>=0){
        var lines=q("#qbOptions").value.split(/\n/).map(function(x){return x.trim()}).filter(Boolean);
        if(lines.length<2)throw new Error("برای سؤال تستی حداقل دو گزینه وارد کنید.");
        var opts=lines.map(function(x,i){var c=x.charAt(0)==="*";return {question_id:ins.data.id,option_text:c?x.slice(1).trim():x,is_correct:c,sort_order:i}});
        if(!opts.some(function(x){return x.is_correct}))throw new Error("پاسخ صحیح را با * مشخص کنید.");
        var oo=await A.state.sb.from("question_options").insert(opts);if(oo.error)throw oo.error;
      }
      A.toast("سؤال اضافه شد.")
    })
}
function openExamModal(){
  var teaching=isManager()?A.state.assignments:A.state.assignments.filter(function(x){return x.teacher_id===A.state.profile.id});
  A.modal("آزمون جدید",'<div class="form-grid"><label><span>کلاس و درس</span><select id="exCourse">'+teaching.map(function(a){return '<option value="'+a.teacher_id+'|'+a.class_id+'|'+a.subject_id+'">'+esc(A.className(a.class_id))+' — '+esc(A.subjectName(a.subject_id))+'</option>'}).join("")+'</select></label>'+
    '<label><span>عنوان</span><input id="exTitle"></label><label class="wide"><span>توضیح</span><textarea id="exDesc"></textarea></label>'+
    '<label><span>شروع</span><input id="exStart" type="datetime-local" value="'+localInput(new Date(Date.now()+3600000))+'"></label><label><span>پایان</span><input id="exEnd" type="datetime-local" value="'+localInput(new Date(Date.now()+7200000))+'"></label>'+
    '<label><span>مدت (دقیقه)</span><input id="exDuration" inputmode="numeric" value="60"></label><label><span>نمره کل</span><input id="exMax" inputmode="decimal" value="20"></label>'+
    '<label class="check-card wide"><input id="exPublished" type="checkbox"><span><b>انتشار فوری</b><small>برای دانش‌آموزان کلاس قابل مشاهده باشد.</small></span></label></div>',async function(){
      var parts=q("#exCourse").value.split("|");var p={teacher_id:parts[0],class_id:parts[1],subject_id:parts[2],title:q("#exTitle").value.trim(),description:q("#exDesc").value.trim()||null,start_at:iso(q("#exStart").value),end_at:iso(q("#exEnd").value),duration_minutes:Number(en(q("#exDuration").value)),max_score:Number(en(q("#exMax").value)),published:q("#exPublished").checked};
      var r=await A.state.sb.from("exams").insert(p);if(r.error)throw r.error;A.toast("آزمون ایجاد شد.");renderExams()
    })
}
async function manageExamQuestions(id){
  var ex=(await A.state.sb.from("exams").select("*").eq("id",id).single()).data;
  var bankq=A.state.sb.from("question_bank").select("*").eq("subject_id",ex.subject_id);if(isTeacher())bankq=bankq.eq("teacher_id",A.state.profile.id);
  var bank=await bankq;var linked=await A.state.sb.from("exam_questions").select("*").eq("exam_id",id);
  if(bank.error||linked.error)return A.toast(err(bank.error||linked.error),true);
  var lm=new Map((linked.data||[]).map(function(x){return [x.question_id,x]}));
  A.modal("سؤالات آزمون",'<div class="v7-question-list">'+(bank.data||[]).map(function(x){
    var old=lm.get(x.id);return '<label class="check-card"><input class="eq-check" type="checkbox" value="'+x.id+'" '+(old?"checked":"")+'><span><b>'+esc(x.question_text)+'</b><small>'+examTypeLabels[x.question_type]+'</small></span><input class="eq-score" data-id="'+x.id+'" inputmode="decimal" value="'+esc(old?old.score:x.default_score)+'"></label>'
  }).join("")+'</div>',async function(){
    var selected=qa(".eq-check:checked").map(function(c,i){return {exam_id:id,question_id:c.value,score:Number(en(q('.eq-score[data-id="'+c.value+'"]').value)||1),sort_order:i}});
    var del=await A.state.sb.from("exam_questions").delete().eq("exam_id",id);if(del.error)throw del.error;
    if(selected.length){var ins=await A.state.sb.from("exam_questions").insert(selected);if(ins.error)throw ins.error}
    A.toast("سؤالات آزمون ذخیره شدند.")
  })
}
async function renderStudentExams(){
  var r=await A.state.sb.from("exams").select("*").eq("published",true).order("start_at",{ascending:false});if(r.error)throw r.error;
  var now=Date.now();
  q("#content").innerHTML='<div class="v7-grid">'+(r.data||[]).map(function(e){
    var st=now<new Date(e.start_at).getTime()?"آینده":now>new Date(e.end_at).getTime()?"پایان‌یافته":"قابل شرکت";
    return card(e.title,'<p>'+esc(A.subjectName(e.subject_id))+'</p><p class="muted">'+dt(e.start_at)+' تا '+dt(e.end_at)+'</p>'+badge(st,st==="قابل شرکت"?"":"warn"),
      st==="قابل شرکت"?'<button class="btn btn-primary start-exam" data-id="'+e.id+'">شروع/ادامه آزمون</button>':"")
  }).join("")+'</div>';
  qa(".start-exam").forEach(function(b){b.onclick=async function(){var s=await A.state.sb.rpc("start_exam",{p_exam:b.dataset.id});if(s.error)return A.toast(err(s.error),true);takeExam(b.dataset.id)}})
}
async function takeExam(id){
  var r=await A.state.sb.rpc("get_exam_for_student",{p_exam:id});if(r.error)return A.toast(err(r.error),true);
  var data=r.data,qs=data.questions||[],deadline=new Date(data.attempt.deadline).getTime();
  A.setPage("آزمون: "+data.exam.title,"پاسخ‌ها به‌صورت امن در سرور ذخیره می‌شوند.");
  q("#content").innerHTML=card(data.exam.title,'<div class="v7-exam-head"><span>مهلت: '+dt(data.attempt.deadline)+'</span><strong id="examTimer"></strong></div>'+
    '<div id="examQuestions">'+qs.map(function(x,i){
      var body="";
      if(x.type==="multiple_choice"||x.type==="true_false")body='<div class="v7-options">'+(x.options||[]).map(function(o){return '<label><input type="radio" name="q'+x.id+'" value="'+o.id+'"> '+esc(o.text)+'</label>'}).join("")+'</div>';
      else body='<textarea class="exam-text" data-q="'+x.id+'" placeholder="پاسخ شما"></textarea>';
      return '<article class="v7-exam-question" data-id="'+x.id+'"><div class="panel-head"><b>سؤال '+fa(i+1)+': '+esc(x.text)+'</b><span>'+fa(x.score)+' امتیاز</span></div>'+body+'</article>'
    }).join("")+'</div><div class="actions"><button id="saveExam" class="btn btn-ghost">ذخیره پاسخ‌ها</button><button id="submitExam" class="btn btn-primary">ثبت نهایی آزمون</button></div>');
  var timer=setInterval(function(){var left=Math.max(0,deadline-Date.now()),m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);if(q("#examTimer"))q("#examTimer").textContent="زمان باقی‌مانده: "+fa(m)+":"+fa(String(s).padStart(2,"0"));if(!left){clearInterval(timer);A.toast("زمان آزمون پایان یافت.",true)}},1000);
  async function save(){
    for(var i=0;i<qs.length;i++){
      var x=qs[i],option=null,text=null;
      if(x.type==="multiple_choice"||x.type==="true_false"){var c=q('input[name="q'+x.id+'"]:checked');option=c?c.value:null}else{text=q('.exam-text[data-q="'+x.id+'"]').value}
      var rr=await A.state.sb.rpc("save_exam_answer",{p_attempt:data.attempt.id,p_question:x.id,p_option:option,p_text:text});if(rr.error)throw rr.error
    }
  }
  q("#saveExam").onclick=async function(){try{await save();A.toast("پاسخ‌ها ذخیره شدند.")}catch(x){A.toast(err(x),true)}};
  q("#submitExam").onclick=async function(){if(!confirm("آزمون ثبت نهایی شود؟"))return;try{await save();var x=await A.state.sb.rpc("submit_exam_attempt",{p_attempt:data.attempt.id});if(x.error)throw x.error;clearInterval(timer);A.toast("آزمون ثبت شد. نمره خودکار: "+fa(x.data));renderStudentExams()}catch(e){A.toast(err(e),true)}}
}
async function examResults(id){
  var attempts=await A.state.sb.from("exam_attempts").select("*").eq("exam_id",id).order("submitted_at",{ascending:false});if(attempts.error)return A.toast(err(attempts.error),true);
  A.modal("نتایج آزمون",A.table(["دانش‌آموز","وضعیت","خودکار","تشریحی","کل","عملیات"],(attempts.data||[]).map(function(a){return '<tr><td>'+esc(A.userName(a.student_id))+'</td><td>'+esc(a.status)+'</td><td>'+fa(a.auto_score)+'</td><td>'+fa(a.manual_score)+'</td><td><b>'+fa(a.total_score)+'</b></td><td><button class="btn btn-ghost grade-attempt" data-id="'+a.id+'">تصحیح</button></td></tr>'})),async function(){q("#modal").close()},"بستن");
  qa(".grade-attempt").forEach(function(b){b.onclick=function(){gradeAttempt(b.dataset.id)}})
}
async function gradeAttempt(attemptId){
  var ans=await A.state.sb.from("exam_answers").select("*,question_bank(question_text,question_type),question_options(option_text)").eq("attempt_id",attemptId);
  if(ans.error)return A.toast(err(ans.error),true);
  A.modal("تصحیح پاسخ‌ها",'<div class="v7-question-list">'+(ans.data||[]).map(function(x){var manual=["short_answer","essay"].indexOf(x.question_bank.question_type)>=0;return '<div class="v7-question"><b>'+esc(x.question_bank.question_text)+'</b><p>'+esc(x.answer_text||x.question_options&&x.question_options.option_text||"-")+'</p>'+(manual?'<label><span>نمره</span><input class="manual-score" data-id="'+x.id+'" inputmode="decimal" value="'+esc(x.awarded_score==null?"":x.awarded_score)+'"></label>':"")+'</div>'}).join("")+'</div>',async function(){
    var fields=qa(".manual-score");for(var i=0;i<fields.length;i++){var x=fields[i],rr=await A.state.sb.from("exam_answers").update({awarded_score:Number(en(x.value)||0)}).eq("id",x.dataset.id);if(rr.error)throw rr.error}
    var r=await A.state.sb.rpc("recalculate_exam_attempt",{p_attempt:attemptId});if(r.error)throw r.error;A.toast("تصحیح ذخیره شد. نمره کل: "+fa(r.data))
  })
}

async function renderCalendar(){
  A.setPage("تقویم آموزشی","رویدادها، تکالیف، آزمون‌ها، فوق‌برنامه و ملاقات‌ها");
  var from=new Date();from.setDate(1);from.setHours(0,0,0,0);var to=new Date(from);to.setMonth(to.getMonth()+1);to.setDate(0);to.setHours(23,59,59,999);
  var r=await A.state.sb.rpc("get_calendar_feed",{p_from:from.toISOString(),p_to:to.toISOString()});if(r.error)throw r.error;
  var canAdd=isManager()||isTeacher();
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>'+new Intl.DateTimeFormat("fa-IR-u-ca-persian",{month:"long",year:"numeric"}).format(new Date())+'</h3><p class="muted">نمای یکپارچه برنامه‌های آموزشی</p></div>'+(canAdd?'<button class="btn btn-primary" id="addEvent">+ رویداد</button>':"")+'</div>'+
    '<div class="v7-timeline">'+((r.data||[]).length?(r.data||[]).map(function(x){return '<article><time>'+dt(x.start_at)+'</time><div><b>'+esc(x.title)+'</b><small>'+esc(eventLabels[x.event_type]||x.event_type)+'</small></div></article>'}).join(""):empty("رویدادی در این ماه وجود ندارد."))+'</div>';
  if(q("#addEvent"))q("#addEvent").onclick=function(){
    var tf=isTeacher()?'<label class="wide"><span>کلاس</span><select id="evTeacherClass">'+opt(A.state.classes.filter(function(c){return A.state.assignments.some(function(a){return a.teacher_id===A.state.profile.id&&a.class_id===c.id})}),function(x){return x.id},function(x){return A.className(x.id)})+'</select></label>':targetFields("ev",true);
    A.modal("رویداد جدید",'<div class="form-grid"><label><span>عنوان</span><input id="evTitle"></label><label><span>نوع</span><select id="evType">'+Object.keys(eventLabels).map(function(k){return '<option value="'+k+'">'+eventLabels[k]+'</option>'}).join("")+'</select></label><label><span>شروع</span><input id="evStart" type="datetime-local" value="'+localInput(new Date())+'"></label><label><span>پایان</span><input id="evEnd" type="datetime-local"></label><label class="wide"><span>توضیح</span><textarea id="evDesc"></textarea></label>'+tf+'</div>',async function(){
      var p={title:q("#evTitle").value.trim(),description:q("#evDesc").value.trim()||null,event_type:q("#evType").value,start_at:iso(q("#evStart").value),end_at:iso(q("#evEnd").value),all_day:false,created_by:A.state.profile.id};
      if(isTeacher()){p.target_type="class";p.target_class_id=q("#evTeacherClass").value;p.target_role=null;p.target_grade_id=null;p.target_user_id=null}else Object.assign(p,targetPayload("ev"));
      var x=await A.state.sb.from("calendar_events").insert(p);if(x.error)throw x.error;A.toast("رویداد ثبت شد.");renderCalendar()
    })
  }
}

async function renderNotifications(){
  A.setPage("مرکز اعلان‌ها","پیگیری رویدادهای مهم سامانه");
  var r=await A.state.sb.from("notifications").select("*").eq("user_id",A.state.profile.id).order("created_at",{ascending:false}).limit(200);if(r.error)throw r.error;
  q("#content").innerHTML=card("اعلان‌ها",'<div class="panel-head"><p class="muted">اعلان‌های خوانده‌نشده با نقطه مشخص شده‌اند.</p><button class="btn btn-ghost" id="readAll">همه خوانده شد</button></div><div class="v7-notifications">'+((r.data||[]).length?(r.data||[]).map(function(x){return '<button class="v7-notification '+(!x.read_at?"unread":"")+'" data-id="'+x.id+'" data-route="'+esc(x.link||"")+'"><span></span><div><b>'+esc(x.title)+'</b><p>'+esc(x.body||"")+'</p><small>'+dt(x.created_at)+'</small></div></button>'}).join(""):empty("اعلانی وجود ندارد."))+'</div>');
  q("#readAll").onclick=async function(){var x=await A.state.sb.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",A.state.profile.id).is("read_at",null);if(x.error)return A.toast(err(x.error),true);renderNotifications();refreshNotificationBadge()};
  qa(".v7-notification").forEach(function(b){b.onclick=async function(){await A.state.sb.from("notifications").update({read_at:new Date().toISOString()}).eq("id",b.dataset.id);refreshNotificationBadge();if(b.dataset.route)A.navigate(b.dataset.route)}})
}

async function renderReports(){
  if(!isManager()){A.setPage("گزارش‌ها","");q("#content").innerHTML=empty("این بخش فقط برای مدیر است.");return}
  A.setPage("گزارش‌ها","فیلتر، چاپ و خروجی Excel");
  q("#content").innerHTML=card("گزارش‌ساز",'<div class="form-grid v7-toolbar"><label><span>نوع گزارش</span><select id="repType"><option value="students">دانش‌آموزان</option><option value="scores">نمرات</option><option value="attendance">حضور و غیاب</option><option value="behavior">رفتار و تشویق</option><option value="exams">آزمون‌ها</option><option value="extracurricular">فوق‌برنامه</option><option value="forms">فرم‌ها</option></select></label>'+
    '<label><span>کلاس</span><select id="repClass"><option value="">همه کلاس‌ها</option>'+opt(A.state.classes,function(x){return x.id},function(x){return A.className(x.id)})+'</select></label>'+
    '<div class="actions wide"><button id="repLoad" class="btn btn-primary">نمایش گزارش</button><button id="repExcel" class="btn btn-ghost" disabled>Excel</button><button id="repPrint" class="btn btn-ghost" disabled>چاپ/PDF</button></div></div><div id="repResult"></div>');
  var currentRows=[],currentHeaders=[];
  async function load(){
    var type=q("#repType").value,cid=q("#repClass").value;
    if(type==="students"){
      var students=A.state.profiles.filter(function(p){return p.role==="student"&&( !cid||A.state.classStudents.some(function(cs){return cs.class_id===cid&&cs.student_id===p.id}) )});
      currentHeaders=["نام","کد ملی","کلاس","وضعیت"];currentRows=students.map(function(p){var cs=A.state.classStudents.find(function(x){return x.student_id===p.id&&( !cid||x.class_id===cid)});return [p.full_name,p.national_id,cs?A.className(cs.class_id):"-",p.active?"فعال":"غیرفعال"]})
    }else{
      var tableName={scores:"scores",attendance:"attendance_records",behavior:"behavior_events",exams:"exam_attempts",extracurricular:"extracurricular_enrollments",forms:"form_submissions"}[type];
      var query=A.state.sb.from(tableName).select("*").limit(2000);if(cid&&["scores","attendance","behavior"].indexOf(type)>=0)query=query.eq("class_id",cid);
      var rr=await query;if(rr.error)throw rr.error;
      if(type==="scores"){currentHeaders=["دانش‌آموز","کلاس","درس","نوبت","تکوینی","پایانی","نمره درس"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.student_id),A.className(x.class_id),A.subjectName(x.subject_id),x.period,x.continuous_score,x.final_score,x.lesson_score]})}
      if(type==="attendance"){currentHeaders=["دانش‌آموز","کلاس","تاریخ","وضعیت","دقیقه"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.student_id),A.className(x.class_id),d(x.attendance_date),attendanceLabels[x.status],x.delay_minutes]})}
      if(type==="behavior"){currentHeaders=["دانش‌آموز","کلاس","تاریخ","عنوان","نوع","امتیاز"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.student_id),A.className(x.class_id),d(x.event_date),x.title,typeLabels[x.event_type],x.points]})}
      if(type==="exams"){currentHeaders=["دانش‌آموز","وضعیت","خودکار","تشریحی","کل"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.student_id),x.status,x.auto_score,x.manual_score,x.total_score]})}
      if(type==="extracurricular"){currentHeaders=["دانش‌آموز","کلاس","وضعیت","تاریخ"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.student_id),x.class_id,x.status,dt(x.registered_at)]})}
      if(type==="forms"){currentHeaders=["کاربر","فرم","تاریخ"];currentRows=(rr.data||[]).map(function(x){return [A.userName(x.user_id),x.form_id,dt(x.submitted_at)]})}
    }
    q("#repResult").innerHTML=A.table(currentHeaders,currentRows.map(function(row){return '<tr>'+row.map(function(c){return '<td>'+esc(c==null?"-":c)+'</td>'}).join("")+'</tr>'}));
    q("#repExcel").disabled=false;q("#repPrint").disabled=false
  }
  q("#repLoad").onclick=function(){run(load)};
  q("#repExcel").onclick=async function(){
    await A.ensureSheetJS();var data=currentRows.map(function(row){var o={};currentHeaders.forEach(function(h,i){o[h]=row[i]});return o});var wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(data);XLSX.utils.book_append_sheet(wb,ws,"گزارش");XLSX.writeFile(wb,"گزارش-سامانه.xlsx")
  };
  q("#repPrint").onclick=function(){window.print()}
}

async function renderStudentProfile(){
  A.setPage("پرونده جامع دانش‌آموز","نمرات، حضور، تکالیف، آزمون، رفتار و سوابق");
  if(isStudent()){sessionStorage.setItem("v7-student-profile",A.state.profile.id)}
  var allowed=A.state.profiles.filter(function(p){
    if(p.role!=="student")return false;if(isManager())return true;if(isStudent())return p.id===A.state.profile.id;
    return A.state.classStudents.some(function(cs){return cs.student_id===p.id&&A.state.assignments.some(function(a){return a.teacher_id===A.state.profile.id&&a.class_id===cs.class_id})})
  });
  var selected=sessionStorage.getItem("v7-student-profile")|| (allowed[0]&&allowed[0].id);
  q("#content").innerHTML=(isStudent()?"":'<div class="card"><label><span>دانش‌آموز</span><select id="profileStudent">'+opt(allowed,function(x){return x.id},function(x){return x.full_name+" - "+x.national_id},selected)+'</select></label></div>')+'<div id="studentProfileBody"></div>';
  async function load(id){
    if(!id){q("#studentProfileBody").innerHTML=empty();return}
    sessionStorage.setItem("v7-student-profile",id);var p=A.state.profiles.find(function(x){return x.id===id});
    var cls=A.state.classStudents.find(function(x){return x.student_id===id});
    var results=await Promise.all([
      A.state.sb.from("scores").select("*").eq("student_id",id),
      A.state.sb.from("attendance_records").select("*").eq("student_id",id).order("attendance_date",{ascending:false}).limit(100),
      A.state.sb.from("behavior_events").select("*").eq("student_id",id).order("event_date",{ascending:false}).limit(100),
      A.state.sb.from("exam_attempts").select("*").eq("student_id",id).order("started_at",{ascending:false}).limit(100),
      A.state.sb.from("assignment_submissions").select("*").eq("student_id",id).order("submitted_at",{ascending:false}).limit(100),
      A.state.sb.from("objections").select("*").eq("student_id",id).order("created_at",{ascending:false}).limit(100),
      A.state.sb.from("extracurricular_enrollments").select("*").eq("student_id",id).limit(100)
    ]);
    var bad=results.find(function(x){return x.error});if(bad)throw bad.error;
    var scores=results[0].data||[],att=results[1].data||[],beh=results[2].data||[],ex=results[3].data||[],subs=results[4].data||[],obj=results[5].data||[],extra=results[6].data||[];
    var vals=scores.map(function(x){return Number(x.lesson_score)}).filter(function(x){return Number.isFinite(x)});var avg=vals.length?vals.reduce(function(a,b){return a+b},0)/vals.length:null;
    q("#studentProfileBody").innerHTML='<div class="v7-profile-head card"><div class="avatar">'+esc((p.full_name||"د").charAt(0))+'</div><div><h2>'+esc(p.full_name)+'</h2><p class="muted">'+esc(p.national_id)+' — '+esc(cls?A.className(cls.class_id):"بدون کلاس")+'</p></div></div>'+
      '<div class="stats"><div class="stat"><span>معدل</span><b>'+(avg==null?"-":fa(avg.toFixed(2)))+'</b></div><div class="stat"><span>غیبت</span><b>'+fa(att.filter(function(x){return ["absent","excused","unexcused"].indexOf(x.status)>=0}).length)+'</b></div><div class="stat"><span>آزمون</span><b>'+fa(ex.length)+'</b></div><div class="stat"><span>رویداد رفتاری</span><b>'+fa(beh.length)+'</b></div></div>'+
      '<div class="v7-grid">'+card("نمرات",A.table(["درس","نوبت","نمره"],scores.map(function(x){return '<tr><td>'+esc(A.subjectName(x.subject_id))+'</td><td>'+esc(x.period)+'</td><td>'+fa(x.lesson_score==null?"-":x.lesson_score)+'</td></tr>'})))+
      card("حضور و غیاب",A.table(["تاریخ","وضعیت"],att.slice(0,20).map(function(x){return '<tr><td>'+d(x.attendance_date)+'</td><td>'+esc(attendanceLabels[x.status])+'</td></tr>'})))+
      card("رفتار",A.table(["تاریخ","عنوان","امتیاز"],beh.slice(0,20).map(function(x){return '<tr><td>'+d(x.event_date)+'</td><td>'+esc(x.title)+'</td><td>'+fa(x.points)+'</td></tr>'})))+
      card("آزمون‌ها",A.table(["وضعیت","نمره کل"],ex.map(function(x){return '<tr><td>'+esc(x.status)+'</td><td>'+fa(x.total_score)+'</td></tr>'})))+
      card("تکالیف",'<p class="muted">تعداد ارسال‌ها: <b>'+fa(subs.length)+'</b></p>')+
      card("اعتراض‌ها",'<p class="muted">تعداد اعتراض‌ها: <b>'+fa(obj.length)+'</b></p>')+
      card("فوق‌برنامه",'<p class="muted">تعداد ثبت‌نام‌ها: <b>'+fa(extra.length)+'</b></p>')+'</div>'
  }
  if(q("#profileStudent"))q("#profileStudent").onchange=function(){load(this.value)};
  await load(selected)
}

async function renderBehavior(){
  A.setPage("رفتار، تشویق و انضباط","ثبت و مشاهده رویدادهای رفتاری");
  var query=A.state.sb.from("behavior_events").select("*").order("event_date",{ascending:false}).limit(300);if(isStudent())query=query.eq("student_id",A.state.profile.id);
  var r=await query;if(r.error)throw r.error;var rows=r.data||[];
  var add=!isStudent()?'<button class="btn btn-primary" id="addBehavior">+ رویداد رفتاری</button>':"";
  q("#content").innerHTML=card("رویدادها",A.table(["دانش‌آموز","تاریخ","عنوان","نوع","امتیاز","توضیح"],rows.map(function(x){return '<tr><td>'+esc(A.userName(x.student_id))+'</td><td>'+d(x.event_date)+'</td><td>'+esc(x.title)+'</td><td>'+badge(typeLabels[x.event_type],x.event_type==="negative"?"danger":"")+'</td><td>'+fa(x.points)+'</td><td>'+esc(x.description||"-")+'</td></tr>')),add);
  if(q("#addBehavior"))q("#addBehavior").onclick=async function(){
    var cats=await A.state.sb.from("behavior_categories").select("*").eq("active",true).order("title");if(cats.error)return A.toast(err(cats.error),true);
    var allowed=A.state.profiles.filter(function(p){return p.role==="student"&&(isManager()||A.state.classStudents.some(function(cs){return cs.student_id===p.id&&A.state.assignments.some(function(a){return a.teacher_id===A.state.profile.id&&a.class_id===cs.class_id})}))});
    A.modal("ثبت رویداد رفتاری",'<div class="form-grid"><label><span>دانش‌آموز</span><select id="beStudent">'+opt(allowed,function(x){return x.id},function(x){return x.full_name})+'</select></label><label><span>دسته</span><select id="beCat">'+opt(cats.data,function(x){return x.id},function(x){return x.title})+'</select></label><label><span>نوع</span><select id="beType"><option value="positive">مثبت</option><option value="negative">منفی</option><option value="neutral">خنثی</option></select></label><label><span>امتیاز</span><input id="bePoints" inputmode="numeric" value="0"></label><label class="wide"><span>عنوان</span><input id="beTitle"></label><label class="wide"><span>توضیح</span><textarea id="beDesc"></textarea></label></div>',async function(){
      var sid=q("#beStudent").value,cs=A.state.classStudents.find(function(x){return x.student_id===sid});if(!cs)throw new Error("کلاس دانش‌آموز مشخص نیست.");
      var p={student_id:sid,class_id:cs.class_id,event_date:new Date().toISOString().slice(0,10),category_id:q("#beCat").value,event_type:q("#beType").value,title:q("#beTitle").value.trim(),description:q("#beDesc").value.trim()||null,points:Number(en(q("#bePoints").value)||0),recorded_by:A.state.profile.id};
      var x=await A.state.sb.from("behavior_events").insert(p);if(x.error)throw x.error;A.toast("رویداد ثبت شد.");renderBehavior()
    })
  }
}

async function renderForms(){
  A.setPage(isManager()?"فرم‌ساز مدرسه":"فرم‌ها","فرم‌های داخلی و پاسخ‌های شما");
  var r=await A.state.sb.from("forms").select("*").order("created_at",{ascending:false});if(r.error)throw r.error;
  var add=isManager()?'<button class="btn btn-primary" id="newForm">+ فرم جدید</button>':"";
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>فرم‌ها</h3></div>'+add+'</div><div class="v7-grid">'+((r.data||[]).length?(r.data||[]).map(function(f){return card(f.title,'<p class="muted">'+esc(f.description||"بدون توضیح")+'</p><small>'+((f.opens_at?dt(f.opens_at):"اکنون"))+' تا '+(f.closes_at?dt(f.closes_at):"بدون پایان")+'</small>',isManager()?'<div class="actions"><button class="btn btn-ghost form-results" data-id="'+f.id+'">نتایج</button></div>':'<button class="btn btn-primary fill-form" data-id="'+f.id+'">تکمیل فرم</button>')}).join(""):empty())+'</div>';
  if(q("#newForm"))q("#newForm").onclick=newFormModal;
  qa(".fill-form").forEach(function(b){b.onclick=function(){fillForm(b.dataset.id)}});
  qa(".form-results").forEach(function(b){b.onclick=function(){formResults(b.dataset.id)}})
}
function newFormModal(){
  A.modal("فرم جدید",'<div class="form-grid"><label class="wide"><span>عنوان</span><input id="foTitle"></label><label class="wide"><span>توضیح</span><textarea id="foDesc"></textarea></label>'+targetFields("fo",true)+
    '<label><span>شروع</span><input id="foOpen" type="datetime-local"></label><label><span>پایان</span><input id="foClose" type="datetime-local"></label><label class="check-card wide"><input id="foOne" type="checkbox" checked><span><b>فقط یک پاسخ برای هر کاربر</b></span></label>'+
    '<div class="wide"><div class="panel-head"><b>فیلدهای فرم</b><button type="button" class="btn btn-ghost" id="foAddField">+ فیلد</button></div><div id="foFields"></div></div></div>',async function(){
      var p={title:q("#foTitle").value.trim(),description:q("#foDesc").value.trim()||null,opens_at:iso(q("#foOpen").value),closes_at:iso(q("#foClose").value),active:true,one_response:q("#foOne").checked,created_by:A.state.profile.id};Object.assign(p,targetPayload("fo"));
      var ins=await A.state.sb.from("forms").insert(p).select("*").single();if(ins.error)throw ins.error;
      var fields=qa(".fo-field").map(function(x,i){var typ=x.querySelector(".fo-type").value,raw=x.querySelector(".fo-options").value;return {form_id:ins.data.id,field_type:typ,label:x.querySelector(".fo-label").value.trim(),placeholder:null,required:x.querySelector(".fo-required").checked,options:["single_choice","multi_choice"].indexOf(typ)>=0?raw.split(",").map(function(y){return y.trim()}).filter(Boolean):null,sort_order:i}});
      if(fields.some(function(x){return !x.label}))throw new Error("عنوان همه فیلدها را وارد کنید.");
      if(fields.length){var f=await A.state.sb.from("form_fields").insert(fields);if(f.error)throw f.error}
      A.toast("فرم ساخته شد.");renderForms()
    });
  function addField(){var el=document.createElement("div");el.className="fo-field v7-builder-row";el.innerHTML='<select class="fo-type">'+Object.keys(formTypeLabels).map(function(k){return '<option value="'+k+'">'+formTypeLabels[k]+'</option>'}).join("")+'</select><input class="fo-label" placeholder="عنوان سؤال"><input class="fo-options" placeholder="گزینه‌ها با , جدا شوند"><label><input class="fo-required" type="checkbox"> الزامی</label><button type="button" class="icon-btn fo-remove">×</button>';q("#foFields").appendChild(el);el.querySelector(".fo-remove").onclick=function(){el.remove()}}
  q("#foAddField").onclick=addField;addField()
}
async function fillForm(id){
  var fields=await A.state.sb.from("form_fields").select("*").eq("form_id",id).order("sort_order");if(fields.error)return A.toast(err(fields.error),true);
  A.modal("تکمیل فرم",'<div class="form-grid">'+(fields.data||[]).map(function(f){
    var input="";
    if(f.field_type==="long_text")input='<textarea class="form-answer" data-id="'+f.id+'"></textarea>';
    else if(f.field_type==="single_choice")input='<select class="form-answer" data-id="'+f.id+'">'+(f.options||[]).map(function(o){return '<option value="'+esc(o)+'">'+esc(o)+'</option>'}).join("")+'</select>';
    else if(f.field_type==="multi_choice")input='<div class="v7-options">'+(f.options||[]).map(function(o){return '<label><input class="form-multi" data-id="'+f.id+'" type="checkbox" value="'+esc(o)+'"> '+esc(o)+'</label>'}).join("")+'</div>';
    else if(f.field_type==="yes_no")input='<select class="form-answer" data-id="'+f.id+'"><option value="بله">بله</option><option value="خیر">خیر</option></select>';
    else input='<input class="form-answer" data-id="'+f.id+'" type="'+(f.field_type==="number"?"number":f.field_type==="date"?"date":f.field_type==="time"?"time":"text")+'">';
    return '<label class="wide"><span>'+esc(f.label)+(f.required?" *":"")+'</span>'+input+'</label>'
  }).join("")+'</div>',async function(){
    var s=await A.state.sb.from("form_submissions").insert({form_id:id,user_id:A.state.profile.id}).select("*").single();if(s.error)throw s.error;
    var ans=(fields.data||[]).map(function(f){var val;if(f.field_type==="multi_choice")val=qa('.form-multi[data-id="'+f.id+'"]:checked').map(function(x){return x.value});else{var el=q('.form-answer[data-id="'+f.id+'"]');val=el?el.value:""}if(f.required&&(!val||(Array.isArray(val)&&!val.length)))throw new Error("پاسخ به «"+f.label+"» الزامی است.");return {submission_id:s.data.id,field_id:f.id,answer:val}});
    var a=await A.state.sb.from("form_answers").insert(ans);if(a.error)throw a.error;A.toast("فرم ارسال شد.")
  },"ارسال فرم")
}
async function formResults(id){
  var sub=await A.state.sb.from("form_submissions").select("*").eq("form_id",id).order("submitted_at",{ascending:false});if(sub.error)return A.toast(err(sub.error),true);
  A.modal("نتایج فرم",A.table(["کاربر","زمان"],(sub.data||[]).map(function(x){return '<tr><td>'+esc(A.userName(x.user_id))+'</td><td>'+dt(x.submitted_at)+'</td></tr>'})),async function(){q("#modal").close()},"بستن")
}

async function renderPolls(){
  A.setPage("نظرسنجی و رأی‌گیری","نظرسنجی‌های فعال و نتایج");
  var r=await A.state.sb.from("polls").select("*").order("created_at",{ascending:false});if(r.error)throw r.error;
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>نظرسنجی‌ها</h3></div>'+(isManager()?'<button class="btn btn-primary" id="newPoll">+ نظرسنجی</button>':"")+'</div><div class="v7-grid">'+((r.data||[]).length?(r.data||[]).map(function(p){return card(p.title,'<p class="muted">'+esc(p.description||"")+'</p><div class="pill-row">'+badge(p.anonymous?"ناشناس":"عادی")+badge(p.show_results?"نمایش نتیجه":"نتیجه مخفی")+'</div>',isManager()?'<button class="btn btn-ghost poll-result" data-id="'+p.id+'">نتایج</button>':'<div class="actions"><button class="btn btn-primary poll-vote" data-id="'+p.id+'">رأی دادن</button><button class="btn btn-ghost poll-result" data-id="'+p.id+'">نتایج</button></div>')}).join(""):empty())+'</div>';
  if(q("#newPoll"))q("#newPoll").onclick=function(){
    A.modal("نظرسنجی جدید",'<div class="form-grid"><label class="wide"><span>عنوان</span><input id="poTitle"></label><label class="wide"><span>توضیح</span><textarea id="poDesc"></textarea></label>'+targetFields("po",true)+'<label class="wide"><span>گزینه‌ها - هر گزینه در یک خط</span><textarea id="poOptions"></textarea></label><label class="check-card"><input id="poAnon" type="checkbox"><span><b>ناشناس</b></span></label><label class="check-card"><input id="poShow" type="checkbox"><span><b>نمایش نتیجه</b></span></label></div>',async function(){
      var p={title:q("#poTitle").value.trim(),description:q("#poDesc").value.trim()||null,anonymous:q("#poAnon").checked,show_results:q("#poShow").checked,active:true,created_by:A.state.profile.id};Object.assign(p,targetPayload("po"));
      var ins=await A.state.sb.from("polls").insert(p).select("*").single();if(ins.error)throw ins.error;var lines=q("#poOptions").value.split(/\n/).map(function(x){return x.trim()}).filter(Boolean);if(lines.length<2)throw new Error("حداقل دو گزینه لازم است.");
      var oo=await A.state.sb.from("poll_options").insert(lines.map(function(x,i){return {poll_id:ins.data.id,option_text:x,sort_order:i}}));if(oo.error)throw oo.error;A.toast("نظرسنجی ساخته شد.");renderPolls()
    })
  };
  qa(".poll-vote").forEach(function(b){b.onclick=function(){votePoll(b.dataset.id)}});
  qa(".poll-result").forEach(function(b){b.onclick=function(){pollResults(b.dataset.id)}})
}
async function votePoll(id){
  var o=await A.state.sb.from("poll_options").select("*").eq("poll_id",id).order("sort_order");if(o.error)return A.toast(err(o.error),true);
  A.modal("ثبت رأی",'<div class="v7-options">'+(o.data||[]).map(function(x){return '<label><input type="radio" name="pollOpt" value="'+x.id+'"> '+esc(x.option_text)+'</label>'}).join("")+'</div>',async function(){var c=q('input[name="pollOpt"]:checked');if(!c)throw new Error("یک گزینه را انتخاب کنید.");var r=await A.state.sb.rpc("vote_poll",{p_poll:id,p_option:c.value});if(r.error)throw r.error;A.toast("رأی شما ثبت شد.")},"ثبت رأی")
}
async function pollResults(id){
  var r=await A.state.sb.rpc("poll_results",{p_poll:id});if(r.error)return A.toast(err(r.error),true);
  A.modal("نتایج نظرسنجی",'<div class="v7-bars">'+(r.data||[]).map(function(x){return '<div><div class="panel-head"><span>'+esc(x.option_text)+'</span><b>'+fa(x.percent)+'٪</b></div><progress max="100" value="'+x.percent+'"></progress><small>'+fa(x.votes)+' رأی</small></div>'}).join("")+'</div>',async function(){q("#modal").close()},"بستن")
}

async function renderExtracurricular(){
  A.setPage("کلاس‌های فوق‌برنامه","تقویتی، ورزشی، هنری و فرهنگی");
  var r=await A.state.sb.from("extracurricular_classes").select("*").order("created_at",{ascending:false});if(r.error)throw r.error;
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>فوق‌برنامه‌ها</h3></div>'+(isManager()?'<button class="btn btn-primary" id="newExtra">+ کلاس جدید</button>':"")+'</div><div class="v7-grid">'+((r.data||[]).length?(r.data||[]).map(function(x){return card(x.title,'<p>'+esc(x.description||"")+'</p><p class="muted">'+esc(x.location||"بدون مکان")+' — ظرفیت '+fa(x.capacity)+'</p>',isStudent()?'<button class="btn btn-primary extra-enroll" data-id="'+x.id+'">درخواست ثبت‌نام</button>':'<button class="btn btn-ghost extra-members" data-id="'+x.id+'">اعضا</button>')}).join(""):empty())+'</div>';
  if(q("#newExtra"))q("#newExtra").onclick=function(){
    A.modal("کلاس فوق‌برنامه",'<div class="form-grid"><label><span>عنوان</span><input id="ecTitle"></label><label><span>دسته</span><select id="ecCategory"><option value="remedial">تقویتی</option><option value="sports">ورزشی</option><option value="art">هنری</option><option value="cultural">فرهنگی</option><option value="language">زبان</option><option value="olympiad">المپیاد</option><option value="lab">آزمایشگاه</option><option value="other">سایر</option></select></label><label><span>دبیر</span><select id="ecTeacher"><option value="">-</option>'+opt(A.state.profiles.filter(function(p){return p.role==="teacher"}),function(x){return x.id},function(x){return x.full_name})+'</select></label><label><span>ظرفیت</span><input id="ecCap" inputmode="numeric" value="20"></label><label><span>مکان</span><input id="ecLocation"></label><label><span>شروع ثبت‌نام</span><input id="ecRegStart" type="datetime-local"></label><label><span>پایان ثبت‌نام</span><input id="ecRegEnd" type="datetime-local"></label><label class="wide"><span>توضیح</span><textarea id="ecDesc"></textarea></label></div>',async function(){
      var p={title:q("#ecTitle").value.trim(),description:q("#ecDesc").value.trim()||null,category:q("#ecCategory").value,teacher_id:q("#ecTeacher").value||null,capacity:Number(en(q("#ecCap").value)),location:q("#ecLocation").value.trim()||null,registration_start:iso(q("#ecRegStart").value),registration_end:iso(q("#ecRegEnd").value),active:true,created_by:A.state.profile.id};
      var x=await A.state.sb.from("extracurricular_classes").insert(p);if(x.error)throw x.error;A.toast("کلاس فوق‌برنامه ایجاد شد.");renderExtracurricular()
    })
  };
  qa(".extra-enroll").forEach(function(b){b.onclick=async function(){var x=await A.state.sb.rpc("enroll_extracurricular",{p_class:b.dataset.id});if(x.error)return A.toast(err(x.error),true);A.toast("درخواست ثبت‌نام ارسال شد.")}});
  qa(".extra-members").forEach(function(b){b.onclick=function(){extraMembers(b.dataset.id)}})
}
async function extraMembers(id){
  var r=await A.state.sb.from("extracurricular_enrollments").select("*").eq("class_id",id).order("registered_at");if(r.error)return A.toast(err(r.error),true);
  A.modal("اعضای فوق‌برنامه",A.table(["دانش‌آموز","وضعیت","عملیات"],(r.data||[]).map(function(x){return '<tr><td>'+esc(A.userName(x.student_id))+'</td><td>'+esc(x.status)+'</td><td><div class="actions"><button class="btn btn-ghost extra-status" data-id="'+x.id+'" data-s="approved">تأیید</button><button class="btn btn-ghost danger extra-status" data-id="'+x.id+'" data-s="rejected">رد</button></div></td></tr>'})),async function(){q("#modal").close()},"بستن");
  qa(".extra-status").forEach(function(b){b.onclick=async function(){var x=await A.state.sb.from("extracurricular_enrollments").update({status:b.dataset.s,updated_at:new Date().toISOString()}).eq("id",b.dataset.id);if(x.error)return A.toast(err(x.error),true);q("#modal").close();extraMembers(id)}})
}

async function renderAppointments(){
  A.setPage("نوبت‌دهی ملاقات","رزرو ملاقات با مدیر یا دبیر");
  var slots=await A.state.sb.from("appointment_slots").select("*").order("starts_at");if(slots.error)throw slots.error;
  var ap=await A.state.sb.from("appointments").select("*").order("created_at",{ascending:false});if(ap.error)throw ap.error;
  var canCreate=isManager()||isTeacher();
  q("#content").innerHTML='<div class="panel-head page-actions"><div><h3>زمان‌های ملاقات</h3></div>'+(canCreate?'<button class="btn btn-primary" id="newSlot">+ زمان آزاد</button>':"")+'</div>'+
    '<div class="v7-grid">'+((slots.data||[]).length?(slots.data||[]).filter(function(s){return new Date(s.starts_at)>new Date()||s.staff_id===A.state.profile.id||isManager()}).map(function(s){return card(A.userName(s.staff_id),'<p>'+dt(s.starts_at)+' تا '+dt(s.ends_at)+'</p><p class="muted">'+esc(s.location||"بدون مکان")+' — ظرفیت '+fa(s.capacity)+'</p>',s.staff_id===A.state.profile.id||isManager()?"":'<button class="btn btn-primary book-slot" data-id="'+s.id+'">رزرو</button>')}).join(""):empty())+'</div>'+
    card("درخواست‌ها",A.table(["درخواست‌دهنده","موضوع","وضعیت","عملیات"],(ap.data||[]).map(function(x){var slot=(slots.data||[]).find(function(s){return s.id===x.slot_id});var ownStaff=slot&&slot.staff_id===A.state.profile.id;return '<tr><td>'+esc(A.userName(x.requester_id))+'</td><td>'+esc(x.subject)+'</td><td>'+esc(x.status)+'</td><td>'+((isManager()||ownStaff)&&x.status==="pending"?'<div class="actions"><button class="btn btn-ghost ap-status" data-id="'+x.id+'" data-s="approved">تأیید</button><button class="btn btn-ghost danger ap-status" data-id="'+x.id+'" data-s="rejected">رد</button></div>':x.requester_id===A.state.profile.id&&["pending","approved"].indexOf(x.status)>=0?'<button class="btn btn-ghost danger ap-status" data-id="'+x.id+'" data-s="cancelled">لغو</button>':"-")+'</td></tr>'})));
  if(q("#newSlot"))q("#newSlot").onclick=function(){
    A.modal("زمان آزاد ملاقات",'<div class="form-grid"><label><span>شروع</span><input id="slStart" type="datetime-local" value="'+localInput(new Date(Date.now()+86400000))+'"></label><label><span>پایان</span><input id="slEnd" type="datetime-local" value="'+localInput(new Date(Date.now()+88200000))+'"></label><label><span>مکان</span><input id="slLoc"></label><label><span>ظرفیت</span><input id="slCap" inputmode="numeric" value="1"></label></div>',async function(){var p={staff_id:A.state.profile.id,starts_at:iso(q("#slStart").value),ends_at:iso(q("#slEnd").value),location:q("#slLoc").value.trim()||null,capacity:Number(en(q("#slCap").value)),active:true};var x=await A.state.sb.from("appointment_slots").insert(p);if(x.error)throw x.error;A.toast("زمان ملاقات ثبت شد.");renderAppointments()})
  };
  qa(".book-slot").forEach(function(b){b.onclick=function(){A.modal("درخواست ملاقات",'<div class="form-grid"><label class="wide"><span>موضوع</span><input id="apSubject"></label><label class="wide"><span>توضیح</span><textarea id="apDesc"></textarea></label></div>',async function(){var x=await A.state.sb.rpc("book_appointment",{p_slot:b.dataset.id,p_subject:q("#apSubject").value.trim(),p_description:q("#apDesc").value.trim()});if(x.error)throw x.error;A.toast("درخواست ملاقات ارسال شد.");renderAppointments()})}});
  qa(".ap-status").forEach(function(b){b.onclick=async function(){var p={status:b.dataset.s};if(b.dataset.s==="approved")p.approved_at=new Date().toISOString();var x=await A.state.sb.from("appointments").update(p).eq("id",b.dataset.id);if(x.error)return A.toast(err(x.error),true);renderAppointments()}})
}

async function renderAudit(){
  if(!isManager()){q("#content").innerHTML=empty("این بخش فقط برای مدیر است.");return}
  A.setPage("گزارش فعالیت‌ها","تاریخچه تغییرات حساس سامانه");
  var r=await A.state.sb.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(500);if(r.error)throw r.error;
  q("#content").innerHTML=card("Audit Log",A.table(["زمان","کاربر","عملیات","جدول","رکورد","تغییر"],(r.data||[]).map(function(x){var change="";if(x.old_data&&x.new_data){var keys=Object.keys(x.new_data).filter(function(k){return JSON.stringify(x.old_data[k])!==JSON.stringify(x.new_data[k])});change=keys.slice(0,5).map(function(k){return k+": "+String(x.old_data[k])+" → "+String(x.new_data[k])}).join(" | ")}return '<tr><td>'+dt(x.created_at)+'</td><td>'+esc(A.userName(x.user_id))+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.table_name)+'</td><td>'+esc(x.record_id||"-")+'</td><td class="v7-audit-change">'+esc(change||"-")+'</td></tr>'})))
}

async function renderSecurity(){
  A.setPage("امنیت حساب","تغییر رمز عبور و امنیت نشست");
  q("#content").innerHTML=card("تغییر رمز عبور",'<form id="changePassword" class="form-grid v7-narrow"><label class="wide"><span>رمز جدید</span><input id="secPass" type="password" minlength="8" autocomplete="new-password"></label><label class="wide"><span>تکرار رمز</span><input id="secPass2" type="password" minlength="8" autocomplete="new-password"></label><button class="btn btn-primary wide" type="submit">تغییر رمز</button></form>')+
    card("نشست کاربری",'<p class="muted">برای خروج امن از این دستگاه از دکمه خروج بالای صفحه استفاده کنید.</p><button id="signOutAll" class="btn btn-ghost danger">خروج از همه دستگاه‌ها</button>');
  q("#changePassword").onsubmit=async function(e){e.preventDefault();var p=q("#secPass").value;if(p.length<8)return A.toast("رمز باید حداقل ۸ کاراکتر باشد.",true);if(p!==q("#secPass2").value)return A.toast("تکرار رمز یکسان نیست.",true);var x=await A.state.sb.auth.updateUser({password:p});if(x.error)return A.toast(err(x.error),true);await A.state.sb.rpc("complete_initial_password_change");A.toast("رمز عبور تغییر کرد.")};
  q("#signOutAll").onclick=async function(){var x=await A.state.sb.auth.signOut({scope:"global"});if(x.error)return A.toast(err(x.error),true);location.reload()}
}

window.SCHOOL_V7={bind:bind,hasRoute:hasRoute,menuFor:menuFor,navigate:navigate,afterEnter:afterEnter,forcePasswordChange:forcePasswordChange,refreshNotificationBadge:refreshNotificationBadge};
})();