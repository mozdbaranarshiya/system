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
      if(["password","file","hidden","checkbox","radio"].includes(inp.type))return;
      const next=toFaDigits(inp.value);
      if(next!==inp.value)inp.value=next;
    });
  }
}
function setupPersianDigits(){
  document.addEventListener("input",e=>{
    const el=e.target;
    if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))return;
    if(["password","file","hidden","checkbox","radio"].includes(el.type))return;
    const pos=el.selectionStart, next=toFaDigits(el.value);
    if(next!==el.value){
      el.value=next;
      try{el.setSelectionRange(pos,pos)}catch(_){}
    }
  },true);
  const pendingNodes=new Set();
  let persianizeScheduled=false;
  const flushPersianNodes=()=>{
    persianizeScheduled=false;
    const nodes=[...pendingNodes];
    pendingNodes.clear();
    nodes.forEach(n=>{
      if(!n?.isConnected)return;
      if(n.nodeType===Node.TEXT_NODE){
        const next=toFaDigits(n.nodeValue);
        if(next!==n.nodeValue)n.nodeValue=next;
      }else if(n.nodeType===Node.ELEMENT_NODE){
        persianizeNode(n);
      }
    });
  };
  const observer=new MutationObserver(items=>{
    items.forEach(m=>m.addedNodes.forEach(n=>pendingNodes.add(n)));
    if(!persianizeScheduled){
      persianizeScheduled=true;
      requestAnimationFrame(flushPersianNodes);
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  persianizeNode(document.body);
}
const state = {
  sb: configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null,
  session:null, profile:null, route:"dashboard",
  profiles:[], grades:[], classes:[], subjects:[], assignments:[], classStudents:[], representatives:[],
  refsLoadedAt:0, refsPromise:null, pageCache:new Map()
};
const externalScripts=new Map();
function loadExternalScript(src,globalName){
  if(globalName&&window[globalName])return Promise.resolve(window[globalName]);
  if(externalScripts.has(src))return externalScripts.get(src);
  const promise=new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=src;s.async=true;
    s.onload=()=>resolve(globalName?window[globalName]:true);
    s.onerror=()=>reject(new Error("بارگذاری کتابخانه موردنیاز ناموفق بود."));
    document.head.appendChild(s);
  });
  externalScripts.set(src,promise);
  return promise;
}
async function uploadAssignmentFile(path,file,onProgress=()=>{}){
  if(file.size<=6*1024*1024){
    onProgress(.08);
    const {error}=await state.sb.storage.from("assignment-files").upload(path,file,{
      upsert:false,
      cacheControl:"3600",
      contentType:file.type||"application/octet-stream"
    });
    if(error)throw error;
    onProgress(1);
    return;
  }

  await loadExternalScript("https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js","tus");
  const {data:{session}}=await state.sb.auth.getSession();
  if(!session?.access_token)throw new Error("نشست کاربری معتبر نیست.");

  await new Promise((resolve,reject)=>{
    const upload=new window.tus.Upload(file,{
      endpoint:`${cfg.SUPABASE_URL.replace(/\/$/,"")}/storage/v1/upload/resumable`,
      retryDelays:[0,1000,3000,5000],
      headers:{
        authorization:`Bearer ${session.access_token}`,
        apikey:cfg.SUPABASE_ANON_KEY,
        "x-upsert":"false"
      },
      uploadDataDuringCreation:true,
      removeFingerprintOnSuccess:true,
      chunkSize:6*1024*1024,
      metadata:{
        bucketName:"assignment-files",
        objectName:path,
        contentType:file.type||"application/octet-stream",
        cacheControl:"3600"
      },
      onError:reject,
      onProgress:(sent,total)=>onProgress(total?sent/total:0),
      onSuccess:resolve
    });
    upload.findPreviousUploads().then(prev=>{
      if(prev?.length)upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(()=>upload.start());
  });
}
async function ensureSheetJS(){
  if(window.XLSX)return window.XLSX;
  return loadExternalScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","XLSX");
}


function toast(message, error=false){
  const t=$("#toast"); t.textContent=message; t.className="toast show"+(error?" error":"");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.className="toast",3500);
}
function errText(e){
  const m=e?.message||String(e||"خطای نامشخص");
  const map={ACCESS_DENIED:"دسترسی مجاز نیست.",CONTINUOUS_LOCKED:"نمره تکوینی قفل است.",FINAL_LOCKED:"نمره پایانی قفل است.",
    MANAGER_ONLY:"این عملیات فقط برای مدیر مجاز است.",INVALID_NATIONAL_ID:"کد ملی باید ۱۰ رقم باشد.",
    USER_INACTIVE:"حساب مدیر غیرفعال است.",
    CANNOT_DELETE_SELF:"مدیر نمی‌تواند حساب خودش را حذف کند.",
    DEADLINE_PASSED:"مهلت تحویل این تکلیف به پایان رسیده است.",
    ALREADY_GRADED:"برای این تکلیف نمره نهایی ثبت شده است.",
    FEEDBACK_REQUIRED:"برای وضعیت «نیاز به اصلاح» توضیح دبیر الزامی است.",
    INVALID_FILE_PATH:"مسیر فایل معتبر نیست.",
    INVALID_SCORE:"نمره واردشده معتبر نیست.",
    INVALID_STATUS:"وضعیت انتخاب‌شده معتبر نیست."};
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
async function cachedPage(key,ttl,loader){
  const user=state.profile?.id||"anon", cacheKey=`${user}:${key}`;
  const hit=state.pageCache.get(cacheKey);
  if(hit && Date.now()-hit.at<ttl)return hit.value;
  const value=await loader();
  state.pageCache.set(cacheKey,{at:Date.now(),value});
  return value;
}
function clearPageCache(prefix=""){
  const user=state.profile?.id||"anon", start=`${user}:${prefix}`;
  for(const key of state.pageCache.keys())if(key.startsWith(start))state.pageCache.delete(key);
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
  state.profile=null; state.refsLoadedAt=0; state.pageCache.clear();
  $("#appView").classList.add("hidden");$("#loginView").classList.remove("hidden");
}
async function enterApp(){
  const {data,error}=await state.sb.from("profiles").select("*").eq("id",state.session.user.id).single();
  if(error||!data?.active){await state.sb.auth.signOut();return toast("حساب کاربری فعال نیست.",true);}
  state.profile=data;
  $("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");
  $("#userName").textContent=data.full_name;
  $("#avatar").textContent=(data.full_name||"ک").trim().charAt(0);
  await refreshRefs();
  if(data.role==="student"){
    const repClasses=state.representatives
      .filter(r=>r.student_id===data.id)
      .map(r=>byId(state.classes,r.class_id)?.title||className(r.class_id))
      .filter(Boolean);
    $("#userRole").textContent=repClasses.length
      ? `نماینده کلاس (${repClasses.join("، ")})`
      : faRole[data.role];
  }else{
    $("#userRole").textContent=faRole[data.role];
  }
  buildNav(); navigate("dashboard");
}
function buildNav(){
  const studentMenu=[
    ["dashboard","داشبورد"],["report","کارنامه من"],["homework","تکالیف"],
    ["groups","گروه من"],["announcements","اطلاعیه‌ها"],["teachers","معلمان دروس"],["objections","اعتراضات من"]
  ];
  if(state.representatives.some(r=>r.student_id===state.profile.id)) studentMenu.splice(4,0,["discipline","ثبت انضباط"]);
  const menus={
    manager:[["dashboard","داشبورد"],["users","کاربران"],["structure","پایه، کلاس و درس"],["assignments","تخصیص‌ها و نماینده"],["scores","ثبت و قفل نمرات"],["homeworkGrades","نمرات تکالیف"],["excel","ورود از اکسل"],["announcements","اطلاعیه‌ها"],["settings","تنظیمات سامانه"]],
    teacher:[["dashboard","داشبورد"],["scores","ثبت نمرات"],["homework","تکالیف"],["groups","گروه‌های کلاسی"],["announcements","اطلاعیه‌ها"],["objections","اعتراضات"]],
    student:studentMenu
  };
  $("#mainNav").innerHTML=menus[state.profile.role].map(([r,t])=>`<button class="nav-btn" data-route="${r}">${t}</button>`).join("");
  $("#mainNav").querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.route));
}
async function refreshRefs(force=false){
  const maxAge=60000;
  if(!force && state.refsLoadedAt && Date.now()-state.refsLoadedAt<maxAge) return;
  if(state.refsPromise){
    await state.refsPromise;
    if(!force && Date.now()-state.refsLoadedAt<maxAge) return;
  }

  const queries=[
    ["profiles","profiles","id,national_id,full_name,role,active","full_name"],
    ["grades","grade_levels","id,title,sort_order","sort_order"],
    ["classes","classes","id,grade_id,title,academic_year","title"],
    ["subjects","subjects","id,grade_id,title","title"],
    ["assignments","teacher_assignments","id,teacher_id,class_id,subject_id","id"],
    ["classStudents","class_students","class_id,student_id","class_id"],
    ["representatives","class_representatives","class_id,student_id","class_id"]
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
    if(route==="homeworkGrades")return renderManagerHomeworkGrades();
    if(route==="excel")return renderExcelImport();
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
function gradeModal(g=null){modal(g?"ویرایش پایه":"پایه جدید",`<div class="form-grid"><label><span>عنوان پایه</span><input id="gTitle" value="${esc(g?.title||"")}"></label><label><span>ترتیب</span><input id="gSort" type="text" inputmode="decimal" value="${g?.sort_order??0}"></label></div>`,async()=>{const payload={title:$("#gTitle").value.trim(),sort_order:Number(toEnDigits($("#gSort").value||0))};const q=g?state.sb.from("grade_levels").update(payload).eq("id",g.id):state.sb.from("grade_levels").insert(payload);const {error}=await q;if(error)throw error;await refreshRefs(true);renderStructure();});}
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
  <label><span>دوره</span><select id="scorePeriod"><option value="نوبت اول">نوبت اول</option><option value="نوبت دوم">نوبت دوم</option></select></label><button class="btn btn-primary" id="loadScores">نمایش دانش‌آموزان</button></div></div><div id="scoreArea"></div>`;
  $("#loadScores").onclick=loadScoreGrid; await loadScoreGrid();
}
async function loadScoreGrid(){
  const [classId,subjectId]=($("#scoreCourse").value||"|").split("|"), period=$("#scorePeriod").value||"نوبت اول";
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
  document.querySelectorAll("#scoreArea tbody input").forEach(inp=>inp.addEventListener("input",e=>{const tr=e.target.closest("tr"),a=tr.querySelector(".cont").value,b=tr.querySelector(".fin").value;tr.querySelector(".score-summary").textContent=(a!==""&&b!=="")?((Number(toEnDigits(a))+Number(toEnDigits(b)))/2).toFixed(2):"-";}));
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
  const canCreate=["manager","teacher"].includes(state.profile.role);
  setPage("اطلاعیه‌ها",state.profile.role==="manager"?"ارسال گروهی یا انفرادی":state.profile.role==="teacher"?"ارسال برای دانش‌آموزان، کلاس‌ها و گروه‌های خود":"اطلاعیه‌های دریافتی");
  const {data,error}=await state.sb.from("announcements").select("*").order("created_at",{ascending:false});
  if(error)throw error;
  const add=canCreate?'<button class="btn btn-primary" id="addAnn">+ اطلاعیه جدید</button>':"";
  $("#content").innerHTML=`<div class="card"><div class="panel-head"><h3>اطلاعیه‌ها</h3>${add}</div><br>
  ${(data||[]).length?(data||[]).map(a=>`<article class="announcement"><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p><small class="muted">${new Intl.DateTimeFormat("fa-IR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(a.created_at))}</small></article>`).join(""):'<div class="empty">اطلاعیه‌ای وجود ندارد.</div>'}</div>`;
  if($("#addAnn"))$("#addAnn").onclick=announcementModal;
}
async function announcementModal(){
  const isTeacher=state.profile.role==="teacher";
  let teacherGroups=[],teacherClassIds=[],teacherStudents=[];
  if(isTeacher){
    teacherClassIds=[...new Set(state.assignments.filter(a=>a.teacher_id===state.profile.id).map(a=>a.class_id))];
    teacherStudents=state.profiles.filter(p=>p.role==="student"&&state.classStudents.some(cs=>cs.student_id===p.id&&teacherClassIds.includes(cs.class_id)));
    const {data,error}=await state.sb.from("student_groups").select("id,name,class_id,subject_id").eq("teacher_id",state.profile.id).order("name");
    if(error)return toast(errText(error),true);
    teacherGroups=data||[];
  }
  const classes=isTeacher?state.classes.filter(x=>teacherClassIds.includes(x.id)):state.classes;
  const users=isTeacher?teacherStudents:state.profiles.filter(p=>p.role!=="manager");
  const typeOptions=isTeacher
    ? '<option value="class">یک کلاس</option><option value="group">یک گروه</option><option value="user">یک دانش‌آموز</option>'
    : '<option value="all">همه</option><option value="role">گروه نقش</option><option value="class">یک کلاس</option><option value="user">یک شخص</option>';
  modal("اطلاعیه جدید",`<div class="form-grid">
    <label class="wide"><span>عنوان</span><input id="anTitle"></label>
    <label class="wide"><span>متن اطلاعیه</span><textarea id="anBody"></textarea></label>
    <label><span>نوع گیرنده</span><select id="anType">${typeOptions}</select></label>
    ${!isTeacher?'<label><span>نقش</span><select id="anRole"><option value="teacher">معلمان</option><option value="student">دانش‌آموزان</option></select></label>':""}
    <label><span>کلاس</span><select id="anClass"><option value="">-</option>${classes.map(x=>`<option value="${x.id}">${esc(className(x.id))}</option>`).join("")}</select></label>
    ${isTeacher?`<label><span>گروه</span><select id="anGroup"><option value="">-</option>${teacherGroups.map(g=>`<option value="${g.id}">${esc(g.name)} — ${esc(className(g.class_id))}</option>`).join("")}</select></label>`:""}
    <label class="wide"><span>${isTeacher?"دانش‌آموز":"شخص"}</span><select id="anUser"><option value="">-</option>${users.map(p=>`<option value="${p.id}">${esc(p.full_name)}${isTeacher?"":" - "+faRole[p.role]}</option>`).join("")}</select></label>
  </div>`,async()=>{
    const type=$("#anType").value;
    const p={
      title:$("#anTitle").value.trim(),
      body:$("#anBody").value.trim(),
      target_type:type,
      created_by:state.profile.id,
      target_role:null,target_class_id:null,target_user_id:null,target_group_id:null
    };
    if(type==="role")p.target_role=$("#anRole")?.value||null;
    if(type==="class")p.target_class_id=$("#anClass").value||null;
    if(type==="user")p.target_user_id=$("#anUser").value||null;
    if(type==="group")p.target_group_id=$("#anGroup").value||null;
    if(!p.title||!p.body)throw new Error("عنوان و متن اطلاعیه الزامی است.");
    if(type!=="all"&&!p.target_role&&!p.target_class_id&&!p.target_user_id&&!p.target_group_id)throw new Error("گیرنده اطلاعیه را انتخاب کنید.");
    const {error}=await state.sb.from("announcements").insert(p);
    if(error)throw error;
    toast("اطلاعیه ارسال شد.");
    renderAnnouncements();
  },"ارسال");
}

async function renderReport(){
  setPage("کارنامه من","کارنامه سال تحصیلی بر اساس الگوی رسمی");
  const {data:settings,error:settingsError}=await state.sb.from("school_settings").select("objections_open,report_cards_open").eq("id",true).maybeSingle();
  if(settingsError)throw settingsError;
  if(state.profile.role==="student"&&settings?.report_cards_open===false){
    $("#content").innerHTML='<div class="card report-closed"><div class="setting-icon">▤</div><h3>نمایش کارنامه غیرفعال است</h3><p class="muted">مدیر مدرسه در حال حاضر امکان مشاهده کارنامه را بسته است.</p></div>';
    return;
  }
  const myClassLink=state.classStudents.find(x=>x.student_id===state.profile.id);
  const myClass=myClassLink?byId(state.classes,myClassLink.class_id):null;
  const grade=myClass?byId(state.grades,myClass.grade_id):null;

  const [{data:scores,error:scoreError},{data:discipline,error:disciplineError}]=await Promise.all([
    state.sb.from("scores").select("*").eq("student_id",state.profile.id).order("period"),
    state.sb.from("discipline_scores").select("*").eq("student_id",state.profile.id)
  ]);
  if(scoreError)throw scoreError;
  if(disciplineError)throw disciplineError;

  const subjects=grade?state.subjects.filter(s=>s.grade_id===grade.id):[...new Set((scores||[]).map(s=>s.subject_id))].map(id=>byId(state.subjects,id)).filter(Boolean);
  const scoreFor=(sid,needle)=>(scores||[]).find(s=>s.subject_id===sid&&String(s.period||"").includes(needle));
  const values=[];

  const rows=subjects.map((sub,i)=>{
    const p1=scoreFor(sub.id,"اول")||{}, p2=scoreFor(sub.id,"دوم")||{};
    const lesson1=p1.lesson_score==null?null:Number(p1.lesson_score);
    const lesson2=p2.lesson_score==null?null:Number(p2.lesson_score);
    const annual=lesson1!=null&&lesson2!=null?(lesson1+lesson2)/2:null;
    if(annual!=null)values.push(annual);
    const status=annual==null?"-":annual>=10?"قبول":"نیاز به تلاش";
    const objectionScore=p2.id||p1.id;
    const objectionSubject=sub.id;
    return `<tr>
      <td>${i+1}</td><td class="subject-cell">${esc(sub.title)}</td>
      <td>${p1.continuous_score??"-"}</td><td>${p1.final_score??"-"}</td><td class="term-score">${lesson1==null?"-":lesson1.toFixed(2)}</td>
      <td>${p2.continuous_score??"-"}</td><td>${p2.final_score??"-"}</td><td class="term-score">${lesson2==null?"-":lesson2.toFixed(2)}</td>
      <td class="annual-score">${annual==null?"-":annual.toFixed(2)}</td>
      <td><span class="badge ${annual!=null&&annual<10?"warn":""}">${status}</span></td>
      <td class="no-print">${objectionScore?`<button class="btn btn-ghost obj-btn" data-id="${objectionScore}" data-subject="${objectionSubject}" ${settings?.objections_open?"":"disabled"}>اعتراض</button>`:"-"}</td>
    </tr>`;
  }).join("");

  const average=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const disciplineScore=(discipline||[])[0]?.score;
  const disciplineText=disciplineScore?disciplineLabels[disciplineScore]:"ثبت نشده";

  $("#content").innerHTML=`
    <div class="report-actions no-print">
      <div class="alert ${settings?.objections_open?"alert-info":"alert-warning"}">
        ${settings?.objections_open?"ثبت اعتراض توسط مدیر فعال است.":"ثبت اعتراض در حال حاضر توسط مدیر بسته است."}
      </div>
      <button class="btn btn-primary" id="printReport">چاپ کارنامه</button>
    </div>
    <section class="report-sheet">
      <div class="report-title">
        <div class="report-emblem">ا</div>
        <div><h2>کارنامه تحصیلی دانش‌آموز</h2><p>سامانه آموزش و پرورش استان اصفهان</p></div>
        <div class="report-year">سال تحصیلی<br><strong>${esc(myClass?.academic_year||"-")}</strong></div>
      </div>
      <div class="report-meta">
        <span><b>نام دانش‌آموز:</b> ${esc(state.profile.full_name)}</span>
        <span><b>کد ملی:</b> ${esc(state.profile.national_id)}</span>
        <span><b>پایه:</b> ${esc(grade?.title||"-")}</span>
        <span><b>کلاس:</b> ${esc(myClass?.title||"-")}</span>
      </div>
      <div class="table-wrap report-table-wrap">
        <table class="report-table">
          <thead>
            <tr>
              <th rowspan="2">ردیف</th><th rowspan="2">نام درس</th>
              <th colspan="3">نوبت اول</th><th colspan="3">نوبت دوم</th>
              <th rowspan="2">نمره سالانه</th><th rowspan="2">وضعیت</th><th rowspan="2" class="no-print">اعتراض</th>
            </tr>
            <tr><th>تکوینی</th><th>پایانی</th><th>نمره درس</th><th>تکوینی</th><th>پایانی</th><th>نمره درس</th></tr>
          </thead>
          <tbody>${rows||'<tr><td colspan="11" class="empty">هنوز نمره‌ای ثبت نشده است.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="report-summary">
        <div><small>معدل</small><strong>${average==null?"-":average.toFixed(2)}</strong></div>
        <div><small>انضباط</small><strong>${esc(disciplineText)}</strong></div>
        <div><small>نتیجه</small><strong>${average==null?"-":average>=10?"قبول":"نیاز به تلاش"}</strong></div>
      </div>
      <div class="report-signatures"><span>امضای مدیر مدرسه</span><span>امضای ولی دانش‌آموز</span></div>
    </section>`;

  $("#printReport").onclick=()=>window.print();
  document.querySelectorAll(".obj-btn").forEach(b=>b.onclick=()=>studentObjectionModal(b.dataset.id,b.dataset.subject));
}

async function studentObjectionModal(scoreId,subjectId){
  const {data:settings,error}=await state.sb.from("school_settings").select("objections_open").eq("id",true).single();
  if(error)throw error;
  if(!settings?.objections_open)return toast("ثبت اعتراض توسط مدیر بسته است.",true);

  modal("ثبت اعتراض",`<div class="form-grid"><label><span>درس</span><input value="${esc(subjectName(subjectId))}" disabled></label>
  <label><span>بخش نمره</span><select id="objComp"><option value="continuous">تکوینی</option><option value="final">پایانی</option></select></label>
  <label class="wide"><span>علت اعتراض</span><textarea id="objReason" required></textarea></label></div>`,async()=>{
    const reason=$("#objReason").value.trim();if(!reason)throw new Error("علت اعتراض را بنویسید.");
    const {error}=await state.sb.from("objections").insert({score_id:scoreId,student_id:state.profile.id,component:$("#objComp").value,reason});
    if(error)throw error;toast("اعتراض ثبت شد.");
  },"ارسال اعتراض");
}


async function renderSettings(){
  setPage("تنظیمات سامانه","کنترل امکانات عمومی برای دانش‌آموزان");
  const {data,error}=await state.sb.from("school_settings").select("*").eq("id",true).single();
  if(error)throw error;
  $("#content").innerHTML=`
    <div class="settings-grid">
      <div class="card setting-card">
        <div><span class="setting-icon">!</span><div><h3>ثبت اعتراض به نمره</h3><p class="muted">وقتی بسته باشد، دانش‌آموز امکان ارسال اعتراض جدید ندارد.</p></div></div>
        <label class="switch"><input id="objectionSwitch" type="checkbox" ${data.objections_open?"checked":""}><span></span></label>
      </div>
      <div class="card setting-card">
        <div><span class="setting-icon">▤</span><div><h3>مشاهده کارنامه</h3><p class="muted">نمایش یا مخفی‌کردن کارنامه برای همه دانش‌آموزان.</p></div></div>
        <label class="switch"><input id="reportSwitch" type="checkbox" ${data.report_cards_open!==false?"checked":""}><span></span></label>
      </div>
      <div class="card settings-status-card">
        <h3>وضعیت سامانه</h3>
        <div class="pill-row">
          <span class="badge ${data.objections_open?"":"warn"}">${data.objections_open?"اعتراض فعال":"اعتراض بسته"}</span>
          <span class="badge ${data.report_cards_open!==false?"":"warn"}">${data.report_cards_open!==false?"کارنامه فعال":"کارنامه بسته"}</span>
        </div>
      </div>
    </div>`;
  const updateSetting=async(field,value,input,messageOn,messageOff)=>{
    const {error}=await state.sb.from("school_settings").update({
      [field]:value,updated_at:new Date().toISOString(),updated_by:state.profile.id
    }).eq("id",true);
    if(error){input.checked=!value;return toast(errText(error),true)}
    toast(value?messageOn:messageOff);
    renderSettings();
  };
  $("#objectionSwitch").onchange=e=>updateSetting("objections_open",e.target.checked,e.target,"ثبت اعتراض فعال شد.","ثبت اعتراض بسته شد.");
  $("#reportSwitch").onchange=e=>updateSetting("report_cards_open",e.target.checked,e.target,"نمایش کارنامه فعال شد.","نمایش کارنامه برای دانش‌آموزان بسته شد.");
}

async function renderDiscipline(){
  setPage("ثبت انضباط","ویژه نماینده کلاس؛ ۱ عالی تا ۵ نیاز به تلاش");
  const myReps=state.representatives.filter(r=>r.student_id===state.profile.id);
  if(!myReps.length){
    $("#content").innerHTML='<div class="card empty">شما به عنوان نماینده هیچ کلاسی ثبت نشده‌اید.</div>';
    return;
  }
  const classIds=myReps.map(r=>r.class_id);
  const {data:existing,error}=await state.sb.from("discipline_scores").select("*").in("class_id",classIds);
  if(error)throw error;
  const scoreMap=new Map((existing||[]).map(x=>[`${x.class_id}|${x.student_id}`,x]));
  const cards=myReps.map(rep=>{
    const students=state.classStudents.filter(x=>x.class_id===rep.class_id).map(x=>byId(state.profiles,x.student_id)).filter(Boolean);
    const rows=students.map(st=>{
      const old=scoreMap.get(`${rep.class_id}|${st.id}`);
      return `<tr data-class="${rep.class_id}" data-student="${st.id}"><td>${esc(st.full_name)}</td>
        <td><input class="discipline-input" inputmode="numeric" maxlength="1" value="${old?.score??""}" placeholder="۱ تا ۵"></td>
        <td class="discipline-label">${old?.score?disciplineLabels[old.score]:"-"}</td>
        <td><input class="discipline-note" value="${esc(old?.note||"")}" placeholder="توضیح اختیاری"></td></tr>`;
    }).join("");
    return `<div class="card discipline-card"><div class="panel-head"><div><h3>${esc(className(rep.class_id))}</h3><p class="muted">عدد انضباط را برای هر دانش‌آموز وارد کنید.</p></div><button class="btn btn-primary save-discipline" data-class="${rep.class_id}">ذخیره انضباط</button></div>
      <div class="discipline-legend">${Object.entries(disciplineLabels).map(([n,t])=>`<span><b>${n}</b> ${t}</span>`).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>عدد</th><th>وضعیت</th><th>توضیح</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }).join("");
  $("#content").innerHTML=cards;
  document.querySelectorAll(".discipline-input").forEach(inp=>inp.addEventListener("input",()=>{
    const n=Number(toEnDigits(inp.value)); inp.closest("tr").querySelector(".discipline-label").textContent=disciplineLabels[n]||"-";
  }));
  document.querySelectorAll(".save-discipline").forEach(btn=>btn.onclick=async()=>{
    const classId=btn.dataset.class;
    const rows=[...document.querySelectorAll(`tr[data-class="${classId}"]`)];
    const payload=[];
    for(const tr of rows){
      const raw=toEnDigits(tr.querySelector(".discipline-input").value.trim());
      if(!raw)continue;
      const score=Number(raw);
      if(!Number.isInteger(score)||score<1||score>5)throw new Error("نمره انضباط باید عددی بین ۱ تا ۵ باشد.");
      payload.push({class_id:classId,student_id:tr.dataset.student,score,note:tr.querySelector(".discipline-note").value.trim()||null,updated_by:state.profile.id,updated_at:new Date().toISOString()});
    }
    if(!payload.length)return toast("حداقل یک نمره انضباط وارد کنید.",true);
    const {error}=await state.sb.from("discipline_scores").upsert(payload,{onConflict:"class_id,student_id"});
    if(error)return toast(errText(error),true);
    toast("نمرات انضباط ذخیره شد.");
  });
}

function homeworkStatusBadge(status){
  const map={pending:["در انتظار بررسی","info"],graded:["نمره ثبت شده",""],needs_revision:["نیاز به اصلاح","warn"]};
  const [text,cls]=map[status]||["ارسال نشده",""];
  return `<span class="badge ${cls}">${text}</span>`;
}

async function renderHomework(){
  setPage("تکالیف",state.profile.role==="teacher"?"تعریف تکلیف، فایل‌های ارسالی و ارزیابی":"مشاهده تکالیف و ارسال فایل");
  if(state.profile.role==="teacher")return renderTeacherHomework();
  if(state.profile.role==="student")return renderStudentHomework();
  $("#content").innerHTML='<div class="card empty">این بخش برای معلم و دانش‌آموز است.</div>';
}

async function renderTeacherHomework(){
  const {tasks,groups,submissions}=await cachedPage("homework:teacher",20000,async()=>{
    const [{data:tasks,error},{data:groups,error:groupsError}]=await Promise.all([
      state.sb.from("assignments").select("id,teacher_id,class_id,subject_id,group_id,title,description,due_at,created_at").order("created_at",{ascending:false}),
      state.sb.from("student_groups").select("id,teacher_id,class_id,subject_id,name,leader_id").order("name")
    ]);
    if(error)throw error;
    if(groupsError)throw groupsError;
    const ids=(tasks||[]).map(x=>x.id);
    let submissions=[];
    if(ids.length){
      const r=await state.sb.from("assignment_submissions").select("id,assignment_id,student_id,status,score,submitted_at").in("assignment_id",ids).order("submitted_at",{ascending:false});
      if(r.error)throw r.error;
      submissions=r.data||[];
    }
    return {tasks:tasks||[],groups:groups||[],submissions};
  });
  const cards=(tasks||[]).map(t=>{
    const group=t.group_id?(groups||[]).find(g=>g.id===t.group_id):null;
    const subs=submissions.filter(s=>s.assignment_id===t.id);
    return `<article class="homework-card">
      <div class="homework-top"><div><span class="badge info">${group?"گروهی":"کلاسی"}</span><h3>${esc(t.title)}</h3><p>${esc(t.description||"بدون توضیح")}</p></div>
      <div class="deadline-box"><small>مهلت</small><strong>${faDateTime(t.due_at)}</strong></div></div>
      <div class="homework-meta"><span>${esc(className(t.class_id))}</span><span>${esc(subjectName(t.subject_id))}</span>${group?`<span>گروه: ${esc(group.name)}</span>`:""}<span>ارسال‌ها: ${subs.length}</span></div>
      <div class="actions"><button class="btn btn-primary show-submissions" data-id="${t.id}">مشاهده ارسال‌ها</button><button class="btn btn-ghost del-homework" data-id="${t.id}">حذف تکلیف</button></div>
    </article>`;
  }).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>تکالیف تعریف‌شده</h3><p class="muted">تکلیف برای کل کلاس یا یک گروه خاص قابل ثبت است.</p></div><div class="actions"><button class="btn btn-ghost" id="homeworkAverages">معدل تکالیف</button><button class="btn btn-primary" id="newHomework">+ تکلیف جدید</button></div></div>
    <div class="homework-grid">${cards||'<div class="card empty">هنوز تکلیفی ثبت نشده است.</div>'}</div>`;
  $("#newHomework").onclick=openHomeworkModal;
  $("#homeworkAverages").onclick=showHomeworkAverages;
  document.querySelectorAll(".show-submissions").forEach(b=>b.onclick=()=>showHomeworkSubmissions(b.dataset.id));
  document.querySelectorAll(".del-homework").forEach(b=>b.onclick=async()=>{
    if(!confirm("این تکلیف و ارسال‌های وابسته حذف شود؟"))return;
    const {error}=await state.sb.from("assignments").delete().eq("id",b.dataset.id);
    if(error)return toast(errText(error),true); clearPageCache("homework:"); toast("تکلیف حذف شد.");renderHomework();
  });
}

async function openHomeworkModal(){
  const teaching=state.assignments.filter(a=>a.teacher_id===state.profile.id);
  if(!teaching.length)return toast("ابتدا باید کلاس و درس توسط مدیر به شما تخصیص داده شود.",true);
  const {data:groups,error}=await state.sb.from("student_groups").select("*").eq("teacher_id",state.profile.id).order("name");
  if(error)throw error;
  const defaultCourse=`${teaching[0].class_id}|${teaching[0].subject_id}`;
  modal("تکلیف جدید",`<div class="form-grid">
    <label><span>کلاس و درس</span><select id="hwCourse">${teaching.map(a=>`<option value="${a.class_id}|${a.subject_id}">${esc(className(a.class_id))} — ${esc(subjectName(a.subject_id))}</option>`).join("")}</select></label>
    <label><span>نوع تکلیف</span><select id="hwTarget"><option value="class">کل کلاس</option><option value="group">یک گروه</option></select></label>
    <label id="hwGroupWrap" class="wide hidden"><span>گروه</span><select id="hwGroup"></select></label>
    <label class="wide"><span>عنوان تکلیف</span><input id="hwTitle" required></label>
    <label class="wide"><span>توضیحات</span><textarea id="hwDescription"></textarea></label>
    <div class="wide"><span class="field-title">مهلت تحویل (تقویم شمسی)</span><div id="duePicker" class="jalali-picker"></div><input id="hwDueIso" type="hidden"></div>
  </div>`,async()=>{
    const [class_id,subject_id]=$("#hwCourse").value.split("|");
    const group_id=$("#hwTarget").value==="group"?$("#hwGroup").value:null;
    if($("#hwTarget").value==="group"&&!group_id)throw new Error("گروه را انتخاب کنید.");
    const title=$("#hwTitle").value.trim(), due_at=$("#hwDueIso").value;
    if(!title||!due_at)throw new Error("عنوان و مهلت تکلیف الزامی است.");
    const {error}=await state.sb.from("assignments").insert({
      teacher_id:state.profile.id,class_id,subject_id,group_id,title,
      description:$("#hwDescription").value.trim()||null,due_at
    });
    if(error)throw error; clearPageCache("homework:"); toast("تکلیف ثبت شد.");renderHomework();
  },"ثبت تکلیف");
  const refreshGroups=()=>{
    const [c,s]=$("#hwCourse").value.split("|");
    const list=(groups||[]).filter(g=>g.class_id===c&&g.subject_id===s);
    $("#hwGroup").innerHTML=list.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("");
    if($("#hwTarget").value==="group"&&!list.length)toast("برای این کلاس و درس هنوز گروهی ساخته نشده است.",true);
  };
  $("#hwCourse").onchange=refreshGroups;
  $("#hwTarget").onchange=()=>{$("#hwGroupWrap").classList.toggle("hidden",$("#hwTarget").value!=="group");refreshGroups()};
  refreshGroups();
  mountJalaliPicker("duePicker","hwDueIso",new Date(Date.now()+24*60*60*1000));
}

async function renderStudentHomework(){
  const {tasks,subs}=await cachedPage("homework:student",20000,async()=>{
    const [{data:tasks,error},{data:subs,error:subsError}]=await Promise.all([
      state.sb.from("assignments").select("id,class_id,subject_id,group_id,title,description,due_at,created_at").order("due_at",{ascending:true}),
      state.sb.from("assignment_submissions").select("id,assignment_id,student_id,file_path,original_name,status,score,feedback,attempt,submitted_at").eq("student_id",state.profile.id)
    ]);
    if(error)throw error;
    if(subsError)throw subsError;
    return {tasks:tasks||[],subs:subs||[]};
  });
  const subMap=new Map((subs||[]).map(s=>[s.assignment_id,s]));
  const cards=(tasks||[]).map(t=>{
    const sub=subMap.get(t.id);
    const late=new Date()>new Date(t.due_at);
    const canSend=!sub? !late : sub.status==="needs_revision" || (sub.status==="pending"&&!late);
    return `<article class="homework-card student-homework">
      <div class="homework-top"><div><h3>${esc(t.title)}</h3><p>${esc(t.description||"بدون توضیح")}</p></div><div class="deadline-box ${late?"late":""}"><small>مهلت</small><strong>${faDateTime(t.due_at)}</strong></div></div>
      <div class="homework-meta"><span>${esc(className(t.class_id))}</span><span>${esc(subjectName(t.subject_id))}</span><span>${homeworkStatusBadge(sub?.status)}</span></div>
      ${sub?.feedback?`<div class="feedback-box"><b>بازخورد دبیر:</b> ${esc(sub.feedback)}</div>`:""}
      ${sub?.status==="graded"?`<div class="assignment-score">نمره: <strong>${sub.score}/۲۰</strong></div>`:""}
      <div class="actions">${canSend?`<button class="btn btn-primary submit-homework" data-id="${t.id}">${sub?.status==="needs_revision"?"ارسال نسخه اصلاح‌شده":sub?"ارسال مجدد":"ارسال فایل"}</button>`:""}
      ${sub?`<button class="btn btn-ghost open-file" data-path="${esc(sub.file_path)}">مشاهده فایل ارسالی</button>`:""}</div>
      ${late&&!sub?'<small class="danger">مهلت تحویل به پایان رسیده است.</small>':""}
    </article>`;
  }).join("");
  $("#content").innerHTML=`<div class="homework-grid">${cards||'<div class="card empty">تکلیفی برای شما ثبت نشده است.</div>'}</div>`;
  document.querySelectorAll(".submit-homework").forEach(b=>b.onclick=()=>{
    const task=(tasks||[]).find(x=>x.id===b.dataset.id); openStudentSubmission(task,subMap.get(task.id));
  });
  document.querySelectorAll(".open-file").forEach(b=>b.onclick=()=>openStoredFile(b.dataset.path));
}

function openStudentSubmission(task,existing){
  let uploaded=null;
  let uploading=false;

  modal(existing?"ارسال مجدد تکلیف":"ارسال تکلیف",`
    <div class="submission-uploader">
      <h3>${esc(task.title)}</h3>
      <p class="muted">ابتدا فایل را از دایره زیر انتخاب کنید. پس از آپلود موفق، دکمه «ارسال تکلیف» فعال می‌شود.</p>

      <input id="hwFile" class="upload-file-input" type="file" hidden>
      <label for="hwFile" id="uploadCircle" class="upload-circle" tabindex="0">
        <span class="upload-circle-icon" id="uploadCircleIcon">↑</span>
        <strong id="uploadCircleTitle">انتخاب فایل</strong>
        <small id="uploadCircleHint">برای انتخاب فایل کلیک کنید</small>
      </label>

      <div class="upload-file-info" id="uploadFileInfo">
        <span id="uploadFileName">فایلی انتخاب نشده است</span>
        <span id="uploadFileSize"></span>
      </div>
      <div class="upload-progress-track" aria-hidden="true"><span id="uploadProgressBar"></span></div>
      <div id="uploadState" class="upload-state">حداکثر حجم فایل: ۲۰ مگابایت</div>
    </div>`,async()=>{
      if(uploading)throw new Error("آپلود فایل هنوز تمام نشده است.");
      if(!uploaded)throw new Error("ابتدا فایل را آپلود کنید.");

      const {error}=await state.sb.rpc("submit_assignment",{
        p_assignment:task.id,
        p_file_path:uploaded.path,
        p_original_name:uploaded.name
      });

      if(error){
        await state.sb.storage.from("assignment-files").remove([uploaded.path]);
        uploaded=null;
        setUploadState("error","ارسال ثبت نشد؛ فایل موقت حذف شد. دوباره تلاش کنید.");
        $("#modalSubmit").disabled=true;
        throw error;
      }

      if(existing?.file_path && existing.file_path!==uploaded.path){
        await state.sb.storage.from("assignment-files").remove([existing.file_path]);
      }
      clearPageCache("homework:");
      toast(existing?"تکلیف اصلاح‌شده ارسال شد.":"تکلیف با موفقیت ارسال شد.");
      renderHomework();
    },"ارسال تکلیف");

  const submitBtn=$("#modalSubmit");
  submitBtn.disabled=true;

  const fileInput=$("#hwFile");
  const circle=$("#uploadCircle");
  const icon=$("#uploadCircleIcon");
  const title=$("#uploadCircleTitle");
  const hint=$("#uploadCircleHint");
  const nameEl=$("#uploadFileName");
  const sizeEl=$("#uploadFileSize");
  const progress=$("#uploadProgressBar");
  const stateEl=$("#uploadState");

  function formatBytes(bytes){
    if(bytes<1024)return `${bytes} بایت`;
    if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} کیلوبایت`;
    return `${(bytes/(1024*1024)).toFixed(1)} مگابایت`;
  }

  function setUploadState(mode,message){
    circle.classList.remove("is-uploading","is-uploaded","is-error");
    stateEl.className="upload-state";
    if(mode==="uploading"){
      circle.classList.add("is-uploading");
      stateEl.classList.add("uploading");
      icon.textContent="↻";
      title.textContent="در حال آپلود";
      hint.textContent="لطفاً منتظر بمانید";
      progress.style.width="55%";
    }else if(mode==="success"){
      circle.classList.add("is-uploaded");
      stateEl.classList.add("success");
      icon.textContent="✓";
      title.textContent="آپلود شد";
      hint.textContent="برای تعویض فایل دوباره کلیک کنید";
      progress.style.width="100%";
    }else if(mode==="error"){
      circle.classList.add("is-error");
      stateEl.classList.add("error");
      icon.textContent="!";
      title.textContent="آپلود ناموفق";
      hint.textContent="برای تلاش دوباره کلیک کنید";
      progress.style.width="0%";
    }else{
      icon.textContent="↑";
      title.textContent="انتخاب فایل";
      hint.textContent="برای انتخاب فایل کلیک کنید";
      progress.style.width="0%";
    }
    stateEl.textContent=message;
  }

  circle.addEventListener("keydown",e=>{
    if(e.key==="Enter"||e.key===" "){e.preventDefault();fileInput.click();}
  });

  fileInput.onchange=async()=>{
    const file=fileInput.files?.[0];
    if(!file)return;

    if(file.size>20*1024*1024){
      fileInput.value="";
      uploaded=null;
      submitBtn.disabled=true;
      nameEl.textContent="فایلی انتخاب نشده است";
      sizeEl.textContent="";
      setUploadState("error","حجم فایل نباید بیشتر از ۲۰ مگابایت باشد.");
      return;
    }

    if(uploading)return;
    uploading=true;
    submitBtn.disabled=true;
    nameEl.textContent=file.name;
    sizeEl.textContent=formatBytes(file.size);
    setUploadState("uploading","فایل در حال انتقال به سامانه است…");

    if(uploaded?.path){
      await state.sb.storage.from("assignment-files").remove([uploaded.path]);
      uploaded=null;
    }

    const rawExt=(file.name.split(".").pop()||"").toLowerCase();
    const safeExt=/^[a-z0-9]{1,10}$/.test(rawExt)?`.${rawExt}`:"";
    const path=`${state.profile.id}/${task.id}/${crypto.randomUUID()}${safeExt}`;

    try{
      await uploadAssignmentFile(path,file,p=>{
        const pct=Math.max(5,Math.min(100,Math.round(p*100)));
        progress.style.width=`${pct}%`;
        stateEl.textContent=`در حال آپلود… ${toFaDigits(pct)}٪`;
      });

      uploaded={path,name:file.name};
      setUploadState("success","آپلود کامل شد. اکنون روی «ارسال تکلیف» بزنید.");
      submitBtn.disabled=false;
    }catch(e){
      uploaded=null;
      fileInput.value="";
      submitBtn.disabled=true;
      setUploadState("error",errText(e));
      toast(errText(e),true);
    }finally{
      uploading=false;
    }
  };
}

