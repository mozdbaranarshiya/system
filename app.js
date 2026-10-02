(() => {
"use strict";

const cfg = window.APP_CONFIG || {};
const v7Security = window.SystemV7Security || null;
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

const v7Routes=new Map();
const v7Nav={manager:[],teacher:[],student:[]};
function registerV7Module(def={}){
  Object.entries(def.routes||{}).forEach(([name,fn])=>{
    if(typeof fn==="function")v7Routes.set(name,fn);
  });
  for(const role of ["manager","teacher","student"]){
    const items=def.nav?.[role]||[];
    items.forEach(item=>{
      if(Array.isArray(item)&&item.length>=2&&!v7Nav[role].some(x=>x[0]===item[0]))v7Nav[role].push(item);
    });
  }
}
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
  const {data:{session}}=await state.sb.auth.getSession();
  if(!session?.access_token)throw new Error("نشست کاربری معتبر نیست.");

  const safePath=path.split("/").map(encodeURIComponent).join("/");
  const url=`${cfg.SUPABASE_URL.replace(/\/$/,"")}/storage/v1/object/assignment-files/${safePath}`;

  await new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open("POST",url,true);
    xhr.setRequestHeader("Authorization",`Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey",cfg.SUPABASE_ANON_KEY);
    xhr.setRequestHeader("x-upsert","false");
    xhr.setRequestHeader("cache-control","3600");
    xhr.setRequestHeader("content-type",file.type||"application/octet-stream");
    xhr.timeout=120000;

    xhr.upload.onprogress=e=>{
      if(e.lengthComputable)onProgress(e.loaded/e.total);
    };
    xhr.onerror=()=>reject(new Error("UPLOAD_NETWORK_ERROR"));
    xhr.ontimeout=()=>reject(new Error("UPLOAD_TIMEOUT"));
    xhr.onload=()=>{
      if(xhr.status>=200&&xhr.status<300){
        onProgress(1);
        resolve();
        return;
      }
      let message=`UPLOAD_FAILED: HTTP ${xhr.status}`;
      try{
        const data=JSON.parse(xhr.responseText||"{}");
        message=data.message||data.error||message;
      }catch(_){}
      reject(new Error(message));
    };
    onProgress(.01);
    xhr.send(file);
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
  const raw=e?.message||String(e||"خطای نامشخص");
  const map={
    ACCESS_DENIED:"شما اجازه انجام این عملیات را ندارید.",
    CONTINUOUS_LOCKED:"نمره تکوینی قفل است.",
    FINAL_LOCKED:"نمره پایانی قفل است.",
    MANAGER_ONLY:"این عملیات فقط برای مدیر مجاز است.",
    STAFF_ONLY:"این عملیات فقط برای مدیر یا دبیر مجاز است.",
    STUDENT_ONLY:"این عملیات فقط برای دانش‌آموز مجاز است.",
    INVALID_NATIONAL_ID:"کد ملی باید ۱۰ رقم باشد.",
    USER_INACTIVE:"این حساب کاربری غیرفعال است.",
    CANNOT_DELETE_SELF:"مدیر نمی‌تواند حساب خودش را حذف کند.",
    DEADLINE_PASSED:"مهلت تحویل این تکلیف به پایان رسیده است.",
    ALREADY_GRADED:"برای این تکلیف نمره نهایی ثبت شده است.",
    FEEDBACK_REQUIRED:"برای وضعیت «نیاز به اصلاح» توضیح دبیر الزامی است.",
    INVALID_FILE_PATH:"مسیر فایل معتبر نیست.",
    INVALID_SCORE:"نمره واردشده معتبر نیست.",
    INVALID_STATUS:"وضعیت انتخاب‌شده معتبر نیست.",
    UPLOAD_NETWORK_ERROR:"ارتباط هنگام آپلود قطع شد. دوباره تلاش کنید.",
    UPLOAD_TIMEOUT:"آپلود بیش از حد طول کشید. اتصال اینترنت را بررسی کنید.",
    NO_SELECTION:"حداقل یک مورد را انتخاب کنید.",
    NOTHING_ARCHIVED:"هیچ موردی به بایگانی منتقل نشد.",
    MFA_REQUIRED:"برای عملیات مدیریتی باید کد دومرحله‌ای تأیید شود.",
    MFA_LEVEL_NOT_UPGRADED:"سطح امنیت نشست مدیر به AAL2 ارتقا پیدا نکرد.",
    MFA_ENROLL_INCOMPLETE:"اطلاعات راه‌اندازی Ente Auth کامل دریافت نشد. دوباره وارد شوید.",
    PASSWORD_TOO_SHORT:"رمز جدید باید حداقل ۸ کاراکتر باشد.",
    PASSWORD_SAME_AS_NATIONAL_ID:"رمز جدید نباید همان کد ملی باشد.",
    PASSWORD_UPDATE_FAILED:"تغییر رمز انجام نشد. دوباره تلاش کنید.",
    PASSWORD_COMPLETION_FAILED:"تغییر رمز انجام شد اما فعال‌سازی حساب کامل نشد.",
    PASSWORD_NOT_CHANGED:"رمز حساب هنوز تغییر نکرده است.",
    PROFILE_NOT_FOUND:"پروفایل کاربری پیدا نشد.",
    TIMETABLE_CLASS_CONFLICT:"برای این کلاس در این ساعت برنامه دیگری ثبت شده است.",
    TIMETABLE_TEACHER_CONFLICT:"این دبیر در این ساعت در کلاس دیگری برنامه دارد.",
    TEACHER_NOT_ASSIGNED:"این دبیر برای کلاس و درس انتخاب‌شده تخصیص ندارد.",
    STUDENT_NOT_IN_CLASS:"دانش‌آموز عضو این کلاس نیست.",
    INVALID_SCHEDULE_ENTRY:"جلسه انتخاب‌شده با کلاس و درس سازگار نیست.",
    INVALID_DELAY_MINUTES:"تعداد دقیقه واردشده معتبر نیست.",
    EXAM_NOT_AVAILABLE:"آزمون در دسترس نیست.",
    EXAM_NOT_STARTED:"زمان شروع آزمون هنوز نرسیده است.",
    EXAM_ENDED:"مهلت آزمون پایان یافته است.",
    EXAM_TIME_ENDED:"زمان پاسخ‌گویی آزمون پایان یافته است.",
    ATTEMPT_ALREADY_SUBMITTED:"این آزمون قبلاً ارسال شده است.",
    FORM_NOT_ACTIVE:"این فرم غیرفعال است.",
    FORM_NOT_OPEN:"زمان شروع این فرم هنوز نرسیده است.",
    FORM_CLOSED:"مهلت ارسال این فرم پایان یافته است.",
    FORM_ALREADY_SUBMITTED:"این فرم قبلاً ارسال شده است.",
    REQUIRED_FIELD_MISSING:"همه فیلدهای الزامی را تکمیل کنید.",
    POLL_NOT_ACTIVE:"این نظرسنجی غیرفعال است.",
    POLL_NOT_STARTED:"رأی‌گیری هنوز شروع نشده است.",
    POLL_CLOSED:"مهلت رأی‌گیری پایان یافته است.",
    POLL_ALREADY_VOTED:"شما قبلاً در این نظرسنجی رأی داده‌اید.",
    POLL_RESULTS_HIDDEN:"نمایش نتایج این نظرسنجی غیرفعال است.",
    CLASS_FULL:"ظرفیت این کلاس تکمیل شده است.",
    ALREADY_REGISTERED:"قبلاً برای این کلاس ثبت‌نام کرده‌اید.",
    REGISTRATION_NOT_STARTED:"زمان ثبت‌نام هنوز شروع نشده است.",
    REGISTRATION_CLOSED:"مهلت ثبت‌نام پایان یافته است.",
    APPOINTMENT_SLOT_CONFLICT:"این زمان با زمان آزاد دیگری تداخل دارد.",
    APPOINTMENT_CONFLICT:"برای این ساعت ملاقات دیگری دارید.",
    SLOT_FULL:"ظرفیت این زمان ملاقات تکمیل شده است.",
    SLOT_NOT_AVAILABLE:"این زمان دیگر قابل رزرو نیست.",
    SLOT_PASSED:"زمان این ملاقات گذشته است.",
    CANNOT_BOOK_SELF:"امکان رزرو ملاقات با حساب خودتان وجود ندارد."
  };
  if(map[raw])return map[raw];
  for(const [code,msg] of Object.entries(map))if(raw.includes(code))return msg;
  if(/permission denied|row-level security|violates row-level|PGRST|JWT|schema cache|duplicate key|violates .*constraint|invalid input syntax|Failed to fetch|NetworkError|TypeError: fetch|HTTP [45]\d\d/i.test(raw)){
    return "عملیات انجام نشد. لطفاً اطلاعات را بررسی کنید و دوباره تلاش کنید.";
  }
  return raw.length>220?"عملیات انجام نشد. لطفاً دوباره تلاش کنید.":raw;
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


function showOnlyView(view){
  ["#loginView","#mfaView","#passwordView","#appView"].forEach(sel=>$(sel)?.classList.add("hidden"));
  $(view)?.classList.remove("hidden");
}
async function currentMfaLevel(){
  const {data,error}=await state.sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if(error)throw error;
  return data;
}
async function ensureManagerMfa(){
  if(state.profile?.role!=="manager")return true;

  const level=await currentMfaLevel();
  if(level?.currentLevel==="aal2")return true;

  const {data:factors,error:factorsError}=await state.sb.auth.mfa.listFactors();
  if(factorsError)throw factorsError;

  const totp=factors?.totp||[];
  const verified=totp.find(f=>f.status==="verified");
  if(verified){
    return waitForManagerMfa({
      mode:"challenge",
      factorId:verified.id
    });
  }

  // عوامل نیمه‌کاره قبلی را پاک می‌کنیم تا هر بار QR تازه و قابل استفاده باشد.
  for(const factor of totp.filter(f=>f.status!=="verified")){
    try{await state.sb.auth.mfa.unenroll({factorId:factor.id})}catch(_){}
  }

  const uniqueName=`مدیر سامانه - ${Date.now().toString(36)}`;
  let {data:enrolled,error:enrollError}=await state.sb.auth.mfa.enroll({
    factorType:"totp",
    friendlyName:uniqueName
  });

  // اگر به هر دلیل Supabase هنوز روی نام عامل قبلی تعارض گزارش کرد،
  // یک بار دیگر با نام کاملاً تصادفی تلاش می‌کنیم.
  if(enrollError && /friendly name|already exists/i.test(enrollError.message||"")){
    const retry=await state.sb.auth.mfa.enroll({
      factorType:"totp",
      friendlyName:`مدیر سامانه - ${crypto.randomUUID().slice(0,8)}`
    });
    enrolled=retry.data;
    enrollError=retry.error;
  }

  if(enrollError)throw enrollError;
  if(!enrolled?.id||!enrolled?.totp?.qr_code||!enrolled?.totp?.secret){
    throw new Error("MFA_ENROLL_INCOMPLETE");
  }

  return waitForManagerMfa({
    mode:"setup",
    factorId:enrolled.id,
    qr:enrolled.totp.qr_code,
    secret:enrolled.totp.secret,
    uri:enrolled.totp.uri||""
  });
}
function waitForManagerMfa({mode,factorId,qr="",secret="",uri=""}){
  return new Promise(resolve=>{
    showOnlyView("#mfaView");

    const setup=$("#mfaSetupBox");
    const subtitle=$("#mfaSubtitle");
    const form=$("#mfaForm");
    const code=$("#mfaCode");
    const submit=$("#mfaSubmit");
    const logoutBtn=$("#mfaLogout");

    setup.classList.toggle("hidden",mode!=="setup");
    subtitle.textContent=mode==="setup"
      ?"برای اولین ورود مدیر، Ente Auth را با QR یا کلید زیر به حساب متصل کنید."
      :"کد ۶ رقمی فعلی Ente Auth را برای ورود مدیر وارد کنید.";

    if(mode==="setup"){
      $("#mfaQrImage").src=qr;
      $("#mfaSecret").textContent=secret;
      const open=$("#openMfaUri");
      open.href=uri||"#";
      open.classList.toggle("hidden",!uri);
      $("#copyMfaSecret").onclick=async()=>{
        try{
          await navigator.clipboard.writeText(secret);
          toast("کلید راه‌اندازی کپی شد.");
        }catch(_){
          toast("کپی خودکار ممکن نبود؛ کلید را دستی انتخاب کنید.",true);
        }
      };
    }

    code.value="";
    setTimeout(()=>code.focus(),80);

    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;
      form.onsubmit=null;
      logoutBtn.onclick=null;
      resolve(value);
    };

    form.onsubmit=async e=>{
      e.preventDefault();
      const raw=toEnDigits(code.value).replace(/\D/g,"");
      if(!/^\d{6}$/.test(raw))return toast("کد Ente Auth باید ۶ رقم باشد.",true);

      const old=submit.textContent;
      submit.disabled=true;
      submit.textContent="در حال تأیید…";
      try{
        const {error}=await state.sb.auth.mfa.challengeAndVerify({
          factorId,
          code:raw
        });
        if(error)throw error;

        const {data:{session}}=await state.sb.auth.getSession();
        state.session=session;

        const level=await currentMfaLevel();
        if(level?.currentLevel!=="aal2")throw new Error("MFA_LEVEL_NOT_UPGRADED");

        showOnlyView("#appView");
        toast(mode==="setup"?"Ente Auth با موفقیت به حساب مدیر متصل شد.":"ورود دومرحله‌ای تأیید شد.");
        finish(true);
      }catch(err){
        code.select();
        toast("کد صحیح نیست یا منقضی شده است. کد جدید Ente Auth را وارد کنید.",true);
      }finally{
        submit.disabled=false;
        submit.textContent=old;
      }
    };

    logoutBtn.onclick=async()=>{
      try{await state.sb.auth.signOut()}catch(_){}
      showLogin();
      finish(false);
    };
  });
}
async function resetManagerMfa(){
  if(state.profile?.role!=="manager")return;
  const {data,error}=await state.sb.auth.mfa.listFactors();
  if(error)throw error;
  const verified=(data?.totp||[]).filter(f=>f.status==="verified");
  if(!verified.length)return toast("عامل TOTP فعالی وجود ندارد.",true);
  if(!confirm("اتصال فعلی Ente Auth حذف شود؟ پس از خروج باید دوباره QR جدید را اسکن کنید."))return;

  for(const factor of verified){
    const {error}=await state.sb.auth.mfa.unenroll({factorId:factor.id});
    if(error)throw error;
  }
  try{await state.sb.auth.refreshSession()}catch(_){}
  await state.sb.auth.signOut();
  showLogin();
  toast("اتصال Ente Auth حذف شد. در ورود بعدی QR جدید ساخته می‌شود.");
}

window.SystemV7API={
  get state(){return state},
  $,esc,toFaDigits,toEnDigits,faDateTime,
  toast,errText,invokeFunction,roleBadge,byId,className,subjectName,userName,
  modal,num,setPage,setLoading,table,cachedPage,clearPageCache,refreshRefs,navigate,
  registerModule:registerV7Module
};
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
  $("#appView").classList.add("hidden");
  $("#mfaView")?.classList.add("hidden");
  $("#passwordView")?.classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}

async function changeOwnPasswordFrom(prefix){
  if(!v7Security)throw new Error("ماژول امنیت حساب بارگذاری نشده است.");
  const newInput=$(`#${prefix}NewPassword`);
  const confirmInput=$(`#${prefix}ConfirmPassword`);
  const button=$(`#${prefix}ChangePassword`);
  const password=v7Security.validatePassword(
    toEnDigits(newInput?.value||""),
    toEnDigits(confirmInput?.value||""),
    state.profile?.national_id||""
  );
  const old=button?.textContent||"ذخیره";
  if(button){button.disabled=true;button.textContent="در حال تغییر رمز…";}
  try{
    await invokeFunction("change-password",{new_password:password});
    state.profile.must_change_password=false;
    state.profile.password_changed_at=new Date().toISOString();
    if(newInput)newInput.value="";
    if(confirmInput)confirmInput.value="";
    return true;
  }finally{
    if(button){button.disabled=false;button.textContent=old;}
  }
}

function waitForMandatoryPasswordChange(){
  return new Promise(resolve=>{
    showOnlyView("#passwordView");
    $("#forcedPasswordBody").innerHTML=v7Security
      ? v7Security.passwordFormHtml({forced:true,prefix:"forced"})
      : '<div class="alert alert-warning">ماژول امنیت حساب بارگذاری نشده است.</div>';
    let settled=false;
    const done=value=>{if(settled)return;settled=true;resolve(value);};
    const btn=$("#forcedChangePassword");
    if(btn)btn.onclick=async()=>{
      try{
        await changeOwnPasswordFrom("forced");
        toast("رمز با موفقیت تغییر کرد. دسترسی حساب فعال شد.");
        done(true);
      }catch(e){toast(errText(e),true)}
    };
    $("#forcedPasswordLogout").onclick=async()=>{
      try{await state.sb.auth.signOut()}catch(_){}
      showLogin();
      done(false);
    };
    setTimeout(()=>$("#forcedNewPassword")?.focus(),80);
  });
}

async function renderAccountSecurity(){
  setPage("امنیت حساب","رمز عبور و وضعیت امنیت حساب");
  const isManager=state.profile.role==="manager";
  let mfaHtml="";
  if(isManager){
    try{
      const {data}=await state.sb.auth.mfa.listFactors();
      const verified=(data?.totp||[]).filter(f=>f.status==="verified").length;
      mfaHtml=`<div class="card"><div class="panel-head"><h3>ورود دومرحله‌ای مدیر</h3><span class="badge">${verified?"فعال":"نیاز به اتصال"}</span></div><p class="muted">ورود مدیر با TOTP و سطح امنیتی AAL2 محافظت می‌شود.</p></div>`;
    }catch(_){}
  }
  $("#content").innerHTML=`<div class="security-card-grid">
    <div class="card">${v7Security.passwordFormHtml({forced:false,prefix:"account"})}</div>
    <div class="card"><h3>وضعیت حساب</h3><div class="security-info-list">
      <div class="security-info-row"><span>نام کاربر</span><strong>${esc(state.profile.full_name)}</strong></div>
      <div class="security-info-row"><span>نقش</span><strong>${esc(faRole[state.profile.role]||state.profile.role)}</strong></div>
      <div class="security-info-row"><span>ایجاد حساب</span><strong>${faDateTime(state.profile.created_at)}</strong></div>
      <div class="security-info-row"><span>آخرین تغییر رمز</span><strong>${state.profile.password_changed_at?faDateTime(state.profile.password_changed_at):"ثبت نشده"}</strong></div>
      <div class="security-info-row"><span>رمز اولیه</span><strong>${state.profile.must_change_password?"نیاز به تغییر":"تغییر داده شده"}</strong></div>
    </div></div>${mfaHtml}</div>`;
  $("#accountChangePassword").onclick=async()=>{
    try{
      await changeOwnPasswordFrom("account");
      toast("رمز عبور با موفقیت تغییر کرد.");
      renderAccountSecurity();
    }catch(e){toast(errText(e),true)}
  };
}


function auditJson(value){
  if(value==null)return "-";
  try{
    const text=JSON.stringify(value,null,2);
    return `<details><summary>مشاهده</summary><pre class="audit-json">${esc(text.length>1400?text.slice(0,1400)+"\\n…":text)}</pre></details>`;
  }catch(_){return "-"}
}

async function renderAudit(page=0){
  setPage("تاریخچه تغییرات","ثبت غیرقابل‌ویرایش تغییرات حساس سامانه");
  const pageSize=50;
  const {data,error,count}=await state.sb.from("audit_logs")
    .select("id,user_id,action,table_name,record_id,old_data,new_data,created_at",{count:"exact"})
    .order("created_at",{ascending:false})
    .range(page*pageSize,page*pageSize+pageSize-1);
  if(error)throw error;

  const rows=(data||[]).map(log=>`<tr>
    <td>${faDateTime(log.created_at)}</td>
    <td>${esc(userName(log.user_id))}</td>
    <td><span class="badge">${esc(v7Security?.actionLabel(log.action)||log.action)}</span></td>
    <td>${esc(v7Security?.tableLabel(log.table_name)||log.table_name)}</td>
    <td>${log.record_id?`<code>${esc(log.record_id.slice(0,8))}…</code>`:"-"}</td>
    <td>${auditJson(log.old_data)}</td>
    <td>${auditJson(log.new_data)}</td>
  </tr>`).join("");

  const pages=Math.max(1,Math.ceil((count||0)/pageSize));
  $("#content").innerHTML=`<div class="card">
    <div class="panel-head"><div><h3>Audit Log</h3><p class="muted">کاربران عادی امکان ایجاد، تغییر یا حذف این سوابق را ندارند.</p></div><span class="badge">${toFaDigits(count||0)} رویداد</span></div><br>
    <div class="table-wrap"><table><thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>بخش</th><th>شناسه</th><th>قبل</th><th>بعد</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="empty">تغییری ثبت نشده است.</td></tr>'}</tbody></table></div>
    <div class="audit-pagination">
      <button class="btn btn-ghost" id="auditPrev" ${page<=0?"disabled":""}>صفحه قبل</button>
      <span class="badge">صفحه ${toFaDigits(page+1)} از ${toFaDigits(pages)}</span>
      <button class="btn btn-ghost" id="auditNext" ${page+1>=pages?"disabled":""}>صفحه بعد</button>
    </div>
  </div>`;

  $("#auditPrev").onclick=()=>page>0&&renderAudit(page-1);
  $("#auditNext").onclick=()=>page+1<pages&&renderAudit(page+1);
}

function refsStorageKey(){return state.session?.user?.id?`school-refs-v610:${state.session.user.id}`:null;}
function applyRefBundle(data){
  if(!data||typeof data!=="object")return false;
  const keys=["profiles","grades","classes","subjects","assignments","classStudents","representatives"];
  if(!keys.every(k=>Array.isArray(data[k])))return false;
  keys.forEach(k=>state[k]=data[k]);
  state.refsLoadedAt=Date.now();
  return true;
}
function loadRefsFromSession(){
  const key=refsStorageKey();if(!key)return false;
  try{
    const raw=sessionStorage.getItem(key);if(!raw)return false;
    const parsed=JSON.parse(raw);
    if(!parsed?.savedAt||Date.now()-parsed.savedAt>10*60*1000)return false;
    return applyRefBundle(parsed.data);
  }catch(_){return false}
}
function saveRefsToSession(){
  const key=refsStorageKey();if(!key)return;
  try{
    sessionStorage.setItem(key,JSON.stringify({
      savedAt:Date.now(),
      data:{
        profiles:state.profiles,grades:state.grades,classes:state.classes,subjects:state.subjects,
        assignments:state.assignments,classStudents:state.classStudents,representatives:state.representatives
      }
    }));
  }catch(_){}
}
function setRoleLabel(){
  const data=state.profile;if(!data)return;
  if(data.role==="student"){
    const repClasses=state.representatives
      .filter(r=>r.student_id===data.id)
      .map(r=>byId(state.classes,r.class_id)?.title||className(r.class_id))
      .filter(Boolean);
    $("#userRole").textContent=repClasses.length?`نماینده کلاس (${repClasses.join("، ")})`:faRole[data.role];
  }else $("#userRole").textContent=faRole[data.role];
}

async function enterApp(){
  const {data,error}=await state.sb.from("profiles").select("*").eq("id",state.session.user.id).single();
  if(error||!data?.active){await state.sb.auth.signOut();return toast("حساب کاربری فعال نیست.",true);}
  state.profile=data;

  if(data.role==="manager"){
    try{
      const verified=await ensureManagerMfa();
      if(!verified)return;
    }catch(e){
      await state.sb.auth.signOut();
      showLogin();
      return toast("راه‌اندازی احراز هویت دومرحله‌ای مدیر انجام نشد: "+errText(e),true);
    }
  }

  if(data.must_change_password){
    const changed=await waitForMandatoryPasswordChange();
    if(!changed)return;
  }

  showOnlyView("#appView");
  $("#userName").textContent=data.full_name;
  $("#avatar").textContent=(data.full_name||"ک").trim().charAt(0);

  const warm=loadRefsFromSession();
  if(warm){
    setRoleLabel();
    buildNav();
    navigate("dashboard");
    window.dispatchEvent(new CustomEvent("system:entered"));
    refreshRefs(true).then(()=>{
      setRoleLabel();
      buildNav();
    }).catch(()=>{});
    return;
  }

  await refreshRefs();
  setRoleLabel();
  buildNav();
  navigate("dashboard");
  window.dispatchEvent(new CustomEvent("system:entered"));
}
function buildNav(){
  const studentMenu=[
    ["dashboard","داشبورد"],["report","کارنامه من"],["homework","تکالیف"],
    ["groups","گروه من"],["announcements","اطلاعیه‌ها"],["teachers","معلمان دروس"],["objections","اعتراضات من"]
  ];
  if(state.representatives.some(r=>r.student_id===state.profile.id)) studentMenu.splice(4,0,["discipline","ثبت انضباط"]);
  const menus={
    manager:[["dashboard","داشبورد"],["users","کاربران"],["structure","پایه، کلاس و درس"],["assignments","تخصیص‌ها و نماینده"],["scores","ثبت و قفل نمرات"],["homeworkGrades","نمرات تکالیف"],["excel","ورود از اکسل"],["announcements","اطلاعیه‌ها"],["audit","تاریخچه تغییرات"],["settings","تنظیمات سامانه"],["accountSecurity","امنیت حساب"]],
    teacher:[["dashboard","داشبورد"],["scores","ثبت نمرات"],["homework","تکالیف"],["groups","گروه‌های کلاسی"],["announcements","اطلاعیه‌ها"],["objections","اعتراضات"],["accountSecurity","امنیت حساب"]],
    student:[...studentMenu,["accountSecurity","امنیت حساب"]]
  };
  const roleMenu=[...(menus[state.profile.role]||[]),...(v7Nav[state.profile.role]||[])];
  $("#mainNav").innerHTML=roleMenu.map(([r,t])=>`<button class="nav-btn" data-route="${r}">${t}</button>`).join("");
  $("#mainNav").querySelectorAll("button").forEach(b=>b.onclick=()=>navigate(b.dataset.route));
}
async function refreshRefs(force=false){
  const maxAge=5*60*1000;
  if(!force&&state.refsLoadedAt&&Date.now()-state.refsLoadedAt<maxAge)return;
  if(state.refsPromise){
    await state.refsPromise;
    if(!force&&Date.now()-state.refsLoadedAt<maxAge)return;
  }

  state.refsPromise=(async()=>{
    const {data,error}=await state.sb.rpc("get_app_bootstrap");
    if(!error&&applyRefBundle(data)){
      saveRefsToSession();
      return;
    }

    // سازگاری با دیتابیس قبل از اجرای migration نسخه ۶.۱.۰
    const queries=[
      ["profiles","profiles","id,national_id,full_name,role,active","full_name"],
      ["grades","grade_levels","id,title,sort_order","sort_order"],
      ["classes","classes","id,grade_id,title,academic_year","title"],
      ["subjects","subjects","id,grade_id,title","title"],
      ["assignments","teacher_assignments","id,teacher_id,class_id,subject_id","id"],
      ["classStudents","class_students","class_id,student_id","class_id"],
      ["representatives","class_representatives","class_id,student_id","class_id"]
    ];
    const results=await Promise.all(queries.map(async([stateKey,tableName,select,order])=>{
      const {data,error}=await state.sb.from(tableName).select(select).order(order,{ascending:true});
      if(error)throw error;
      return [stateKey,data||[]];
    }));
    results.forEach(([key,data])=>state[key]=data);
    state.refsLoadedAt=Date.now();
    saveRefsToSession();
  })().finally(()=>{state.refsPromise=null;});

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
    if(route==="audit")return renderAudit();
    if(route==="accountSecurity")return renderAccountSecurity();
    if(v7Routes.has(route))return v7Routes.get(route)(window.SystemV7API);
  }catch(e){$("#content").innerHTML=`<div class="alert alert-warning">${esc(errText(e))}</div>`;}
}

async function renderDashboard(){
  if(window.SystemV7Dashboard?.render)return window.SystemV7Dashboard.render(window.SystemV7API);
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
  setPage("کارنامه من","کارنامه تحصیلی رسمی، روند نمرات و وضعیت حضور");
  const {data:settings,error:settingsError}=await state.sb
    .from("school_settings")
    .select("objections_open,report_cards_open,passing_score")
    .eq("id",true).maybeSingle();
  if(settingsError)throw settingsError;
  if(state.profile.role==="student"&&settings?.report_cards_open===false){
    $("#content").innerHTML='<div class="card report-closed"><div class="setting-icon">▤</div><h3>نمایش کارنامه غیرفعال است</h3><p class="muted">مدیر مدرسه در حال حاضر امکان مشاهده کارنامه را بسته است.</p></div>';
    return;
  }

  const myClassLink=state.classStudents.find(x=>x.student_id===state.profile.id);
  const myClass=myClassLink?byId(state.classes,myClassLink.class_id):null;
  const grade=myClass?byId(state.grades,myClass.grade_id):null;

  const [{data:scores,error:scoreError},{data:discipline,error:disciplineError},{data:reportStats,error:reportStatsError}]=await Promise.all([
    state.sb.from("scores").select("*").eq("student_id",state.profile.id).order("period"),
    state.sb.from("discipline_scores").select("*").eq("student_id",state.profile.id),
    state.sb.rpc("student_report_stats",{p_student:state.profile.id})
  ]);
  if(scoreError)throw scoreError;
  if(disciplineError)throw disciplineError;
  if(reportStatsError)throw reportStatsError;

  const passingScore=Number(settings?.passing_score??reportStats?.passing_score??10);
  const attendanceStats=reportStats?.attendance||{};
  const subjects=grade
    ? state.subjects.filter(s=>s.grade_id===grade.id)
    : [...new Set((scores||[]).map(s=>s.subject_id))].map(id=>byId(state.subjects,id)).filter(Boolean);
  const scoreFor=(sid,needle)=>(scores||[]).find(s=>s.subject_id===sid&&String(s.period||"").includes(needle));
  const values=[];
  const trend=[];

  const rows=subjects.map((sub,i)=>{
    const p1=scoreFor(sub.id,"اول")||{},p2=scoreFor(sub.id,"دوم")||{};
    const lesson1=p1.lesson_score==null?null:Number(p1.lesson_score);
    const lesson2=p2.lesson_score==null?null:Number(p2.lesson_score);
    const annual=lesson1!=null&&lesson2!=null?(lesson1+lesson2)/2:null;
    const delta=lesson1!=null&&lesson2!=null?lesson2-lesson1:null;
    if(annual!=null)values.push(annual);
    trend.push({title:sub.title,first:lesson1,second:lesson2});

    const status=annual==null?"نمره ناقص":annual>=passingScore?"قبول":"نیاز به تلاش";
    const objectionScore=p2.id||p1.id;
    return `<tr>
      <td>${i+1}</td><td class="subject-cell">${esc(sub.title)}</td>
      <td>${p1.continuous_score??"-"}</td><td>${p1.final_score??"-"}</td><td class="term-score">${lesson1==null?"-":lesson1.toFixed(2)}</td>
      <td>${p2.continuous_score??"-"}</td><td>${p2.final_score??"-"}</td><td class="term-score">${lesson2==null?"-":lesson2.toFixed(2)}</td>
      <td class="score-delta ${delta!=null&&delta>0?"positive":delta!=null&&delta<0?"negative":""}">${delta==null?"-":(delta>0?"+":"")+delta.toFixed(2)}</td>
      <td class="annual-score">${annual==null?"-":annual.toFixed(2)}</td>
      <td><span class="badge ${annual==null||annual<passingScore?"warn":""}">${status}</span></td>
      <td class="no-print">${objectionScore?`<button class="btn btn-ghost obj-btn" data-id="${objectionScore}" data-subject="${sub.id}" ${settings?.objections_open?"":"disabled"}>اعتراض</button>`:"-"}</td>
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
      <div class="report-meta report-meta-v7">
        <span><b>نام دانش‌آموز:</b> ${esc(state.profile.full_name)}</span>
        <span><b>کد ملی:</b> ${esc(state.profile.national_id)}</span>
        <span><b>پایه:</b> ${esc(grade?.title||"-")}</span>
        <span><b>کلاس:</b> ${esc(myClass?.title||"-")}</span>
        <span><b>نوبت:</b> اول و دوم</span>
        <span><b>حد نصاب قبولی:</b> ${toFaDigits(passingScore)}</span>
      </div>
      <div class="table-wrap report-table-wrap">
        <table class="report-table report-table-v7">
          <thead>
            <tr>
              <th rowspan="2">ردیف</th><th rowspan="2">نام درس</th>
              <th colspan="3">نوبت اول</th><th colspan="3">نوبت دوم</th>
              <th rowspan="2">تغییر</th><th rowspan="2">نمره سالانه</th><th rowspan="2">وضعیت</th><th rowspan="2" class="no-print">اعتراض</th>
            </tr>
            <tr><th>تکوینی</th><th>پایانی</th><th>نمره درس</th><th>تکوینی</th><th>پایانی</th><th>نمره درس</th></tr>
          </thead>
          <tbody>${rows||'<tr><td colspan="12" class="empty">هنوز نمره‌ای ثبت نشده است.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="report-summary report-summary-v7">
        <div><small>معدل</small><strong>${average==null?"-":average.toFixed(2)}</strong></div>
        <div><small>انضباط</small><strong>${esc(disciplineText)}</strong></div>
        <div><small>نتیجه</small><strong>${average==null?"-":average>=passingScore?"قبول":"نیاز به تلاش"}</strong></div>
        <div><small>کل غیبت</small><strong>${toFaDigits(attendanceStats.total_absence||0)}</strong></div>
        <div><small>غیبت غیرموجه</small><strong>${toFaDigits(attendanceStats.unexcused_absence||0)}</strong></div>
        <div><small>تأخیر</small><strong>${toFaDigits(attendanceStats.late||0)}</strong></div>
      </div>
      <div class="report-chart no-print">
        <div class="panel-head"><h3>روند نمرات نوبت اول و دوم</h3><div class="report-chart-legend"><span>نوبت اول</span><span>نوبت دوم</span></div></div>
        <canvas id="reportTrendChart" height="180"></canvas>
      </div>
      <div class="report-signatures"><span>امضای مدیر مدرسه</span><span>امضای ولی دانش‌آموز</span></div>
    </section>`;

  $("#printReport").onclick=()=>window.print();
  drawReportTrend(trend);
  document.querySelectorAll(".obj-btn").forEach(b=>b.onclick=()=>studentObjectionModal(b.dataset.id,b.dataset.subject));
}

function drawReportTrend(items){
  const canvas=$("#reportTrendChart");if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const cssWidth=Math.max(620,canvas.parentElement?.clientWidth-20||900),h=180;
  canvas.width=Math.floor(cssWidth*dpr);canvas.height=Math.floor(h*dpr);
  canvas.style.width=cssWidth+"px";canvas.style.height=h+"px";
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,cssWidth,h);
  const left=38,right=12,top=15,bottom=32,plotW=cssWidth-left-right,plotH=h-top-bottom;
  ctx.font="10px Vazirmatn";ctx.textAlign="center";
  for(let y=0;y<=20;y+=5){
    const py=top+plotH-(y/20)*plotH;
    ctx.strokeStyle="#dbe7e5";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(cssWidth-right,py);ctx.stroke();
    ctx.fillStyle="#748987";ctx.fillText(toFaDigits(y),18,py+3);
  }
  const valid=items.filter(x=>x.first!=null||x.second!=null);
  if(!valid.length){ctx.fillStyle="#748987";ctx.fillText("نمره کافی برای نمایش نمودار وجود ندارد.",cssWidth/2,h/2);return}
  const step=plotW/Math.max(1,valid.length);
  const drawSeries=(key,color)=>{
    const ps=valid.map((x,i)=>({x:left+i*step+step/2,y:top+plotH-(Number(x[key]??0)/20)*plotH,v:x[key]})).filter(p=>p.v!=null);
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
    ctx.fillStyle=color;ps.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill()});
  };
  drawSeries("first","#0a756b");drawSeries("second","#c99b3f");
  ctx.fillStyle="#607775";ctx.font="9px Vazirmatn";
  valid.forEach((x,i)=>ctx.fillText(String(x.title).slice(0,11),left+i*step+step/2,h-8));
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
  const [{data,error},{data:mfaFactors,error:mfaError}]=await Promise.all([
    state.sb.from("school_settings").select("*").eq("id",true).single(),
    state.sb.auth.mfa.listFactors()
  ]);
  if(error)throw error;
  if(mfaError)throw mfaError;
  const verifiedMfa=(mfaFactors?.totp||[]).filter(f=>f.status==="verified");
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
      <div class="card setting-card">
        <div><span class="setting-icon">۲۰</span><div><h3>حد نصاب قبولی</h3><p class="muted">مبنای وضعیت «قبول» در کارنامه.</p></div></div>
        <div class="actions"><input id="passingScoreInput" class="compact-number" inputmode="decimal" value="${data.passing_score??10}"><button class="btn btn-ghost" id="savePassingScore">ذخیره</button></div>
      </div>
      <div class="card mfa-status-card">
        <div class="mfa-status-main">
          <span class="mfa-shield">✓</span>
          <div>
            <h3>ورود دومرحله‌ای مدیر</h3>
            <p class="muted">TOTP سازگار با Ente Auth؛ برای ورود مدیر اجباری است.</p>
          </div>
        </div>
        <div class="actions">
          <span class="badge">${verifiedMfa.length?"Ente Auth متصل":"نیاز به اتصال"}</span>
          ${verifiedMfa.length?'<button class="btn btn-ghost danger" id="resetManagerMfa">اتصال مجدد</button>':""}
        </div>
      </div>
      <div class="card settings-status-card">
        <h3>وضعیت سامانه</h3>
        <div class="pill-row">
          <span class="badge ${data.objections_open?"":"warn"}">${data.objections_open?"اعتراض فعال":"اعتراض بسته"}</span>
          <span class="badge ${data.report_cards_open!==false?"":"warn"}">${data.report_cards_open!==false?"کارنامه فعال":"کارنامه بسته"}</span>
          <span class="badge">MFA مدیر فعال</span>
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
  if($("#savePassingScore"))$("#savePassingScore").onclick=async()=>{
    try{
      const value=num($("#passingScoreInput").value);
      if(value===null)throw new Error("حد نصاب را وارد کنید.");
      const {error}=await state.sb.from("school_settings").update({passing_score:value,updated_at:new Date().toISOString(),updated_by:state.profile.id}).eq("id",true);
      if(error)throw error;
      toast("حد نصاب قبولی ذخیره شد.");
    }catch(e){toast(errText(e),true)}
  };
  if($("#resetManagerMfa"))$("#resetManagerMfa").onclick=async()=>{
    try{await resetManagerMfa()}catch(e){toast(errText(e),true)}
  };
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
  const rows=active.map(e=>`<tr><td><input class="archive-score-check" type="checkbox" data-key="${e.field_id}|${e.student_id}"></td><td>${esc(userName(e.student_id))}</td><td>${esc(fieldMap.get(e.field_id)?.title||"-")}</td><td><strong>${e.score}</strong></td><td>${esc(userName(e.submitted_by))}</td><td>${faDateTime(e.updated_at)}</td></tr>`).join("");
  modal(`نمرات سرگروه — ${group.name}`,`<div class="panel-head"><div><p class="muted">نمرات موردنظر را انتخاب کنید؛ پس از بایگانی از لیست فعال حذف می‌شوند.</p></div><button type="button" class="btn btn-ghost" id="selectAllGroupScores">انتخاب همه</button></div><br>
    <div class="table-wrap"><table><thead><tr><th></th><th>دانش‌آموز</th><th>فیلد</th><th>نمره</th><th>ثبت‌کننده</th><th>زمان</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">نمره فعالی ثبت نشده است.</td></tr>'}</tbody></table></div>
    <div class="archive-action-bar"><span id="archiveSelectionCount">۰ مورد انتخاب شده</span><button type="button" class="btn btn-primary" id="archiveSelectedScores" ${active.length?"":"disabled"}>انتقال انتخاب‌شده‌ها به بایگانی</button></div>`,
    async()=>$("#modal").close(),"بستن");

  const checks=()=>[...document.querySelectorAll(".archive-score-check")];
  const updateCount=()=>$("#archiveSelectionCount").textContent=`${checks().filter(x=>x.checked).length} مورد انتخاب شده`;
  checks().forEach(x=>x.onchange=updateCount);
  $("#selectAllGroupScores").onclick=()=>{
    const list=checks(),all=list.length&&list.every(x=>x.checked);
    list.forEach(x=>x.checked=!all);updateCount();
  };
  $("#archiveSelectedScores").onclick=async()=>{
    const btn=$("#archiveSelectedScores");
    const keys=checks().filter(x=>x.checked).map(x=>x.dataset.key);
    if(!keys.length)return toast("حداقل یک نمره را انتخاب کنید.",true);
    const old=btn.textContent;btn.disabled=true;btn.textContent="در حال بایگانی…";
    try{
      const {data,error}=await state.sb.rpc("archive_group_scores_v2",{p_group:group.id,p_keys:keys});
      if(error)throw error;
      clearPageCache("groups:");
      toast(`${data||keys.length} نمره به بایگانی منتقل شد.`);
      $("#modal").close();
      renderGroups();
    }catch(e){
      toast(errText(e),true);
      btn.disabled=false;btn.textContent=old;
    }
  };
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

async function renderExcelImport(){
  setPage("ورود اطلاعات از اکسل","بارگذاری گروهی کلاس‌ها، دروس، دبیران، دانش‌آموزان و تخصیص‌ها");
  $("#content").innerHTML=`<div class="grid-2 excel-import-grid">
    <div class="card">
      <div class="panel-head"><div><h3>فایل اکسل مدرسه</h3><p class="muted">ابتدا نمونه را دانلود و ستون‌ها را بدون تغییر نام تکمیل کنید.</p></div><button class="btn btn-ghost" id="downloadExcelSample">دانلود نمونه اکسل</button></div>
      <label class="excel-drop" for="schoolExcelFile"><strong>انتخاب فایل Excel</strong><span>فرمت .xlsx</span><input id="schoolExcelFile" type="file" accept=".xlsx,.xls" hidden></label>
      <div id="excelPreview" class="excel-preview muted">هنوز فایلی انتخاب نشده است.</div>
      <button class="btn btn-primary full" id="startExcelImport" disabled>شروع ورود اطلاعات</button>
    </div>
    <div class="card"><h3>برگه‌های موردنیاز</h3><div class="excel-sheet-list">
      <span>کلاس‌ها</span><span>دروس</span><span>کاربران</span><span>تخصیص دبیران</span>
    </div><p class="muted">در برگه «کاربران» نقش کاربر، نام و نام خانوادگی و کد ملی الزامی است. برای دانش‌آموز می‌توان پایه، کلاس و سال تحصیلی را نیز درج کرد تا عضویت کلاس خودکار ثبت شود. نام کاربری و رمز اولیه همان کد ملی است.</p></div>
  </div>`;
  let parsed=null;
  $("#downloadExcelSample").onclick=downloadExcelTemplate;
  $("#schoolExcelFile").onchange=async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      $("#excelPreview").innerHTML='<span class="loading-dot">در حال خواندن فایل…</span>';
      parsed=await readSchoolExcel(file);
      const counts=Object.entries(parsed).map(([k,v])=>`${k}: ${toFaDigits(v.length)}`).join(" | ");
      $("#excelPreview").innerHTML=`<strong>فایل آماده است.</strong><br>${esc(counts)}`;
      $("#startExcelImport").disabled=false;
    }catch(err){
      parsed=null;$("#startExcelImport").disabled=true;$("#excelPreview").textContent=errText(err);toast(errText(err),true);
    }
  };
  $("#startExcelImport").onclick=async()=>{
    if(!parsed)return;
    const btn=$("#startExcelImport"),preview=$("#excelPreview");
    btn.disabled=true;
    try{
      await importSchoolExcel(parsed,msg=>preview.innerHTML=`<div class="excel-progress"><span class="spinner"></span>${esc(msg)}</div>`);
      preview.innerHTML='<strong class="success-text">ورود اطلاعات با موفقیت انجام شد.</strong>';
      toast("اطلاعات اکسل وارد سامانه شد.");
    }catch(err){
      preview.textContent=errText(err);toast(errText(err),true);
    }finally{btn.disabled=false}
  };
}

