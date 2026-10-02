(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const typeLabels={exam:"امتحان",holiday:"تعطیلی",parents_meeting:"جلسه اولیا",trip:"اردو",competition:"مسابقه",cultural:"برنامه فرهنگی",school_meeting:"جلسه مدرسه",deadline:"مهلت مهم",other:"سایر",homework:"تکلیف"};
const typeOptions=Object.entries(typeLabels).filter(([k])=>k!=="homework").map(([v,t])=>`<option value="${v}">${t}</option>`).join("");
function localIso(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function range(days=45){const a=new Date();a.setDate(a.getDate()-7);const b=new Date();b.setDate(b.getDate()+days);return [a.toISOString(),b.toISOString()]}
async function render(){
  api.setPage("تقویم آموزشی","رویدادها، تکالیف و برنامه‌های مهم مدرسه");
  const [from,to]=range();
  const {data,error}=await api.state.sb.rpc("calendar_feed",{p_from:from,p_to:to});
  if(error)throw error;
  const events=(data||[]).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));
  const manager=api.state.profile.role==="manager";
  const cards=events.map(e=>`<article class="calendar-event-card"><div class="calendar-date"><strong>${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{day:"numeric"}).format(new Date(e.start_at))}</strong><small>${new Intl.DateTimeFormat("fa-IR-u-ca-persian",{month:"short"}).format(new Date(e.start_at))}</small></div><div class="calendar-event-main"><div class="pill-row"><span class="badge">${api.esc(typeLabels[e.event_type]||e.event_type)}</span>${e.class_id?`<span class="badge">${api.esc(api.className(e.class_id))}</span>`:""}${e.subject_id?`<span class="badge">${api.esc(api.subjectName(e.subject_id))}</span>`:""}</div><h3>${api.esc(e.title)}</h3><p>${api.esc(e.description||"")}</p><small class="muted">${api.faDateTime(e.start_at)}${e.end_at&&e.end_at!==e.start_at?" تا "+api.faDateTime(e.end_at):""}</small></div>${manager&&e.source==="event"?`<button class="btn btn-ghost danger del-calendar-event" data-id="${e.entity_id}">حذف</button>`:""}</article>`).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>رویدادهای نزدیک</h3><p class="muted">تاریخ‌ها در رابط کاربری به تقویم شمسی نمایش داده می‌شوند.</p></div>${manager?'<button class="btn btn-primary" id="addCalendarEvent">+ رویداد جدید</button>':""}</div><div class="calendar-agenda">${cards||'<div class="card empty">رویدادی در این بازه وجود ندارد.</div>'}</div>`;
  if($("#addCalendarEvent"))$("#addCalendarEvent").onclick=eventModal;
  document.querySelectorAll(".del-calendar-event").forEach(b=>b.onclick=async()=>{if(!confirm("این رویداد حذف شود؟"))return;const {error}=await api.state.sb.from("calendar_events").delete().eq("id",b.dataset.id);if(error)return api.toast(api.errText(error),true);api.toast("رویداد حذف شد.");render();});
}
function eventModal(){
  const st=api.state,now=new Date(),later=new Date(now.getTime()+3600000);
  api.modal("رویداد جدید",`<div class="form-grid">
    <label class="wide"><span>عنوان</span><input id="ceTitle"></label>
    <label class="wide"><span>توضیحات</span><textarea id="ceDesc"></textarea></label>
    <label><span>نوع رویداد</span><select id="ceType">${typeOptions}</select></label>
    <label><span>مخاطب</span><select id="ceTarget"><option value="all">همه</option><option value="role">یک نقش</option><option value="grade">یک پایه</option><option value="class">یک کلاس</option><option value="user">یک کاربر</option></select></label>
    <label><span>شروع</span><input id="ceStart" type="datetime-local" value="${localIso(now)}"></label>
    <label><span>پایان</span><input id="ceEnd" type="datetime-local" value="${localIso(later)}"></label>
    <label><span>نقش</span><select id="ceRole"><option value="student">دانش‌آموزان</option><option value="teacher">دبیران</option></select></label>
    <label><span>پایه</span><select id="ceGrade">${st.grades.map(g=>`<option value="${g.id}">${api.esc(g.title)}</option>`).join("")}</select></label>
    <label><span>کلاس</span><select id="ceClass">${st.classes.map(c=>`<option value="${c.id}">${api.esc(api.className(c.id))}</option>`).join("")}</select></label>
    <label><span>کاربر</span><select id="ceUser">${st.profiles.filter(p=>p.role!=="manager").map(p=>`<option value="${p.id}">${api.esc(p.full_name)}</option>`).join("")}</select></label>
    <label><span>تمام‌روز</span><select id="ceAllDay"><option value="false">خیر</option><option value="true">بله</option></select></label>
  </div>`,async()=>{
    const target=$("#ceTarget").value;
    const payload={title:$("#ceTitle").value.trim(),description:$("#ceDesc").value.trim()||null,event_type:$("#ceType").value,start_at:new Date($("#ceStart").value).toISOString(),end_at:$("#ceEnd").value?new Date($("#ceEnd").value).toISOString():null,all_day:$("#ceAllDay").value==="true",target_type:target,target_role:null,target_grade_id:null,target_class_id:null,target_user_id:null,created_by:st.profile.id};
    if(!payload.title)throw new Error("عنوان رویداد الزامی است.");
    if(target==="role")payload.target_role=$("#ceRole").value;
    if(target==="grade")payload.target_grade_id=$("#ceGrade").value;
    if(target==="class")payload.target_class_id=$("#ceClass").value;
    if(target==="user")payload.target_user_id=$("#ceUser").value;
    const {error}=await st.sb.from("calendar_events").insert(payload);if(error)throw error;api.toast("رویداد ثبت شد.");render();
  },"ثبت رویداد");
}
api.registerModule({nav:{manager:[["calendar","تقویم آموزشی"]],teacher:[["calendar","تقویم آموزشی"]],student:[["calendar","تقویم آموزشی"]]},routes:{calendar:render}});
})();