async function openStoredFile(path){
  const {data,error}=await state.sb.storage.from("assignment-files").createSignedUrl(path,120);
  if(error)return toast(errText(error),true);
  window.open(data.signedUrl,"_blank","noopener");
}

async function showHomeworkSubmissions(assignmentId){
  const {data,error}=await state.sb.from("assignment_submissions").select("*").eq("assignment_id",assignmentId).order("submitted_at",{ascending:false});
  if(error)throw error;
  const rows=(data||[]).map(s=>`<tr><td>${esc(userName(s.student_id))}</td><td>${faDateTime(s.submitted_at)}</td><td>${homeworkStatusBadge(s.status)}</td><td>${s.score??"-"}</td>
    <td><div class="actions"><button type="button" class="btn btn-ghost modal-open-file" data-path="${esc(s.file_path)}">فایل</button><button type="button" class="btn btn-primary modal-review" data-id="${s.id}">ارزیابی</button></div></td></tr>`).join("");
  modal("ارسال‌های دانش‌آموزان",`<div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>زمان ارسال</th><th>وضعیت</th><th>نمره</th><th>عملیات</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">هنوز فایلی ارسال نشده است.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
  $("#modalSubmit").textContent="بستن";
  document.querySelectorAll(".modal-open-file").forEach(b=>b.onclick=()=>openStoredFile(b.dataset.path));
  document.querySelectorAll(".modal-review").forEach(b=>b.onclick=()=>{
    const s=(data||[]).find(x=>x.id===b.dataset.id);$("#modal").close();reviewSubmissionModal(s);
  });
}

function reviewSubmissionModal(sub){
  modal("ارزیابی تکلیف",`<div class="form-grid">
    <label><span>وضعیت</span><select id="reviewStatus"><option value="graded">ثبت نمره</option><option value="needs_revision">نیاز به اصلاح</option></select></label>
    <label><span>نمره از ۲۰</span><input id="reviewScore" inputmode="decimal" value="${sub.score??""}" placeholder="۰ تا ۲۰"></label>
    <label class="wide"><span>بازخورد / علت نیاز به اصلاح</span><textarea id="reviewFeedback">${esc(sub.feedback||"")}</textarea></label>
  </div>`,async()=>{
    const status=$("#reviewStatus").value;
    const score=status==="graded"?num($("#reviewScore").value):null;
    if(status==="graded"&&(score===null||score<0||score>20))throw new Error("نمره باید بین ۰ تا ۲۰ باشد.");
    const {error}=await state.sb.rpc("review_assignment_submission",{p_submission:sub.id,p_status:status,p_score:score,p_feedback:$("#reviewFeedback").value.trim()||null});
    if(error)throw error;clearPageCache("homework:");toast(status==="graded"?"نمره تکلیف ثبت شد.":"تکلیف برای اصلاح بازگردانده شد.");renderHomework();
  },"ثبت ارزیابی");
}

async function showHomeworkAverages(){
  const [{data:tasks,error:taskError},{data:grades,error:gradeError}]=await Promise.all([
    state.sb.from("assignments").select("id,class_id,subject_id,title").eq("teacher_id",state.profile.id),
    state.sb.from("homework_grades").select("assignment_id,student_id,score,source")
  ]);
  if(taskError)throw taskError;
  if(gradeError)throw gradeError;
  const taskIds=new Set((tasks||[]).map(t=>t.id));
  const mine=(grades||[]).filter(g=>taskIds.has(g.assignment_id));
  const grouped=new Map();
  mine.forEach(g=>{
    const row=grouped.get(g.student_id)||{student_id:g.student_id,count:0,total:0,zeros:0};
    row.count++;
    row.total+=Number(g.score||0);
    if(Number(g.score||0)===0)row.zeros++;
    grouped.set(g.student_id,row);
  });
  const rows=[...grouped.values()]
    .sort((a,b)=>userName(a.student_id).localeCompare(userName(b.student_id),"fa"))
    .map(x=>`<tr><td>${esc(userName(x.student_id))}</td><td>${x.count}</td><td>${x.zeros}</td><td><strong>${x.count?(x.total/x.count).toFixed(2):"0.00"}</strong></td></tr>`)
    .join("");
  modal("معدل تکالیف دانش‌آموزان",`<div class="alert alert-info">تکلیف ارسال‌نشده یا تکلیفی که هنوز نمره نهایی نگرفته، در دفتر تکالیف نمره ۰ دارد.</div><br>
    <div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>تعداد تکلیف</th><th>نمره صفر</th><th>معدل از ۲۰</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="empty">داده‌ای وجود ندارد.</td></tr>'}</tbody></table></div>`,
    async()=>$("#modal").close(),"بستن");
}