async function downloadExcelTemplate(){
  const XLSX=await ensureSheetJS();
  const wb=XLSX.utils.book_new();
  const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows,{skipHeader:false}),name);
  add("کلاس‌ها",[
    {"پایه":"هفتم","کلاس":"۷/۱","سال تحصیلی":"۱۴۰۵-۱۴۰۶"},
    {"پایه":"هشتم","کلاس":"۸/۱","سال تحصیلی":"۱۴۰۵-۱۴۰۶"}
  ]);
  add("دروس",[
    {"پایه":"هفتم","درس":"ریاضی"},
    {"پایه":"هفتم","درس":"علوم"}
  ]);
  add("کاربران",[
    {"نقش کاربر":"دبیر","نام و نام خانوادگی":"علی رضایی","کد ملی":"0012345678","پایه":"","کلاس":"","سال تحصیلی":""},
    {"نقش کاربر":"دانش‌آموز","نام و نام خانوادگی":"محمد احمدی","کد ملی":"0012345679","پایه":"هفتم","کلاس":"۷/۱","سال تحصیلی":"۱۴۰۵-۱۴۰۶"}
  ]);
  add("تخصیص دبیران",[
    {"کد ملی دبیر":"0012345678","پایه":"هفتم","کلاس":"۷/۱","سال تحصیلی":"۱۴۰۵-۱۴۰۶","درس":"ریاضی"}
  ]);
  XLSX.writeFile(wb,"نمونه-ورود-اطلاعات-مدرسه-v6.1.0.xlsx",{compression:true});
}
function normalizeExcelText(v){return String(v??"").trim();}
function excelValue(row,...keys){
  for(const k of keys){
    if(row[k]!==undefined&&row[k]!==null&&String(row[k]).trim()!=="")return normalizeExcelText(row[k]);
  }
  return "";
}

