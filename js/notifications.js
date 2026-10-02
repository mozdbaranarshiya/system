(() => {
"use strict";
const V=window.SchoolV8;

async function refreshBadge(){
  if(!V.state()?.profile)return;
  const {count,error}=await V.sb().from("notifications").select("id",{count:"exact",head:true}).is("read_at",null);
  if(error)return;
  const badge=document.querySelector("#notificationBadge");
  if(!badge)return;
  badge.textContent=V.fa(Math.min(count||0,99));
  badge.classList.toggle("hidden",!(count>0));
}
V.refreshNotificationBadge=refreshBadge;

V.registerRoute("notifications",async()=>{
  const A=V.app();
  A.setPage("مرکز اعلان‌ها","پیام‌ها، یادآوری‌ها و تغییرات مهم");
  const {data,error}=await V.sb().from("notifications").select("*").order("created_at",{ascending:false}).limit(120);
  if(error)throw error;
  const items=data||[];
  document.querySelector("#content").innerHTML=`
    <section class="card">
      <div class="panel-head">
        <div><h3>اعلان‌ها</h3><p class="muted">${V.fa(items.filter(x=>!x.read_at).length)} اعلان خوانده‌نشده</p></div>
        <button class="btn btn-ghost" id="markAllNotifications">خواندن همه</button>
      </div>
      <div class="notification-list">
        ${items.length?items.map(n=>`
          <article class="notification-item ${n.read_at?"":"unread"}" data-id="${n.id}">
            <button class="notification-main" data-link="${V.escape(n.link||"")}">
              <span class="notification-dot"></span>
              <span><strong>${V.escape(n.title)}</strong><p>${V.escape(n.body||"")}</p><small>${V.dateTime(n.created_at)}</small></span>
            </button>
            ${n.read_at?"":`<button class="btn btn-ghost btn-sm mark-notification" data-id="${n.id}">خواندم</button>`}
          </article>`).join(""):'<div class="empty">اعلانی ندارید.</div>'}
      </div>
    </section>`;

  document.querySelector("#markAllNotifications").onclick=async e=>{
    try{
      await V.withBusy(e.currentTarget,async()=>{
        await V.rpc("mark_all_notifications_read");
        await refreshBadge();
        V.success("همه اعلان‌ها خوانده‌شده شدند.");
        V.route("notifications");
      });
    }catch(err){V.showError(err)}
  };
  document.querySelectorAll(".mark-notification").forEach(b=>b.onclick=async()=>{
    const {error}=await V.sb().from("notifications").update({read_at:new Date().toISOString()}).eq("id",b.dataset.id);
    if(error)return V.showError(error);
    await refreshBadge();V.route("notifications");
  });
  document.querySelectorAll(".notification-main").forEach(b=>b.onclick=async()=>{
    const row=b.closest(".notification-item");
    if(row?.classList.contains("unread")){
      await V.sb().from("notifications").update({read_at:new Date().toISOString()}).eq("id",row.dataset.id);
      refreshBadge();
    }
    if(b.dataset.link)V.route(b.dataset.link);
  });
});

function bindBell(){
  const bell=document.querySelector("#notificationBell");
  if(bell&&!bell.dataset.bound){
    bell.dataset.bound="1";
    bell.onclick=()=>V.route("notifications");
  }
}
bindBell();
window.addEventListener("school:ready",()=>{bindBell();refreshBadge();});
setInterval(refreshBadge,60000);
})();