async function renderManagerHomeworkGrades(){
  setPage("نمرات تکالیف","مشاهده و اصلاح نمرات دفتر تکالیف توسط مدیر");
  const [{data:tasks,error:taskError},{data:grades,error:gradeError}]=await Promise.all([
    state.sb.from("assignments").select("id,teacher_id,class_id,subject_id,title,due_at").order("created_at",{ascending:false}),
    state.sb.from("homework_grades").select("assignment_id,student_id,score,source,updated_at")
  ]);
  if(taskError)throw taskError;
  if(gradeError)throw gradeError;
  const taskMap=new Map((tasks||[]).map(t=>[t.id,t]));
  const rows=(grades||[]).map(g=>{
    const t=taskMap.get(g.assignment_id);
    if(!t)return "";
    const src={automatic:"خودکار / ارسال‌نشده",submission:"ثبت دبیر",manager:"اصلاح مدیر"}[g.source]||g.source;
    return `<tr><td>${esc(userName(g.student_id))}</td><td>${esc(t.title)}</td><td>${esc(className(t.class_id))}</td><td>${esc(subjectName(t.subject_id))}</td><td><strong>${g.score}</strong></td><td>${esc(src)}</td><td><button class="btn btn-ghost edit-homework-grade" data-a="${g.assignment_id}" data-s="${g.student_id}" data-score="${g.score}">ویرایش</button></td></tr>`;
  }).join("");
  $("#content").innerHTML=`<div class="card"><div class="panel-head"><div><h3>دفتر نمرات تکالیف</h3><p class="muted">برای تکلیف ارسال‌نشده نمره ۰ به‌صورت خودکار ثبت می‌شود.</p></div></div><br>
    <div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>تکلیف</th><th>کلاس</th><th>درس</th><th>نمره</th><th>منبع</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">نمره‌ای ثبت نشده است.</td></tr>'}</tbody></table></div></div>`;
  document.querySelectorAll(".edit-homework-grade").forEach(b=>b.onclick=()=>managerHomeworkGradeModal(b.dataset.a,b.dataset.s,b.dataset.score));
}

