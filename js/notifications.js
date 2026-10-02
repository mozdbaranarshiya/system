(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const typeLabels={homework_new:"تکلیف",homework_result:"نتیجه تکلیف",homework_revision:"اصلاح تکلیف",score_changed:"نمره",attendance:"حضور و غیاب",objection_result:"اعتراض",exam_new:"آزمون",exam_result:"نتیجه آزمون",announcement:"اطلاعیه",appointment:"ملاقات",form:"فرم",poll:"نظرسنجی",event:"رویداد"};
function ensureBell(){
  if($("#notificationBell"))return;
  const host=document.querySelector(".topbar-meta");if(!host)return;
  const b=document.createElement("button");b.id="notificationBell";b.className="topbar-notification";b.type="button";b.setAttribute("aria-label","اعلان‌ها");b.innerHTML='<span class="bell-glyph">●</span><span id="notificationBadge" class="notification-badge hidden">۰</span>';
  host.insertBefore(b,$("#logoutBtn"));
  b.onclick=()=>api.navigate("notifications");
}
async function refreshBadge(){
  ensureBell();
  if(!api.state.profile)return;
  const {count,error}=await api.state.sb.from("notifications").select("id",{count:"exact",head:true}).is("read_at",null);
  if(error)return;
  const badge=$("#notificationBadge");if(!badge)return;
  badge.textContent=api.toFaDigits(count||0);badge.classList.toggle("hidden",!count);
}
async function render(){
  api.setPage("اعلان‌ها","مرکز اعلان‌ها و یادآوری‌های سامانه");
  const {data,error}=await api.state.sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(150);
  if(error)throw error;
  const rows=(data||[]).map(n=>`<article class="notification-item ${n.read_at?"":"unread"}" data-id="${n.id}"><div class="notification-icon">${api.esc((typeLabels[n.type]||"اعلان").slice(0,1))}</div><div class="notification-main"><div class="panel-head"><strong>${api.esc(n.title)}</strong><small class="muted">${api.faDateTime(n.created_at)}</small></div><p>${api.esc(n.body||"")}</p><span class="badge">${api.esc(typeLabels[n.type]||n.type)}</span></div>${!n.read_at?'<button class="btn btn-ghost btn-sm mark-notification-read">خواندم</button>':""}</article>`).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>اعلان‌های من</h3><p class="muted">اعلان‌های مهم آموزشی و اجرایی در این بخش جمع می‌شوند.</p></div><button class="btn btn-ghost" id="markAllNotifications">همه خوانده شدند</button></div><div class="notification-list">${rows||'<div class="card empty">اعلان جدیدی ندارید.</div>'}</div>`;
  document.querySelectorAll(".mark-notification-read").forEach(b=>b.onclick=async()=>{
    const id=b.closest(".notification-item").dataset.id;
    const {error}=await api.state.sb.from("notifications").update({read_at:new Date().toISOString()}).eq("id",id);
    if(error)return api.toast(api.errText(error),true);render();refreshBadge();
  });
  $("#markAllNotifications").onclick=async()=>{
    const {error}=await api.state.sb.rpc("mark_all_notifications_read");
    if(error)return api.toast(api.errText(error),true);
    api.toast("همه اعلان‌ها خوانده‌شده علامت‌گذاری شدند.");render();refreshBadge();
  };
}
window.addEventListener("system:entered",async()=>{ensureBell();try{await api.state.sb.rpc("refresh_due_notifications")}catch(_){}refreshBadge();});
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshBadge()});
setInterval(()=>{if(!document.hidden&&api.state.profile)refreshBadge()},60000);
api.registerModule({nav:{manager:[["notifications","اعلان‌ها"]],teacher:[["notifications","اعلان‌ها"]],student:[["notifications","اعلان‌ها"]]},routes:{notifications:render}});
})();