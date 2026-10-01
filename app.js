(() => {
"use strict";

const cfg = window.APP_CONFIG || {};
const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
  !cfg.SUPABASE_URL.includes("YOUR_PROJECT") && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");

const $ = (s) => document.querySelector(s);
const esc = (v="") => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const faRole = {manager:"مدیر مدرسه", teacher:"معلم", student:"دانش‌آموز"};
const faStatus = {pending:"در انتظار",approved:"تأیید شده",rejected:"رد شده"};
const faComponent = {continuous:"تکوینی",final:"پایانی"};
const disciplineLabels={1:"عالی",2:"خیلی خوب",3:"خوب",4:"قابل قبول",5:"نیاز به تلاش"};
const toFaDigits=(v="")=>String(v)
  .replace(/[0-9]/g,d=>"۰۱۲۳۴۵۶۷۸۹"[d])
  .replace(/[٠-٩]/g,d=>"۰۱۲۳۴۵۶۷۸۹"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
const toEnDigits=(v="")=>String(v)
  .replace(/[۰-۹]/g,d=>"0123456789"["۰۱۲۳۴۵۶۷۸۹".indexOf(d)])
  .replace(/[٠-٩]/g,d=>"0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
const faDateTime=(v)=>v?new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"-";

function persianizeNode(root){
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes=[];
  while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(n=>{
    if(n.parentElement?.closest("script,style"))return;
    const next=toFaDigits(n.nodeValue);
    if(next!==n.nodeValue)n.nodeValue=next;
  });
  if(root.querySelectorAll){
    root.querySelectorAll("input,textarea").forEach(inp=>{
      if(["password","file","hidden"].includes(inp.type))return;
      const next=toFaDigits(inp.value);
      if(next!==inp.value)inp.value=next;
    });
  }
}
function setupPersianDigits(){
  document.addEventListener("input",e=>{
    const el=e.target;
    if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))return;
    if(["password","file","hidden"].includes(el.type))return;
    const pos=el.selectionStart, next=toFaDigits(el.value);
    if(next!==el.value){
      el.value=next;
      try{el.setSelectionRange(pos,pos)}catch(_){}
    }
  },true);
  const observer=new MutationObserver(items=>{
    items.forEach(m=>m.addedNodes.forEach(n=>{
      if(n.nodeType===Node.TEXT_NODE){
        const next=toFaDigits(n.nodeValue); if(next!==n.nodeValue)n.nodeValue=next;
      }else if(n.nodeType===Node.ELEMENT_NODE)persianizeNode(n);
    }));
  });
  observer.observe(document.body,{childList:true,subtree:true});
  persianizeNode(document.body);
}
const state = {
  sb: configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null,
  session:null, profile:null, route:"dashboard",
  profiles:[], grades:[], classes:[], subjects:[], assignments:[], classStudents:[], representatives:[],
  refsLoadedAt:0, refsPromise:null
};

function toast(message, error=false){
  const t=$("#toast"); t.textContent=message; t.className="toast show"+(error?" error":"");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.className="toast",3500);
}
function errText(e){
  const m=e?.message||String(e||"خطای نامشخص");
  const map={ACCESS_DENIED:"دسترسی مجاز نیست.",CONTINUOUS_LOCKED:"نمره تکوینی قفل است.",FINAL_LOCKED:"نمره پایانی قفل است.",
    MANAGER_ONLY:"این عملیات فقط برای مدیر مجاز است.",INVALID_NATIONAL_ID:"کد ملی باید ۱۰ رقم باشد.",
    USER_INACTIVE:"حساب مدیر غیرفعال است.",
    CANNOT_DELETE_SELF:"مدیر نمی‌تواند حساب خودش را حذف کند."};
  return map[m]||m;
}
async function invokeFunction(name, body){
  const {data,error}=await state.sb.functions.invoke(name,{body});
  if(error){
    let details=null;
    try{
      if(error.context && typeof error.context.json==="function") details=await error.context.json();
    }catch(_){}
    const raw = details?.error ?? details?.message ?? error.message ?? "خطا در اجرای Edge Function";
    const message = typeof raw === "string" ? raw : (()=>{ try { return JSON.stringify(raw); } catch(_) { return String(raw); } })();
    throw new Error(message);
  }
  if(!data?.ok) throw new Error(data?.error||"عملیات سمت سرور ناموفق بود.");
  return data;
}
function roleBadge(role){return `<span class="badge">${faRole[role]||esc(role)}</span>`;}
function byId(arr,id){return arr.find(x=>x.id===id);}
function className(id){const c=byId(state.classes,id); const g=c&&byId(state.grades,c.grade_id); return c?`${g?g.title+" - ":""}${c.title}`:"-";}
function subjectName(id){return byId(state.subjects,id)?.title||"-";}
function userName(id){return byId(state.profiles,id)?.full_name||"-";}
function modal(title, body, onSubmit, submitText="ذخیره"){
  $("#modalTitle").textContent=title; $("#modalBody").innerHTML=body; $("#modalSubmit").textContent=submitText;
  $("#modalSubmit").onclick=async()=>{
    const btn=$("#modalSubmit"), old=btn.textContent;
    btn.disabled=true; btn.textContent="در حال ذخیره…";
    try{await onSubmit(); $("#modal").close();}
    catch(e){toast(errText(e),true)}
    finally{btn.disabled=false; btn.textContent=old;}
  };
  $("#modal").showModal();
}
function num(v){if(v===""||v===null||v===undefined)return null; const n=Number(toEnDigits(v)); if(Number.isNaN(n)||n<0||n>20) throw new Error("نمره باید بین ۰ تا ۲۰ باشد."); return n;}
function setPage(title,subtitle){$("#pageTitle").textContent=title;$("#pageSubtitle").textContent=subtitle||"";}
function setLoading(){ $("#content").innerHTML='<div class="card empty">در حال دریافت اطلاعات…</div>'; }
function table(headers,rows,empty="اطلاعاتی ثبت نشده است."){
  if(!rows.length)return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

document.addEventListener("DOMContentLoaded", init);
async function init(){
  setupPersianDigits();
  $("#schoolTitle").textContent=cfg.SCHOOL_NAME||"سامانه مدرسه";
  $("#todayText").textContent=new Intl.DateTimeFormat("fa-IR",{dateStyle:"long"}).format(new Date());
  $("#configWarning").classList.toggle("hidden",configured);
  $("#loginForm").addEventListener("submit",login);
  $("#logoutBtn").onclick=logout;
  $("#mobileMenuBtn").onclick=()=>$(".sidebar").classList.toggle("open");
  $("#modalClose").onclick=()=>$("#modal").close();
  $("#modalCancel").onclick=()=>$("#modal").close();
  if(!configured)return;

  const {data:{session}}=await state.sb.auth.getSession();
  if(session){state.session=session; await enterApp();}
  state.sb.auth.onAuthStateChange(async(_event,session)=>{
    state.session=session;
    if(!session){showLogin();}
  });
}

async function login(e){
  e.preventDefault(); if(!configured)return toast("ابتدا config.js را تنظیم کنید.",true);
  const nid=toEnDigits($("#loginNationalId").value.trim()), password=$("#loginPassword").value;
  if(!/^\d{10}$/.test(nid))return toast("کد ملی باید ۱۰ رقم باشد.",true);
  const {data,error}=await state.sb.auth.signInWithPassword({email:`${nid}@school.local`,password});
  if(error)return toast("نام کاربری یا رمز عبور نادرست است.",true);
  state.session=data.session; await enterApp();
}
async function logout(){await state.sb.auth.signOut();showLogin();}
function showLogin(){
  state.profile=null; state.refsLoadedAt=0;
  $("#appView").classList.add("hidden");$("#loginView").classList.remove("hidden");
}
async function enterApp(){
  const {data,error}=await state.sb.from("profiles").select("*").eq("id",state.session.user.id).single();
  if(error||!data?.active){await state.sb.auth.signOut();return toast("حساب کاربری فعال نیست.",true);}
  state.profile=data;
  $("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");
  $("#userName").textContent=data.full_name;$("#userRole").textContent=faRole[data.role];
  $("#avatar").textContent=(data.full_name||"ک").trim().charAt(0);
  await refreshRefs(); buildNav(); navigate("dashboard");
}
function buildNav(){
  const studentMenu=[
    ["dashboard","داشبورد"],["report","کارنامه من"],["homework","تکالیف"],
    ["groups","گروه من"],["announcements","اطلاعیه‌ها"],["teachers","معلمان دروس"],["objections","اعتراضات من"]
  ];
  if(state.representatives.some(r=>r.student_id===state.profile.id)) studentMenu.splice(4,0,["discipline","ثبت انضباط"]);
  const menus={
    manager:[["dashboard","داشبورد"],["users","کاربران"],["structure","پایه، کلاس و درس"],["assignments","تخصیص‌ها و نماینده"],["scores","ثبت و قفل نمرات"],["announcements","اطلاعیه‌ها"],["settings","تنظیمات سامانه"]],
    teacher:[["dashboard","داشبورد"],["scores","ثبت نمرات"],["homework","تکالیف"],["groups","گروه‌های کلاسی"],["announcements","اطلاعیه‌ها"],["objections","اعتراضات"]],
    student:studentMenu
  };
  $("#mainNav").innerHTML=menus[state.profile.role].map(([r,t])=>`<button class="nav-btn" data-route="${r}">${t}</button>`).join("");
  $("#mainNav").querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.route));
}
async function refreshRefs(force=false){
  const maxAge=15000;
  if(!force && state.refsLoadedAt && Date.now()-state.refsLoadedAt<maxAge) return;
  if(state.refsPromise){
    await state.refsPromise;
    if(!force && Date.now()-state.refsLoadedAt<maxAge) return;
  }

  const queries=[
    ["profiles","profiles","*","full_name"],
    ["grades","grade_levels","*","sort_order"],
    ["classes","classes","*","title"],
    ["subjects","subjects","*","title"],
    ["assignments","teacher_assignments","*","id"],
    ["classStudents","class_students","*","class_id"],
    ["representatives","class_representatives","*","class_id"]
  ];

  state.refsPromise=Promise.all(
    queries.map(async([stateKey,tableName,select,order])=>{
      const {data,error}=await state.sb.from(tableName).select(select).order(order,{ascending:true});
      if(error) throw error;
      return [stateKey,data||[]];
    })
  ).then(results=>{
    results.forEach(([key,data])=>state[key]=data);
    state.refsLoadedAt=Date.now();
  }).finally(()=>{state.refsPromise=null;});

  return state.refsPromise;
}
async function navigate(route){
  state.route=route; $(".sidebar").classList.remove("open");
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
  setLoading();
  try{
    if(route==="dashboard")return renderDashboard();
    if(route==="users")return renderUsers();
    if(route==="structure")return renderStructure();
    if(route==="assignments")return renderAssignments();
    if(route==="scores")return renderScores();
    if(route==="announcements")return renderAnnouncements();
    if(route==="objections")return renderObjections();
    if(route==="report")return renderReport();
    if(route==="teachers")return renderTeachers();
    if(route==="settings")return renderSettings();
    if(route==="homework")return renderHomework();
    if(route==="groups")return renderGroups();
    if(route==="discipline")return renderDiscipline();
  }catch(e){$("#content").innerHTML=`<div class="alert alert-warning">${esc(errText(e))}</div>`;}
}