function managerHomeworkGradeModal(assignmentId,studentId,current){
  modal("اصلاح نمره تکلیف",`<div class="form-grid"><label><span>دانش‌آموز</span><input value="${esc(userName(studentId))}" disabled></label><label><span>نمره از ۲۰</span><input id="managerHwScore" inputmode="decimal" value="${esc(current)}"></label></div>`,async()=>{
    const score=num($("#managerHwScore").value);
    if(score===null)throw new Error("نمره الزامی است.");
    const {error}=await state.sb.from("homework_grades").update({score,source:"manager",updated_by:state.profile.id,updated_at:new Date().toISOString()}).eq("assignment_id",assignmentId).eq("student_id",studentId);
    if(error)throw error;
    clearPageCache("homework:");
    toast("نمره تکلیف توسط مدیر اصلاح شد.");
    renderManagerHomeworkGrades();
  },"ثبت نمره");
}

async function renderGroups(){
  setPage(state.profile.role==="teacher"?"گروه‌های کلاسی":"گروه من",state.profile.role==="teacher"?"سرگروه، اعضا و فیلدهای ارزیابی":"مشاهده اعضا و ثبت امتیاز توسط سرگروه");
  const {groups,members,fields,entries}=await cachedPage("groups:page",20000,async()=>{
    const [{data:groups,error},{data:members,error:membersError},{data:fields,error:fieldsError},{data:entries,error:entriesError}]=await Promise.all([
      state.sb.from("student_groups").select("id,teacher_id,class_id,subject_id,name,leader_id,created_at").order("name"),
      state.sb.from("student_group_members").select("group_id,student_id,joined_at"),
      state.sb.from("group_score_fields").select("id,group_id,title,max_score,sort_order").order("sort_order"),
      state.sb.from("group_score_entries").select("field_id,student_id,score,submitted_by,updated_at")
    ]);
    if(error)throw error;
    if(membersError)throw membersError;
    if(fieldsError)throw fieldsError;
    if(entriesError)throw entriesError;
    return {groups:groups||[],members:members||[],fields:fields||[],entries:entries||[]};
  });
  const cards=(groups||[]).map(g=>{
    const gm=(members||[]).filter(m=>m.group_id===g.id);
    const gf=(fields||[]).filter(x=>x.group_id===g.id);
    const ge=(entries||[]).filter(e=>gf.some(f=>f.id===e.field_id));
    const memberNames=gm.map(m=>esc(userName(m.student_id))).join("، ");
    const scores=gm.map(m=>{
      const vals=ge.filter(e=>e.student_id===m.student_id).map(e=>Number(e.score));
      return vals.length?`${esc(userName(m.student_id))}: ${(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1)}`:null;
    }).filter(Boolean);
    return `<article class="group-card"><div class="group-card-head"><div><span class="badge info">${esc(subjectName(g.subject_id))}</span><h3>${esc(g.name)}</h3><p>${esc(className(g.class_id))}</p></div><div class="leader-chip"><small>سرگروه</small><b>${esc(userName(g.leader_id))}</b></div></div>
      <div class="group-members"><b>اعضا:</b> ${memberNames||"-"}</div>
      <div class="pill-row">${gf.map(f=>`<span class="score-field-chip">${esc(f.title)} / ${f.max_score}</span>`).join("")||'<span class="muted">فیلد ارزیابی تعریف نشده است.</span>'}</div>
      ${state.profile.role==="teacher"&&scores.length?`<div class="group-score-summary">${scores.map(x=>`<span>${x}</span>`).join("")}</div>`:""}
      <div class="actions">
        ${state.profile.role==="teacher"?`<button class="btn btn-primary add-group-field" data-id="${g.id}">تعریف فیلد نمره</button><button class="btn btn-ghost view-group-scores" data-id="${g.id}">نمرات سرگروه</button><button class="btn btn-ghost view-group-archive" data-id="${g.id}">بایگانی</button><button class="btn btn-ghost del-group" data-id="${g.id}">حذف گروه</button>`:""}
        ${state.profile.id===g.leader_id?`<button class="btn btn-primary leader-score" data-id="${g.id}">ثبت امتیاز اعضا</button>`:""}
      </div>
    </article>`;
  }).join("");
  $("#content").innerHTML=`${state.profile.role==="teacher"?'<div class="panel-head page-actions"><div><h3>گروه‌های شما</h3><p class="muted">برای هر کلاس/درس گروه بسازید و سرگروه تعیین کنید.</p></div><button class="btn btn-primary" id="newGroup">+ گروه جدید</button></div>':""}<div class="group-grid">${cards||'<div class="card empty">گروهی ثبت نشده است.</div>'}</div>`;
  if($("#newGroup"))$("#newGroup").onclick=openNewGroupModal;
  document.querySelectorAll(".add-group-field").forEach(b=>b.onclick=()=>openGroupFieldModal((groups||[]).find(g=>g.id===b.dataset.id)));
  document.querySelectorAll(".del-group").forEach(b=>b.onclick=async()=>{if(!confirm("گروه حذف شود؟"))return;const {error}=await state.sb.from("student_groups").delete().eq("id",b.dataset.id);if(error)return toast(errText(error),true);clearPageCache("groups:");toast("گروه حذف شد.");renderGroups()});
  document.querySelectorAll(".leader-score").forEach(b=>b.onclick=()=>leaderScoreModal((groups||[]).find(g=>g.id===b.dataset.id),members||[],fields||[],entries||[]));
  document.querySelectorAll(".view-group-scores").forEach(b=>b.onclick=()=>showGroupScoresModal((groups||[]).find(g=>g.id===b.dataset.id)));
  document.querySelectorAll(".view-group-archive").forEach(b=>b.onclick=()=>showGroupScoreArchive((groups||[]).find(g=>g.id===b.dataset.id)));
}