async function readSchoolExcel(file){
  const XLSX=await ensureSheetJS();
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
  const read=names=>{
    const name=names.find(n=>wb.SheetNames.includes(n));
    if(!name)return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:"",raw:false});
  };
  const classes=read(["کلاس‌ها","Classes"]).map(r=>({
    grade:excelValue(r,"پایه","grade","Grade"),
    title:excelValue(r,"کلاس","class","Class"),
    year:excelValue(r,"سال تحصیلی","year","Academic Year")||"۱۴۰۵-۱۴۰۶"
  }));
  const subjects=read(["دروس","Subjects"]).map(r=>({
    grade:excelValue(r,"پایه","grade","Grade"),
    title:excelValue(r,"درس","subject","Subject")
  }));

  const roleFrom=v=>{
    const x=normalizeExcelText(v).toLowerCase();
    if(["teacher","دبیر","معلم"].includes(x))return "teacher";
    if(["student","دانش‌آموز","دانش اموز"].includes(x))return "student";
    return "";
  };
  const unifiedUsers=read(["کاربران","Users"]).map(r=>({
    role:roleFrom(excelValue(r,"نقش کاربر","نقش","role","Role")),
    name:excelValue(r,"نام و نام خانوادگی","name","Full Name"),
    nid:toEnDigits(excelValue(r,"کد ملی","national_id","National ID")),
    grade:excelValue(r,"پایه","grade","Grade"),
    classTitle:excelValue(r,"کلاس","class","Class"),
    year:excelValue(r,"سال تحصیلی","year","Academic Year")||"۱۴۰۵-۱۴۰۶"
  }));
  const legacyTeachers=read(["دبیران","Teachers"]).map(r=>({
    role:"teacher",name:excelValue(r,"نام و نام خانوادگی","name","Full Name"),
    nid:toEnDigits(excelValue(r,"کد ملی","national_id","National ID")),grade:"",classTitle:"",year:""
  }));
  const legacyStudents=read(["دانش‌آموزان","Students"]).map(r=>({
    role:"student",name:excelValue(r,"نام و نام خانوادگی","name","Full Name"),
    nid:toEnDigits(excelValue(r,"کد ملی","national_id","National ID")),
    grade:excelValue(r,"پایه","grade","Grade"),
    classTitle:excelValue(r,"کلاس","class","Class"),
    year:excelValue(r,"سال تحصیلی","year","Academic Year")||"۱۴۰۵-۱۴۰۶"
  }));
  const users=unifiedUsers.length?unifiedUsers:[...legacyTeachers,...legacyStudents];
  const teachers=users.filter(u=>u.role==="teacher");
  const students=users.filter(u=>u.role==="student");

  const assignments=read(["تخصیص دبیران","TeacherAssignments","Assignments"]).map(r=>({
    nid:toEnDigits(excelValue(r,"کد ملی دبیر","teacher_national_id","Teacher National ID")),
    grade:excelValue(r,"پایه","grade","Grade"),
    classTitle:excelValue(r,"کلاس","class","Class"),
    year:excelValue(r,"سال تحصیلی","year","Academic Year")||"۱۴۰۵-۱۴۰۶",
    subject:excelValue(r,"درس","subject","Subject")
  }));

  if(!classes.length&&!subjects.length&&!users.length&&!assignments.length)throw new Error("هیچ‌کدام از برگه‌های نمونه در فایل پیدا نشد.");
  users.forEach(u=>{
    if(!u.role)throw new Error(`نقش کاربر برای ${u.name||u.nid||"یک ردیف"} باید «دبیر» یا «دانش‌آموز» باشد.`);
    if(!u.name||!/^\d{10}$/.test(u.nid))throw new Error(`نام یا کد ملی نامعتبر در فایل: ${u.name||u.nid||"ردیف نامشخص"}`);
    if(u.role==="student"&&((u.grade&&!u.classTitle)||(!u.grade&&u.classTitle)))throw new Error(`پایه و کلاس دانش‌آموز ${u.name} باید با هم تکمیل شوند.`);
  });
  classes.forEach(x=>{if(!x.grade||!x.title)throw new Error("در برگه کلاس‌ها، پایه و کلاس الزامی است.")});
  subjects.forEach(x=>{if(!x.grade||!x.title)throw new Error("در برگه دروس، پایه و درس الزامی است.")});
  assignments.forEach(x=>{if(!/^\d{10}$/.test(x.nid)||!x.grade||!x.classTitle||!x.subject)throw new Error("یک ردیف تخصیص دبیر ناقص یا نامعتبر است.")});

  return {"کلاس‌ها":classes,"دروس":subjects,"دبیران":teachers,"دانش‌آموزان":students,"کاربران":users,"تخصیص‌ها":assignments};
}