async function renderDashboard(){
  setPage("داشبورد","نمای کلی سامانه");
  if(state.profile.role==="manager"){
    const teachers=state.profiles.filter(x=>x.role==="teacher").length, students=state.profiles.filter(x=>x.role==="student").length;
    const {count:pending}=await state.sb.from("objections").select("*",{count:"exact",head:true}).eq("status","pending");
    $("#content").innerHTML=`<div class="stats">
      <div class="stat"><span>معلمان</span><b>${teachers}</b></div><div class="stat"><span>دانش‌آموزان</span><b>${students}</b></div>
      <div class="stat"><span>کلاس‌ها</span><b>${state.classes.length}</b></div><div class="stat"><span>اعتراضات باز</span><b>${pending||0}</b></div>
    </div><div class="card"><h3>راهنمای سریع</h3><p class="muted">ابتدا پایه، کلاس و درس را بسازید؛ سپس دانش‌آموزان را به کلاس و معلمان را به درس/کلاس تخصیص دهید. بعد از آن ثبت نمره فعال است.</p></div>`;
  } else if(state.profile.role==="teacher"){
    const {count:pending}=await state.sb.from("objections").select("*",{count:"exact",head:true}).eq("status","pending");
    $("#content").innerHTML=`<div class="stats"><div class="stat"><span>دسترسی‌های تدریس</span><b>${state.assignments.filter(a=>a.teacher_id===state.profile.id).length}</b></div>
    <div class="stat"><span>اعتراضات در انتظار</span><b>${pending||0}</b></div></div>
    <div class="card"><h3>ثبت نمره</h3><p class="muted">«ثبت نمرات» موقت است. با «ثبت نهایی» بخش تکوینی یا پایانی قفل می‌شود و بازگشایی فقط توسط مدیر انجام می‌شود.</p></div>`;
  }else{
    const {data:scores}=await state.sb.from("scores").select("*").eq("student_id",state.profile.id);
    const complete=(scores||[]).filter(s=>s.lesson_score!==null).length;
    $("#content").innerHTML=`<div class="stats"><div class="stat"><span>دروس دارای نمره کامل</span><b>${complete}</b></div>
    <div class="stat"><span>کلاس‌های ثبت‌شده</span><b>${state.classStudents.filter(x=>x.student_id===state.profile.id).length}</b></div></div>
    <div class="card"><h3>نمره درس</h3><p class="muted">نمره درس به‌صورت خودکار از فرمول (تکوینی + پایانی) ÷ ۲ محاسبه می‌شود.</p></div>`;
  }
}