async function openNewGroupModal(){
  const teaching=state.assignments.filter(a=>a.teacher_id===state.profile.id);
  if(!teaching.length)return toast("کلاس/درسی به شما تخصیص داده نشده است.",true);
  modal("گروه جدید",`<div class="form-grid">
    <label><span>کلاس و درس</span><select id="groupCourse">${teaching.map(a=>`<option value="${a.class_id}|${a.subject_id}">${esc(className(a.class_id))} — ${esc(subjectName(a.subject_id))}</option>`).join("")}</select></label>
    <label><span>نام گروه</span><input id="groupName" required></label>
    <label class="wide"><span>سرگروه</span><select id="groupLeader"></select></label>
    <div class="wide"><strong>اعضای گروه</strong><div class="check-grid" id="groupMemberChecks"></div></div>
  </div>`,async()=>{
    const [class_id,subject_id]=$("#groupCourse").value.split("|");
    const leader_id=$("#groupLeader").value, name=$("#groupName").value.trim();
    const selected=[...document.querySelectorAll("#groupMemberChecks input:checked")].map(x=>x.value);
    if(!name||!leader_id)throw new Error("نام گروه و سرگروه الزامی است.");
    if(!selected.includes(leader_id))selected.push(leader_id);
    const {data:g,error}=await state.sb.from("student_groups").insert({teacher_id:state.profile.id,class_id,subject_id,name,leader_id}).select("*").single();
    if(error)throw error;
    const {error:memberError}=await state.sb.from("student_group_members").insert(selected.map(student_id=>({group_id:g.id,student_id})));
    if(memberError){await state.sb.from("student_groups").delete().eq("id",g.id);throw memberError}
    clearPageCache("groups:");toast("گروه ایجاد شد.");renderGroups();
  },"ساخت گروه");
  const refresh=()=>{
    const [classId]=$("#groupCourse").value.split("|");
    const students=state.classStudents.filter(x=>x.class_id===classId).map(x=>byId(state.profiles,x.student_id)).filter(Boolean);
    $("#groupLeader").innerHTML=students.map(s=>`<option value="${s.id}">${esc(s.full_name)}</option>`).join("");
    $("#groupMemberChecks").innerHTML=students.map(s=>`<label class="check-card"><input type="checkbox" value="${s.id}"><span><b>${esc(s.full_name)}</b><small>${esc(s.national_id)}</small></span></label>`).join("");
  };
  $("#groupCourse").onchange=refresh;refresh();
}