async function importSchoolExcel(data,onProgress=()=>{}){
  const classes=data["کلاس‌ها"],subjects=data["دروس"],teachers=data["دبیران"],students=data["دانش‌آموزان"],assignments=data["تخصیص‌ها"];
  const key=v=>normalizeExcelText(v).toLocaleLowerCase("fa");
  const gradeTitles=[...new Set([...classes.map(x=>x.grade),...subjects.map(x=>x.grade),...students.map(x=>x.grade),...assignments.map(x=>x.grade)].filter(Boolean))];

  onProgress("ثبت پایه‌ها…");
  const existingGrades=new Set(state.grades.map(g=>key(g.title)));
  const newGrades=gradeTitles.filter(x=>!existingGrades.has(key(x))).map((title,i)=>({title,sort_order:state.grades.length+i+1}));
  if(newGrades.length){
    const {error}=await state.sb.from("grade_levels").upsert(newGrades,{onConflict:"title",ignoreDuplicates:true});
    if(error)throw error;
  }
  await refreshRefs(true);
  let gradeMap=new Map(state.grades.map(g=>[key(g.title),g]));

  onProgress("ثبت کلاس‌ها…");
  const classPayload=[];const classSeen=new Set();
  const existingClassKeys=new Set(state.classes.map(cl=>`${cl.grade_id}|${key(cl.title)}|${toFaDigits(cl.academic_year)}`));
  for(const x of [...classes,...students.filter(x=>x.grade&&x.classTitle),...assignments]){
    const g=gradeMap.get(key(x.grade));if(!g)continue;
    const year=toFaDigits(x.year||"۱۴۰۵-۱۴۰۶"),k=`${g.id}|${key(x.classTitle)}|${year}`;
    if(!classSeen.has(k)&&!existingClassKeys.has(k)){classSeen.add(k);classPayload.push({grade_id:g.id,title:x.classTitle,academic_year:year})}
  }
  if(classPayload.length){
    const {error}=await state.sb.from("classes").upsert(classPayload,{onConflict:"grade_id,title,academic_year",ignoreDuplicates:true});
    if(error)throw error;
  }
  await refreshRefs(true);
  gradeMap=new Map(state.grades.map(g=>[key(g.title),g]));

  onProgress("ثبت دروس…");
  const subjectPayload=[];const subjectSeen=new Set();
  for(const x of [...subjects,...assignments.map(a=>({grade:a.grade,title:a.subject}))]){
    const g=gradeMap.get(key(x.grade));if(!g)continue;
    const k=`${g.id}|${key(x.title)}`;
    if(!subjectSeen.has(k)){subjectSeen.add(k);subjectPayload.push({grade_id:g.id,title:x.title})}
  }
  if(subjectPayload.length){
    const {error}=await state.sb.from("subjects").upsert(subjectPayload,{onConflict:"grade_id,title",ignoreDuplicates:true});
    if(error)throw error;
  }

  onProgress("ساخت حساب دبیران و دانش‌آموزان…");
  await refreshRefs(true);
  const people=[...teachers.map(x=>({...x,role:"teacher"})),...students.map(x=>({...x,role:"student"}))];
  const byNid=new Map();
  for(const p of people){
    if(byNid.has(p.nid)&&byNid.get(p.nid).role!==p.role)throw new Error(`کد ملی ${p.nid} هم برای دبیر و هم دانش‌آموز آمده است.`);
    byNid.set(p.nid,p);
  }
  const existing=new Map(state.profiles.map(p=>[toEnDigits(p.national_id),p]));
  const jobs=[...byNid.values()];
  for(let i=0;i<jobs.length;i+=6){
    const batch=jobs.slice(i,i+6);
    await Promise.all(batch.map(async p=>{
      const old=existing.get(p.nid);
      if(old){
        if(old.full_name!==p.name||old.role!==p.role){
          await invokeFunction("admin-user",{action:"update",user_id:old.id,national_id:p.nid,full_name:p.name,role:p.role});
        }
      }else{
        await invokeFunction("admin-user",{action:"create",national_id:p.nid,full_name:p.name,role:p.role});
      }
    }));
    onProgress(`ساخت کاربران… ${Math.min(i+6,jobs.length)} از ${jobs.length}`);
  }
  await refreshRefs(true);

  const classMap=new Map(state.classes.map(cl=>{
    const g=byId(state.grades,cl.grade_id);
    return [`${key(g?.title)}|${key(cl.title)}|${toFaDigits(cl.academic_year)}`,cl];
  }));
  const subjectMap=new Map(state.subjects.map(s=>{
    const g=byId(state.grades,s.grade_id);
    return [`${key(g?.title)}|${key(s.title)}`,s];
  }));
  const profileMap=new Map(state.profiles.map(p=>[toEnDigits(p.national_id),p]));

  onProgress("عضویت دانش‌آموزان در کلاس‌ها…");
  const studentRows=[];
  students.forEach(s=>{
    if(!s.grade||!s.classTitle)return;
    const cl=classMap.get(`${key(s.grade)}|${key(s.classTitle)}|${toFaDigits(s.year)}`);
    const p=profileMap.get(s.nid);
    if(!cl)throw new Error(`کلاس ${s.grade} / ${s.classTitle} برای ${s.name} پیدا نشد.`);
    if(p)studentRows.push({class_id:cl.id,student_id:p.id});
  });
  if(studentRows.length){
    const {error}=await state.sb.from("class_students").upsert(studentRows,{onConflict:"class_id,student_id",ignoreDuplicates:true});
    if(error)throw error;
  }

  onProgress("تخصیص دبیران به دروس…");
  const teacherRows=[];
  assignments.forEach(a=>{
    const p=profileMap.get(a.nid);
    const cl=classMap.get(`${key(a.grade)}|${key(a.classTitle)}|${toFaDigits(a.year)}`);
    const sub=subjectMap.get(`${key(a.grade)}|${key(a.subject)}`);
    if(!p||p.role!=="teacher")throw new Error(`دبیر با کد ملی ${a.nid} پیدا نشد.`);
    if(!cl)throw new Error(`کلاس تخصیص ${a.grade} / ${a.classTitle} پیدا نشد.`);
    if(!sub)throw new Error(`درس ${a.subject} برای پایه ${a.grade} پیدا نشد.`);
    teacherRows.push({teacher_id:p.id,class_id:cl.id,subject_id:sub.id});
  });
  if(teacherRows.length){
    const {error}=await state.sb.from("teacher_assignments").upsert(teacherRows,{onConflict:"teacher_id,class_id,subject_id",ignoreDuplicates:true});
    if(error)throw error;
  }
  state.refsLoadedAt=0;
  state.pageCache.clear();
  await refreshRefs(true);
  onProgress("پایان؛ همه اطلاعات ثبت شد.");
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