async function renderUsers(){
  setPage("مدیریت کاربران","افزودن، ویرایش، حذف و تغییر رمز معلمان و دانش‌آموزان");
  await refreshRefs();
  const users=state.profiles.filter(x=>x.role!=="manager");
  $("#content").innerHTML=`<div class="card"><div class="panel-head"><div><h3>کاربران</h3><p class="muted">در زمان ساخت، نام کاربری و رمز اولیه هر دو کد ملی هستند.</p></div>
  <button class="btn btn-primary" id="addUser">+ کاربر جدید</button></div><br>
  ${table(["نام","کد ملی","نقش","وضعیت","عملیات"],users.map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.national_id)}</td><td>${roleBadge(u.role)}</td>
  <td>${u.active?'<span class="badge">فعال</span>':'<span class="badge danger">غیرفعال</span>'}</td>
  <td><div class="actions"><button class="btn btn-ghost edit-user" data-id="${u.id}">ویرایش</button><button class="btn btn-ghost danger del-user" data-id="${u.id}">حذف</button></div></td></tr>`))}</div>`;
  $("#addUser").onclick=()=>userModal();
  document.querySelectorAll(".edit-user").forEach(b=>b.onclick=()=>userModal(byId(users,b.dataset.id)));
  document.querySelectorAll(".del-user").forEach(b=>b.onclick=()=>deleteUser(b.dataset.id));
}
function userModal(u=null){
  modal(u?"ویرایش کاربر":"کاربر جدید",`<div class="form-grid">
  <label><span>نام و نام خانوادگی</span><input id="fName" value="${esc(u?.full_name||"")}" required></label>
  <label><span>کد ملی (نام کاربری)</span><input id="fNid" maxlength="10" inputmode="numeric" value="${esc(u?.national_id||"")}" required></label>
  <label><span>نقش</span><select id="fRole"><option value="teacher" ${u?.role==="teacher"?"selected":""}>معلم</option><option value="student" ${u?.role==="student"?"selected":""}>دانش‌آموز</option></select></label>
  ${u?'<label><span>رمز جدید (اختیاری)</span><input id="fPassword" type="password" placeholder="خالی = بدون تغییر"></label>':""}
  </div>`,async()=>{
    const payload={action:u?"update":"create",user_id:u?.id,national_id:toEnDigits($("#fNid").value.trim()),full_name:$("#fName").value.trim(),role:$("#fRole").value};
    if(u&&$("#fPassword").value)payload.password=$("#fPassword").value;
    await invokeFunction("admin-user",payload);
    toast("اطلاعات کاربر ذخیره شد.");await refreshRefs(true);renderUsers();
  });
}
async function deleteUser(id){
  if(!confirm("این کاربر و داده‌های وابسته حذف شود؟"))return;
  try{
    await invokeFunction("admin-user",{action:"delete",user_id:id});
    toast("کاربر حذف شد.");await refreshRefs(true);renderUsers();
  }catch(e){toast(errText(e),true);}
}

async function renderStructure(){
  setPage("ساختار آموزشی","ثبت پایه، کلاس و درس برای هر پایه");
  await refreshRefs();
  const gradeRows=state.grades.map(g=>`<tr><td>${esc(g.title)}</td><td>${g.sort_order}</td><td><div class="actions"><button class="btn btn-ghost edit-grade" data-id="${g.id}">ویرایش</button><button class="btn btn-ghost danger del-grade" data-id="${g.id}">حذف</button></div></td></tr>`);
  const classRows=state.classes.map(c=>`<tr><td>${esc(className(c.id))}</td><td>${esc(c.academic_year)}</td><td><div class="actions"><button class="btn btn-ghost edit-class" data-id="${c.id}">ویرایش</button><button class="btn btn-ghost danger del-class" data-id="${c.id}">حذف</button></div></td></tr>`);
  const subjectRows=state.subjects.map(s=>`<tr><td>${esc(s.title)}</td><td>${esc(byId(state.grades,s.grade_id)?.title||"-")}</td><td><div class="actions"><button class="btn btn-ghost edit-subject" data-id="${s.id}">ویرایش</button><button class="btn btn-ghost danger del-subject" data-id="${s.id}">حذف</button></div></td></tr>`);
  $("#content").innerHTML=`<div class="grid-3">
    <div class="card"><div class="panel-head"><h3>پایه‌ها</h3><button class="btn btn-primary" id="addGrade">+</button></div>${table(["عنوان","ترتیب","عملیات"],gradeRows)}</div>
    <div class="card"><div class="panel-head"><h3>کلاس‌ها</h3><button class="btn btn-primary" id="addClass">+</button></div>${table(["کلاس","سال","عملیات"],classRows)}</div>
    <div class="card"><div class="panel-head"><h3>دروس</h3><button class="btn btn-primary" id="addSubject">+</button></div>${table(["درس","پایه","عملیات"],subjectRows)}</div>
  </div>`;
  $("#addGrade").onclick=()=>gradeModal(); $("#addClass").onclick=()=>classModal(); $("#addSubject").onclick=()=>subjectModal();
  document.querySelectorAll(".edit-grade").forEach(b=>b.onclick=()=>gradeModal(byId(state.grades,b.dataset.id)));
  document.querySelectorAll(".edit-class").forEach(b=>b.onclick=()=>classModal(byId(state.classes,b.dataset.id)));
  document.querySelectorAll(".edit-subject").forEach(b=>b.onclick=()=>subjectModal(byId(state.subjects,b.dataset.id)));
  document.querySelectorAll(".del-grade").forEach(b=>b.onclick=()=>remove("grade_levels",b.dataset.id));
  document.querySelectorAll(".del-class").forEach(b=>b.onclick=()=>remove("classes",b.dataset.id));
  document.querySelectorAll(".del-subject").forEach(b=>b.onclick=()=>remove("subjects",b.dataset.id));
}
function gradeModal(g=null){modal(g?"ویرایش پایه":"پایه جدید",`<div class="form-grid"><label><span>عنوان پایه</span><input id="gTitle" value="${esc(g?.title||"")}"></label><label><span>ترتیب</span><input id="gSort" type="text" inputmode="decimal" value="${g?.sort_order??0}"></label></div>`,async()=>{const payload={title:$("#gTitle").value.trim(),sort_order:Number($("#gSort").value||0)};const q=g?state.sb.from("grade_levels").update(payload).eq("id",g.id):state.sb.from("grade_levels").insert(payload);const {error}=await q;if(error)throw error;await refreshRefs(true);renderStructure();});}
function classModal(c=null){modal(c?"ویرایش کلاس":"کلاس جدید",`<div class="form-grid"><label><span>پایه</span><select id="cGrade">${state.grades.map(g=>`<option value="${g.id}" ${c?.grade_id===g.id?"selected":""}>${esc(g.title)}</option>`).join("")}</select></label><label><span>نام کلاس</span><input id="cTitle" value="${esc(c?.title||"")}"></label><label><span>سال تحصیلی</span><input id="cYear" value="${esc(c?.academic_year||"1405-1406")}"></label></div>`,async()=>{const payload={grade_id:$("#cGrade").value,title:$("#cTitle").value.trim(),academic_year:$("#cYear").value.trim()};const q=c?state.sb.from("classes").update(payload).eq("id",c.id):state.sb.from("classes").insert(payload);const {error}=await q;if(error)throw error;await refreshRefs(true);renderStructure();});}
function subjectModal(s=null){modal(s?"ویرایش درس":"درس جدید",`<div class="form-grid"><label><span>پایه</span><select id="sGrade">${state.grades.map(g=>`<option value="${g.id}" ${s?.grade_id===g.id?"selected":""}>${esc(g.title)}</option>`).join("")}</select></label><label><span>نام درس</span><input id="sTitle" value="${esc(s?.title||"")}"></label></div>`,async()=>{const payload={grade_id:$("#sGrade").value,title:$("#sTitle").value.trim()};const q=s?state.sb.from("subjects").update(payload).eq("id",s.id):state.sb.from("subjects").insert(payload);const {error}=await q;if(error)throw error;await refreshRefs(true);renderStructure();});}
async function remove(tbl,id){if(!confirm("این مورد حذف شود؟ داده‌های وابسته نیز ممکن است حذف شوند."))return;const {error}=await state.sb.from(tbl).delete().eq("id",id);if(error)return toast(errText(error),true);toast("حذف شد.");await refreshRefs(true);renderStructure();}

async function renderAssignments(){
  setPage("تخصیص‌ها و نماینده کلاس","عضویت دانش‌آموز، معلم هر درس و نماینده کلاس");
  await refreshRefs();
  const teachers=state.profiles.filter(p=>p.role==="teacher"),students=state.profiles.filter(p=>p.role==="student");
  const ar=state.assignments.map(a=>`<tr><td>${esc(userName(a.teacher_id))}</td><td>${esc(className(a.class_id))}</td><td>${esc(subjectName(a.subject_id))}</td><td><button class="btn btn-ghost danger del-asg" data-id="${a.id}">حذف</button></td></tr>`);
  const csr=state.classStudents.map(x=>`<tr><td>${esc(userName(x.student_id))}</td><td>${esc(className(x.class_id))}</td><td><button class="btn btn-ghost danger del-cs" data-c="${x.class_id}" data-s="${x.student_id}">حذف</button></td></tr>`);
  const rr=state.representatives.map(x=>`<tr><td>${esc(className(x.class_id))}</td><td>${esc(userName(x.student_id))}</td><td><button class="btn btn-ghost danger del-rep" data-c="${x.class_id}">حذف</button></td></tr>`);
  $("#content").innerHTML=`<div class="grid-2">
  <div class="card"><div class="panel-head"><h3>معلم ↔ کلاس ↔ درس</h3><button class="btn btn-primary" id="addAsg">+ تخصیص</button></div>${table(["معلم","کلاس","درس",""],ar)}</div>
  <div class="card"><div class="panel-head"><h3>دانش‌آموزان کلاس</h3><button class="btn btn-primary" id="addCs">+ عضویت</button></div>${table(["دانش‌آموز","کلاس",""],csr)}</div>
  <div class="card"><div class="panel-head"><h3>نماینده کلاس</h3><button class="btn btn-primary" id="addRep">+ نماینده</button></div>${table(["کلاس","نماینده",""],rr)}</div></div>`;
  $("#addAsg").onclick=()=>modal("تخصیص معلم",`<div class="form-grid"><label><span>معلم</span><select id="aTeacher">${teachers.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join("")}</select></label><label><span>کلاس</span><select id="aClass">${state.classes.map(x=>`<option value="${x.id}">${esc(className(x.id))}</option>`).join("")}</select></label><label><span>درس</span><select id="aSubject">${state.subjects.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("")}</select></label></div>`,async()=>{const {error}=await state.sb.from("teacher_assignments").insert({teacher_id:$("#aTeacher").value,class_id:$("#aClass").value,subject_id:$("#aSubject").value});if(error)throw error;await refreshRefs(true);renderAssignments();});
  $("#addCs").onclick=()=>modal("افزودن گروهی دانش‌آموزان به کلاس",`
    <div class="form-grid">
      <label class="wide"><span>کلاس مقصد</span><select id="csClass">${state.classes.map(x=>`<option value="${x.id}">${esc(className(x.id))}</option>`).join("")}</select></label>
      <div class="wide">
        <div class="selection-head"><strong>انتخاب دانش‌آموزان</strong><button type="button" class="btn btn-ghost btn-sm" id="selectAllStudents">انتخاب همه</button></div>
        <div class="check-grid" id="studentChecks">
          ${students.map(x=>`<label class="check-card"><input type="checkbox" value="${x.id}"><span><b>${esc(x.full_name)}</b><small>${esc(x.national_id)}</small></span></label>`).join("")}
        </div>
      </div>
    </div>`,async()=>{
      const selected=[...document.querySelectorAll("#studentChecks input:checked")].map(x=>x.value);
      if(!selected.length)throw new Error("حداقل یک دانش‌آموز را انتخاب کنید.");
      const classId=$("#csClass").value;
      const rows=selected.map(student_id=>({class_id:classId,student_id}));
      const {error}=await state.sb.from("class_students").upsert(rows,{onConflict:"class_id,student_id",ignoreDuplicates:true});
      if(error)throw error;
      toast(`${selected.length} دانش‌آموز به کلاس اضافه شد.`);
      await refreshRefs(true);renderAssignments();
    });
    setTimeout(()=>{const b=$("#selectAllStudents");if(b)b.onclick=()=>document.querySelectorAll("#studentChecks input").forEach(x=>x.checked=true)},0);
  $("#addRep").onclick=()=>modal("ثبت نماینده کلاس",`<div class="form-grid"><label><span>کلاس</span><select id="rClass">${state.classes.map(x=>`<option value="${x.id}">${esc(className(x.id))}</option>`).join("")}</select></label><label><span>دانش‌آموز</span><select id="rStudent">${students.map(x=>`<option value="${x.id}">${esc(x.full_name)}</option>`).join("")}</select></label></div>`,async()=>{const {error}=await state.sb.from("class_representatives").upsert({class_id:$("#rClass").value,student_id:$("#rStudent").value});if(error)throw error;await refreshRefs(true);renderAssignments();});
  document.querySelectorAll(".del-asg").forEach(b=>b.onclick=async()=>{await state.sb.from("teacher_assignments").delete().eq("id",b.dataset.id);await refreshRefs(true);renderAssignments();});
  document.querySelectorAll(".del-cs").forEach(b=>b.onclick=async()=>{await state.sb.from("class_students").delete().eq("class_id",b.dataset.c).eq("student_id",b.dataset.s);await refreshRefs(true);renderAssignments();});
  document.querySelectorAll(".del-rep").forEach(b=>b.onclick=async()=>{await state.sb.from("class_representatives").delete().eq("class_id",b.dataset.c);await refreshRefs(true);renderAssignments();});
}

async function renderScores(){
  setPage("ثبت نمرات","نمره تکوینی، پایانی و محاسبه خودکار نمره درس");
  await refreshRefs();
  const asgs=state.profile.role==="manager"
    ? state.classes.flatMap(c=>state.subjects.filter(s=>s.grade_id===c.grade_id).map(s=>({class_id:c.id,subject_id:s.id,teacher_id:null})))
    : state.assignments.filter(a=>a.teacher_id===state.profile.id);
  if(!asgs.length){$("#content").innerHTML='<div class="card empty">هیچ کلاس/درسی برای ثبت نمره در دسترس نیست.</div>';return;}
  const opts=asgs.map(a=>`<option value="${a.class_id}|${a.subject_id}">${esc(className(a.class_id))} — ${esc(subjectName(a.subject_id))}</option>`).join("");
  $("#content").innerHTML=`<div class="card"><div class="toolbar"><label><span>کلاس و درس</span><select id="scoreCourse">${opts}</select></label>
  <label><span>دوره</span><input id="scorePeriod" value="نوبت اول"></label><button class="btn btn-primary" id="loadScores">نمایش دانش‌آموزان</button></div></div><div id="scoreArea"></div>`;
  $("#loadScores").onclick=loadScoreGrid; await loadScoreGrid();
}
async function loadScoreGrid(){
  const [classId,subjectId]=($("#scoreCourse").value||"|").split("|"), period=$("#scorePeriod").value.trim()||"نوبت اول";
  const memberships=state.classStudents.filter(x=>x.class_id===classId), ids=memberships.map(x=>x.student_id);
  const students=state.profiles.filter(p=>ids.includes(p.id)&&p.role==="student");
  const {data:scores,error}=await state.sb.from("scores").select("*").eq("class_id",classId).eq("subject_id",subjectId).eq("period",period);
  if(error)throw error; const sm=new Map((scores||[]).map(s=>[s.student_id,s]));
  const rows=students.map(st=>{const s=sm.get(st.id)||{}; return `<tr data-student="${st.id}"><td>${esc(st.full_name)}</td>
    <td><input class="score-input cont ${s.continuous_locked?"locked-input":""}" type="text" inputmode="decimal" min="0" max="20" step=".25" value="${s.continuous_score??""}" ${s.continuous_locked?"disabled":""}></td>
    <td><input class="score-input fin ${s.final_locked?"locked-input":""}" type="text" inputmode="decimal" min="0" max="20" step=".25" value="${s.final_score??""}" ${s.final_locked?"disabled":""}></td>
    <td class="score-summary">${s.lesson_score??"-"}</td><td>${s.continuous_locked?'<span class="badge warn">تکوینی قفل</span>':""} ${s.final_locked?'<span class="badge warn">پایانی قفل</span>':""}</td></tr>`;});
  const lockButtons=state.profile.role==="manager"?
  `<button class="btn btn-ghost" id="lockBtn">قفل نمرات</button><button class="btn btn-ghost" id="unlockBtn">بازگشایی</button>`:
  `<button class="btn btn-ghost" id="finalizeBtn">ثبت نهایی نمرات</button>`;
  $("#scoreArea").innerHTML=`<div class="card"><div class="panel-head"><div><h3>${esc(className(classId))} — ${esc(subjectName(subjectId))}</h3><p class="muted">فرمول: (تکوینی + پایانی) ÷ ۲</p></div>
  <div class="actions"><button class="btn btn-primary" id="saveScores">ثبت نمرات</button>${lockButtons}</div></div><br>
  ${table(["دانش‌آموز","تکوینی","پایانی","نمره درس","وضعیت"],rows,"دانش‌آموزی در این کلاس ثبت نشده است.")}</div>`;
  document.querySelectorAll("#scoreArea tbody input").forEach(inp=>inp.addEventListener("input",e=>{const tr=e.target.closest("tr"),a=tr.querySelector(".cont").value,b=tr.querySelector(".fin").value;tr.querySelector(".score-summary").textContent=(a!==""&&b!=="")?((Number(a)+Number(b))/2).toFixed(2):"-";}));
  $("#saveScores").onclick=()=>saveScores(classId,subjectId,period);
  if($("#finalizeBtn"))$("#finalizeBtn").onclick=()=>chooseLock(classId,subjectId,period,true,false);
  if($("#lockBtn"))$("#lockBtn").onclick=()=>chooseLock(classId,subjectId,period,true,true);
  if($("#unlockBtn"))$("#unlockBtn").onclick=()=>chooseLock(classId,subjectId,period,false,true);
}
async function saveScores(classId,subjectId,period){
  const rows=[...document.querySelectorAll("#scoreArea tbody tr")];
  const jobs=rows.map(tr=>({
    p_student:tr.dataset.student,
    p_class:classId,
    p_subject:subjectId,
    p_period:period,
    p_continuous:num(tr.querySelector(".cont").value),
    p_final:num(tr.querySelector(".fin").value)
  }));

  // درخواست‌ها در دسته‌های کوچک موازی می‌شوند تا هم سریع باشد و هم به API فشار ناگهانی وارد نشود.
  const batchSize=10;
  for(let i=0;i<jobs.length;i+=batchSize){
    const results=await Promise.all(
      jobs.slice(i,i+batchSize).map(args=>state.sb.rpc("save_score",args))
    );
    const failed=results.find(r=>r.error);
    if(failed?.error) throw failed.error;
  }

  toast("نمرات به‌صورت موقت ذخیره شدند.");
  await loadScoreGrid();
}
function chooseLock(classId,subjectId,period,locked,isManager){
  const options=isManager?'<option value="continuous">تکوینی</option><option value="final">پایانی</option><option value="both">هر دو</option>':'<option value="continuous">تکوینی</option><option value="final">پایانی</option>';
  modal(locked?"انتخاب بخش برای قفل":"بازگشایی نمرات",`<label><span>بخش</span><select id="lockPart">${options}</select></label><div class="alert alert-info" style="margin-top:12px">${locked?"پس از قفل، معلم امکان تغییر این بخش را ندارد.":"بخش انتخاب‌شده دوباره قابل ویرایش می‌شود."}</div>`,async()=>{
    await saveScores(classId,subjectId,period);
    const {error}=await state.sb.rpc("set_score_lock",{p_class:classId,p_subject:subjectId,p_period:period,p_component:$("#lockPart").value,p_locked:locked});
    if(error)throw error;toast(locked?"نمرات قفل شدند.":"نمرات بازگشایی شدند.");await loadScoreGrid();
  },locked?"قفل":"بازگشایی");
}

async function renderAnnouncements(){
  setPage("اطلاعیه‌ها",state.profile.role==="manager"?"ارسال گروهی یا انفرادی":"اطلاعیه‌های دریافتی");
  const {data,error}=await state.sb.from("announcements").select("*").order("created_at",{ascending:false});if(error)throw error;
  const add=state.profile.role==="manager"?'<button class="btn btn-primary" id="addAnn">+ اطلاعیه جدید</button>':"";
  $("#content").innerHTML=`<div class="card"><div class="panel-head"><h3>اطلاعیه‌ها</h3>${add}</div><br>
  ${(data||[]).length?(data||[]).map(a=>`<article class="announcement"><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p><small class="muted">${new Intl.DateTimeFormat("fa-IR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(a.created_at))}</small></article>`).join(""):'<div class="empty">اطلاعیه‌ای وجود ندارد.</div>'}</div>`;
  if($("#addAnn"))$("#addAnn").onclick=announcementModal;
}
function announcementModal(){
  modal("اطلاعیه جدید",`<div class="form-grid">
  <label class="wide"><span>عنوان</span><input id="anTitle"></label><label class="wide"><span>متن اطلاعیه</span><textarea id="anBody"></textarea></label>
  <label><span>نوع گیرنده</span><select id="anType"><option value="all">همه</option><option value="role">گروه نقش</option><option value="class">یک کلاس</option><option value="user">یک شخص</option></select></label>
  <label><span>نقش (در صورت انتخاب گروه)</span><select id="anRole"><option value="teacher">معلمان</option><option value="student">دانش‌آموزان</option></select></label>
  <label><span>کلاس</span><select id="anClass"><option value="">-</option>${state.classes.map(c=>`<option value="${c.id}">${esc(className(c.id))}</option>`).join("")}</select></label>
  <label><span>شخص</span><select id="anUser"><option value="">-</option>${state.profiles.filter(p=>p.role!=="manager").map(p=>`<option value="${p.id}">${esc(p.full_name)} - ${faRole[p.role]}</option>`).join("")}</select></label></div>`,async()=>{
    const type=$("#anType").value,p={title:$("#anTitle").value.trim(),body:$("#anBody").value.trim(),target_type:type,created_by:state.profile.id,target_role:null,target_class_id:null,target_user_id:null};
    if(type==="role")p.target_role=$("#anRole").value;if(type==="class")p.target_class_id=$("#anClass").value;if(type==="user")p.target_user_id=$("#anUser").value;
    if(!p.title||!p.body)throw new Error("عنوان و متن اطلاعیه الزامی است.");
    const {error}=await state.sb.from("announcements").insert(p);if(error)throw error;toast("اطلاعیه ارسال شد.");renderAnnouncements();
  },"ارسال");
}

async function renderReport(){
  setPage("کارنامه من","نمرات ثبت‌شده");
  const {data,error}=await state.sb.from("scores").select("*").eq("student_id",state.profile.id).order("period");if(error)throw error;
  const rows=(data||[]).map(s=>`<tr><td>${esc(subjectName(s.subject_id))}</td><td>${esc(s.period)}</td><td>${s.continuous_score??"-"}</td><td>${s.final_score??"-"}</td><td><strong>${s.lesson_score??"-"}</strong></td><td><button class="btn btn-ghost obj-btn" data-id="${s.id}" data-subject="${s.subject_id}">اعتراض</button></td></tr>`);
  $("#content").innerHTML=`<div class="card">${table(["درس","دوره","تکوینی","پایانی","نمره درس",""],rows,"هنوز نمره‌ای ثبت نشده است.")}</div>`;
  document.querySelectorAll(".obj-btn").forEach(b=>b.onclick=()=>studentObjectionModal(b.dataset.id,b.dataset.subject));
}
function studentObjectionModal(scoreId,subjectId){
  modal("ثبت اعتراض",`<div class="form-grid"><label><span>درس</span><input value="${esc(subjectName(subjectId))}" disabled></label>
  <label><span>بخش نمره</span><select id="objComp"><option value="continuous">تکوینی</option><option value="final">پایانی</option></select></label>
  <label class="wide"><span>علت اعتراض</span><textarea id="objReason" required></textarea></label></div>`,async()=>{
    const reason=$("#objReason").value.trim();if(!reason)throw new Error("علت اعتراض را بنویسید.");
    const {error}=await state.sb.from("objections").insert({score_id:scoreId,student_id:state.profile.id,component:$("#objComp").value,reason});if(error)throw error;toast("اعتراض ثبت شد.");
  },"ارسال اعتراض");
}

async function renderTeachers(){
  setPage("معلمان دروس","معلم ثبت‌شده برای هر درس");
  const myClasses=state.classStudents.filter(x=>x.student_id===state.profile.id).map(x=>x.class_id);
  const asg=state.assignments.filter(a=>myClasses.includes(a.class_id));
  const rows=asg.map(a=>`<tr><td>${esc(className(a.class_id))}</td><td>${esc(subjectName(a.subject_id))}</td><td>${esc(userName(a.teacher_id))}</td></tr>`);
  $("#content").innerHTML=`<div class="card">${table(["کلاس","درس","معلم"],rows)}</div>`;
}

async function renderObjections(){
  setPage(state.profile.role==="teacher"?"اعتراضات دانش‌آموزان":"اعتراضات من","پیگیری و رسیدگی به اعتراض نمره");
  let q=state.sb.from("objections").select("*").order("created_at",{ascending:false});
  if(state.profile.role==="student")q=q.eq("student_id",state.profile.id);
  const {data,error}=await q;if(error)throw error;
  const scores={};
  const scoreIds=[...new Set((data||[]).map(o=>o.score_id).filter(Boolean))];
  if(scoreIds.length){
    const {data:scoreRows,error:scoreError}=await state.sb.from("scores").select("*").in("id",scoreIds);
    if(scoreError)throw scoreError;
    (scoreRows||[]).forEach(s=>scores[s.id]=s);
  }
  const visible=(data||[]).filter(o=>{if(state.profile.role!=="teacher")return true;const s=scores[o.score_id];return s&&state.assignments.some(a=>a.teacher_id===state.profile.id&&a.class_id===s.class_id&&a.subject_id===s.subject_id);});
  const rows=visible.map(o=>{const s=scores[o.score_id]||{};const statusClass=o.status==="pending"?"warn":o.status==="rejected"?"danger":"";
    const actions=state.profile.role==="teacher"&&o.status==="pending"?`<div class="actions"><button class="btn btn-primary approve-obj" data-id="${o.id}">تأیید</button><button class="btn btn-ghost danger reject-obj" data-id="${o.id}">رد</button></div>`:"";
    return `<tr><td>${esc(subjectName(s.subject_id))}</td><td>${state.profile.role==="teacher"?esc(userName(o.student_id)):"-"}</td><td>${faComponent[o.component]}</td><td>${esc(o.reason)}</td><td><span class="badge ${statusClass}">${faStatus[o.status]}</span></td><td>${esc(o.teacher_response||"-")}</td><td>${actions}</td></tr>`;});
  $("#content").innerHTML=`<div class="card">${table(["درس","دانش‌آموز","بخش","علت","وضعیت","پاسخ معلم","عملیات"],rows)}</div>`;
  document.querySelectorAll(".approve-obj").forEach(b=>b.onclick=()=>resolveObjection(b.dataset.id,true,scores[visible.find(x=>x.id===b.dataset.id).score_id]));
  document.querySelectorAll(".reject-obj").forEach(b=>b.onclick=()=>resolveObjection(b.dataset.id,false));
}
function resolveObjection(id,approve,score=null){
  if(approve){
    const o=undefined;
    modal("تأیید اعتراض و اصلاح نمره",`<div class="alert alert-info">پس از تأیید باید نمره اصلاح‌شده را ثبت کنید. اگر بخش مربوطه قفل باشد، ابتدا مدیر باید آن را بازگشایی کند.</div><br>
    <label><span>نمره جدید</span><input id="newScore" type="text" inputmode="decimal" min="0" max="20" step=".25"></label><label style="margin-top:12px"><span>توضیح (اختیاری)</span><textarea id="teacherResp"></textarea></label>`,async()=>{
      const {data:obj}=await state.sb.from("objections").select("*").eq("id",id).single();
      const newValue=num($("#newScore").value); if(newValue===null)throw new Error("نمره جدید الزامی است.");
      const current=score|| (await state.sb.from("scores").select("*").eq("id",obj.score_id).single()).data;
      const cont=obj.component==="continuous"?newValue:current.continuous_score, fin=obj.component==="final"?newValue:current.final_score;
      const {error:se}=await state.sb.rpc("save_score",{p_student:current.student_id,p_class:current.class_id,p_subject:current.subject_id,p_period:current.period,p_continuous:cont,p_final:fin});if(se)throw se;
      const {error}=await state.sb.from("objections").update({status:"approved",teacher_response:$("#teacherResp").value.trim()||"اعتراض تأیید و نمره اصلاح شد.",resolved_by:state.profile.id,resolved_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
      toast("اعتراض تأیید و نمره اصلاح شد.");renderObjections();
    },"تأیید و ثبت نمره");
  }else{
    modal("رد اعتراض",`<label><span>علت رد اعتراض</span><textarea id="rejectReason" required></textarea></label>`,async()=>{
      const reason=$("#rejectReason").value.trim();if(!reason)throw new Error("علت رد کردن الزامی است.");
      const {error}=await state.sb.from("objections").update({status:"rejected",teacher_response:reason,resolved_by:state.profile.id,resolved_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
      toast("اعتراض رد شد.");renderObjections();
    },"ثبت رد اعتراض");
  }
}
})();