function openGroupFieldModal(group){
  modal("تعریف فیلدهای امتیازدهی",`<div class="alert alert-info">نام هر فیلد را در یک خط بنویسید. حداکثر نمره هر فیلد ۲۰ است.</div><br>
    <label><span>نام فیلدها</span><textarea id="fieldNames" placeholder="همکاری\\nمسئولیت‌پذیری\\nارائه"></textarea></label>`,async()=>{
    const names=$("#fieldNames").value.split("\\n").map(x=>x.trim()).filter(Boolean);
    if(!names.length)throw new Error("حداقل یک نام فیلد وارد کنید.");
    const {data:old}=await state.sb.from("group_score_fields").select("sort_order").eq("group_id",group.id).order("sort_order",{ascending:false}).limit(1);
    const base=(old?.[0]?.sort_order??-1)+1;
    const {error}=await state.sb.from("group_score_fields").insert(names.map((title,i)=>({group_id:group.id,title,max_score:20,sort_order:base+i})));
    if(error)throw error;clearPageCache("groups:");toast("فیلدهای امتیازدهی اضافه شد.");renderGroups();
  },"افزودن فیلدها");
}

async function showGroupScoresModal(group){
  const [{data:fields,error:fieldError},{data:entries,error:entryError}]=await Promise.all([
    state.sb.from("group_score_fields").select("id,title,max_score").eq("group_id",group.id).order("sort_order"),
    state.sb.from("group_score_entries").select("field_id,student_id,score,submitted_by,updated_at")
  ]);
  if(fieldError)throw fieldError;
  if(entryError)throw entryError;
  const fieldMap=new Map((fields||[]).map(f=>[f.id,f]));
  const active=(entries||[]).filter(e=>fieldMap.has(e.field_id));
  const rows=active.map(e=>`<tr><td><input class="archive-score-check" type="checkbox" data-field="${e.field_id}" data-student="${e.student_id}"></td><td>${esc(userName(e.student_id))}</td><td>${esc(fieldMap.get(e.field_id)?.title||"-")}</td><td>${e.score}</td><td>${esc(userName(e.submitted_by))}</td><td>${faDateTime(e.updated_at)}</td></tr>`).join("");
  modal(`نمرات سرگروه — ${group.name}`,`<div class="panel-head"><div><p class="muted">نمرات موردنظر را انتخاب و به بایگانی منتقل کنید.</p></div><button type="button" class="btn btn-ghost" id="selectAllGroupScores">انتخاب همه</button></div><br>
    <div class="table-wrap"><table><thead><tr><th></th><th>دانش‌آموز</th><th>فیلد</th><th>نمره</th><th>ثبت‌کننده</th><th>زمان</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">نمره فعالی ثبت نشده است.</td></tr>'}</tbody></table></div>`,async()=>{
      const selected=[...document.querySelectorAll(".archive-score-check:checked")].map(x=>({field_id:x.dataset.field,student_id:x.dataset.student}));
      if(!selected.length)throw new Error("حداقل یک نمره را انتخاب کنید.");
      const {data,error}=await state.sb.rpc("archive_group_scores",{p_group:group.id,p_entries:selected});
      if(error)throw error;
      clearPageCache("groups:");
      toast(`${data||selected.length} نمره به بایگانی منتقل شد.`);
      renderGroups();
    },"بایگانی انتخاب‌شده‌ها");
  setTimeout(()=>{const b=$("#selectAllGroupScores");if(b)b.onclick=()=>document.querySelectorAll(".archive-score-check").forEach(x=>x.checked=true)},0);
}

