(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;

const reportTypes={
  students:"دانش‌آموزان",
  teachers:"دبیران",
  classes:"کلاس‌ها",
  scores:"نمرات",
  averages:"معدل‌ها",
  attendance:"حضور و غیاب",
  homework:"تکالیف",
  exams:"آزمون‌ها",
  discipline:"انضباط",
  behavior:"رفتار و تشویق",
  objections:"اعتراض‌ها",
  extracurricular:"فوق‌برنامه‌ها",
  forms:"فرم‌ها",
  polls:"نظرسنجی‌ها"
};
const labels={
  name:"نام",national_id:"کد ملی",class:"کلاس",grade:"پایه",academic_year:"سال تحصیلی",active:"فعال",
  assignments:"تعداد تخصیص",students:"دانش‌آموزان",teacher_assignments:"تخصیص دبیر",student:"دانش‌آموز",
  subject:"درس",period:"نوبت",continuous:"تکوینی",final:"پایانی",lesson:"نمره درس",average:"معدل",
  completed_lessons:"دروس دارای نمره",date:"تاریخ",status:"وضعیت",delay_minutes:"دقیقه تأخیر",note:"توضیح",
  assignment:"تکلیف",score:"نمره",source:"منبع",due_at:"مهلت",exam:"آزمون",auto_score:"نمره خودکار",
  manual_score:"نمره دستی",total_score:"نمره کل",started_at:"شروع",submitted_at:"ارسال",category:"دسته",
  type:"نوع",title:"عنوان",points:"امتیاز",description:"توضیح",component:"بخش",reason:"علت",response:"پاسخ",
  created_at:"ایجاد",resolved_at:"رسیدگی",registered_at:"ثبت‌نام",teacher:"دبیر",form:"فرم",user:"کاربر",
  poll:"نظرسنجی",anonymous:"ناشناس",participants:"مشارکت",starts_at:"شروع",ends_at:"پایان",updated_at:"به‌روزرسانی"
};
let currentRows=[],currentType="students",currentFilters={};

function isoDate(offset=0){
  const d=new Date();d.setDate(d.getDate()+offset);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
function faValue(v,key){
  if(v===null||v===undefined||v==="")return "-";
  if(typeof v==="boolean")return v?"بله":"خیر";
  if(["due_at","started_at","submitted_at","created_at","resolved_at","registered_at","starts_at","ends_at","updated_at"].includes(key)){
    try{return api.faDateTime(v)}catch(_){}
  }
  if(key==="date"||/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v)))return api.toFaDigits(v);
  return api.toFaDigits(String(v));
}
function columns(rows){
  const priority=["name","student","national_id","grade","class","subject","teacher","period","date","title","assignment","exam","form","poll","status","score","average"];
  const set=new Set();rows.forEach(r=>Object.keys(r||{}).forEach(k=>set.add(k)));
  return [...set].sort((a,b)=>{
    const ia=priority.indexOf(a),ib=priority.indexOf(b);
    return (ia<0?999:ia)-(ib<0?999:ib);
  });
}
async function loadReport(){
  currentType=$("#reportType").value;
  currentFilters={
    class_id:$("#reportClass").value||null,
    subject_id:$("#reportSubject").value||null,
    student_id:$("#reportStudent").value||null,
    teacher_id:$("#reportTeacher").value||null,
    from:$("#reportFrom").value||null,
    to:$("#reportTo").value||null
  };
  const area=$("#reportArea");
  area.innerHTML='<div class="card empty">در حال تهیه گزارش…</div>';
  const {data,error}=await api.state.sb.rpc("report_data",{p_type:currentType,p_filters:currentFilters});
  if(error){area.innerHTML="";throw error}
  currentRows=Array.isArray(data)?data:[];
  renderTable();
}
function renderTable(){
  const cols=columns(currentRows);
  const head=cols.map(c=>`<th>${api.esc(labels[c]||c)}</th>`).join("");
  const body=currentRows.map(r=>`<tr>${cols.map(c=>`<td>${api.esc(faValue(r[c],c))}</td>`).join("")}</tr>`).join("");
  $("#reportArea").innerHTML=`<section class="report-output card" id="reportPrintable">
    <div class="report-output-head">
      <div><h2>سامانه آموزش و پرورش استان اصفهان</h2><h3>${api.esc(reportTypes[currentType]||currentType)}</h3></div>
      <div><small>تاریخ تهیه گزارش</small><strong>${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"long"}).format(new Date())}</strong></div>
    </div>
    <div class="report-filter-summary">${Object.entries(currentFilters).filter(([,v])=>v).map(([k,v])=>`<span>${api.esc(labels[k.replace("_id","")]||k)}: ${api.esc(String(v))}</span>`).join("")}</div>
    <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${Math.max(1,cols.length)}" class="empty">داده‌ای برای این گزارش وجود ندارد.</td></tr>`}</tbody></table></div>
    <div class="report-output-footer"><span>تعداد ردیف: ${api.toFaDigits(currentRows.length)}</span><span>نسخه v-7</span></div>
  </section>`;
}
async function ensureXLSX(){
  if(window.XLSX)return window.XLSX;
  await new Promise((resolve,reject)=>{
    const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error("بارگذاری ابزار Excel ناموفق بود."));document.head.appendChild(s);
  });
  return window.XLSX;
}
async function exportExcel(){
  if(!currentRows.length)return api.toast("گزارش خالی است.",true);
  const btn=$("#reportExcel"),old=btn.textContent;btn.disabled=true;btn.textContent="در حال ساخت Excel…";
  try{
    const XLSX=await ensureXLSX(),cols=columns(currentRows);
    const rows=currentRows.map(r=>Object.fromEntries(cols.map(c=>[labels[c]||c,faValue(r[c],c)])));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!rtl"]=true;
    ws["!cols"]=cols.map(c=>({wch:Math.max(14,Math.min(35,Math.max((labels[c]||c).length,...rows.slice(0,100).map(r=>String(r[labels[c]||c]??"").length))+2))}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"گزارش");
    XLSX.writeFile(wb,`گزارش-${reportTypes[currentType]||currentType}-v7.xlsx`,{compression:true});
  }catch(e){api.toast(api.errText(e),true)}
  finally{btn.disabled=false;btn.textContent=old}
}
function printReport(){
  document.body.classList.add("printing-report");
  window.print();
  setTimeout(()=>document.body.classList.remove("printing-report"),500);
}
async function render(){
  if(api.state.profile.role!=="manager"){api.setPage("گزارش‌ها","");$("#content").innerHTML='<div class="card empty">این بخش فقط برای مدیر مدرسه در دسترس است.</div>';return}
  api.setPage("گزارش‌ها","گزارش‌های فیلترپذیر، Excel واقعی و چاپ/PDF");
  const st=api.state;
  $("#content").innerHTML=`<div class="card">
    <div class="report-controls">
      <label><span>نوع گزارش</span><select id="reportType">${Object.entries(reportTypes).map(([v,t])=>`<option value="${v}">${t}</option>`).join("")}</select></label>
      <label><span>کلاس</span><select id="reportClass"><option value="">همه</option>${st.classes.map(c=>`<option value="${c.id}">${api.esc(api.className(c.id))}</option>`).join("")}</select></label>
      <label><span>درس</span><select id="reportSubject"><option value="">همه</option>${st.subjects.map(s=>`<option value="${s.id}">${api.esc(s.title)}</option>`).join("")}</select></label>
      <label><span>دانش‌آموز</span><select id="reportStudent"><option value="">همه</option>${st.profiles.filter(p=>p.role==="student").map(p=>`<option value="${p.id}">${api.esc(p.full_name)}</option>`).join("")}</select></label>
      <label><span>دبیر</span><select id="reportTeacher"><option value="">همه</option>${st.profiles.filter(p=>p.role==="teacher").map(p=>`<option value="${p.id}">${api.esc(p.full_name)}</option>`).join("")}</select></label>
      <label><span>از تاریخ</span><input id="reportFrom" type="date" value="${isoDate(-30)}"></label>
      <label><span>تا تاریخ</span><input id="reportTo" type="date" value="${isoDate()}"></label>
      <div class="actions report-control-actions"><button class="btn btn-primary" id="reportLoad">تهیه گزارش</button><button class="btn btn-ghost" id="reportExcel">Excel</button><button class="btn btn-ghost" id="reportPrint">چاپ / PDF</button></div>
    </div>
  </div><div id="reportArea"></div>`;
  $("#reportLoad").onclick=async()=>{try{await loadReport()}catch(e){api.toast(api.errText(e),true)}};
  $("#reportExcel").onclick=exportExcel;$("#reportPrint").onclick=printReport;
  await loadReport();
}
api.registerModule({nav:{manager:[["reports","گزارش‌ها"]]},routes:{reports:render}});
})();