async function showGroupScoreArchive(group){
  const {data,error}=await state.sb.from("group_score_archives").select("*").eq("group_id",group.id).order("archived_at",{ascending:false});
  if(error)throw error;
  const rows=(data||[]).map(e=>`<tr><td>${esc(userName(e.student_id))}</td><td>${esc(e.field_title)}</td><td>${e.score} / ${e.field_max_score}</td><td>${esc(userName(e.submitted_by))}</td><td>${faDateTime(e.archived_at)}</td></tr>`).join("");
  modal(`بایگانی نمرات — ${group.name}`,`<div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>فیلد</th><th>نمره</th><th>ثبت‌کننده</th><th>تاریخ بایگانی</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">بایگانی خالی است.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
}

function leaderScoreModal(group,members,fields,entries){
  const gm=members.filter(m=>m.group_id===group.id), gf=fields.filter(f=>f.group_id===group.id);
  if(!gf.length)return toast("دبیر هنوز فیلد امتیازدهی تعریف نکرده است.",true);
  const current=new Map(entries.map(e=>[`${e.field_id}|${e.student_id}`,e]));
  const head=gf.map(f=>`<th>${esc(f.title)}<small>از ${f.max_score}</small></th>`).join("");
  const rows=gm.map(m=>`<tr data-student="${m.student_id}"><td>${esc(userName(m.student_id))}</td>${gf.map(f=>`<td><input class="group-score-input" inputmode="decimal" data-field="${f.id}" data-max="${f.max_score}" value="${current.get(`${f.id}|${m.student_id}`)?.score??""}"></td>`).join("")}</tr>`).join("");
  modal("ثبت امتیاز اعضای گروه",`<div class="table-wrap"><table><thead><tr><th>عضو گروه</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`,async()=>{
    const payload=[];
    document.querySelectorAll("#modalBody tr[data-student]").forEach(tr=>{
      tr.querySelectorAll(".group-score-input").forEach(inp=>{
        if(!inp.value.trim())return;
        const score=num(inp.value), max=Number(inp.dataset.max);
        if(score===null||score<0||score>max)throw new Error(`نمره ${inp.dataset.field} باید بین ۰ تا ${max} باشد.`);
        payload.push({field_id:inp.dataset.field,student_id:tr.dataset.student,score,submitted_by:state.profile.id,updated_at:new Date().toISOString()});
      });
    });
    if(!payload.length)throw new Error("حداقل یک نمره وارد کنید.");
    const {error}=await state.sb.from("group_score_entries").upsert(payload,{onConflict:"field_id,student_id"});
    if(error)throw error;clearPageCache("groups:");toast("امتیازهای گروه ثبت شد.");renderGroups();
  },"ثبت امتیازها");
}

function persianDateParts(date){
  const parts=new Intl.DateTimeFormat("en-US-u-ca-persian",{year:"numeric",month:"numeric",day:"numeric"}).formatToParts(date);
  const get=t=>Number(parts.find(p=>p.type===t)?.value);
  return {year:get("year"),month:get("month"),day:get("day")};
}
function firstPersianMonthDay(date){
  const d=new Date(date); d.setHours(12,0,0,0);
  let guard=35;
  while(persianDateParts(d).day!==1&&guard-->0)d.setDate(d.getDate()-1);
  return d;
}
function mountJalaliPicker(containerId,hiddenId,initialDate=new Date()){
  const root=document.getElementById(containerId), hidden=document.getElementById(hiddenId);
  let selected=new Date(initialDate), anchor=new Date(initialDate), time="23:59";
  const sync=()=>{
    const [h,m]=toEnDigits(time).split(":").map(Number);
    const d=new Date(selected);d.setHours(Number.isFinite(h)?h:23,Number.isFinite(m)?m:59,0,0);
    hidden.value=d.toISOString();
    const out=root.querySelector(".jalali-selected");
    if(out)out.textContent=`${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"full"}).format(d)} — ساعت ${toFaDigits(String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"))}`;
  };
  const render=()=>{
    const first=firstPersianMonthDay(anchor), p=persianDateParts(first);
    const offset=(first.getDay()+1)%7;
    const days=[];let d=new Date(first);
    while(persianDateParts(d).month===p.month){
      days.push(new Date(d));d.setDate(d.getDate()+1);
    }
    root.innerHTML=`<div class="jalali-head"><button type="button" class="icon-btn prev-month">‹</button><strong>${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{month:"long",year:"numeric"}).format(first)}</strong><button type="button" class="icon-btn next-month">›</button></div>
      <div class="week-row">${["ش","ی","د","س","چ","پ","ج"].map(x=>`<span>${x}</span>`).join("")}</div>
      <div class="days-grid">${Array(offset).fill('<span></span>').join("")}${days.map(day=>{const pp=persianDateParts(day),active=day.toDateString()===selected.toDateString();return `<button type="button" data-ts="${day.getTime()}" class="${active?"selected":""}">${pp.day}</button>`}).join("")}</div>
      <div class="jalali-time"><label><span>ساعت</span><input class="jalali-time-input" inputmode="numeric" value="${time}"></label><div class="jalali-selected"></div></div>`;
    root.querySelector(".prev-month").onclick=()=>{const x=firstPersianMonthDay(anchor);x.setDate(x.getDate()-1);anchor=x;render()};
    root.querySelector(".next-month").onclick=()=>{const x=new Date(days[days.length-1]);x.setDate(x.getDate()+1);anchor=x;render()};
    root.querySelectorAll(".days-grid button").forEach(b=>b.onclick=()=>{selected=new Date(Number(b.dataset.ts));anchor=new Date(selected);render();sync()});
    root.querySelector(".jalali-time-input").oninput=e=>{time=e.target.value;sync()};
    sync();
  };
  render();
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