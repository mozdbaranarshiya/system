(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{state:s,$,esc:e}=c;
V.updateNotificationBadge=async()=>{
if(!s.profile||s.profile.must_change_password)return;
const {count,error}=await s.sb.from('notifications').select('id',{head:true,count:'exact'}).is('read_at',null);if(error)throw error;
$('#notificationCount').textContent=c.toFaDigits(count||0);$('#notificationCount').classList.toggle('hidden',!count);};
V.afterEnter=()=>{
$('#notificationButton').onclick=()=>c.navigate('notifications');V.setupSearch?.();
clearInterval(V.notificationTimer);V.updateNotificationBadge().catch(()=>{});V.notificationTimer=setInterval(()=>V.updateNotificationBadge().catch(()=>{}),60000);};
V.routes.notifications=async()=>{
let page=0;V.page('مرکز اعلان‌ها','تکالیف، آزمون‌ها و تغییرات مرتبط با شما',`<div class="card">${V.toolbar(V.button('readAllNotifications','همه خوانده شد','btn-ghost'))}<div id="notificationList"></div></div>`);
async function draw(){const {data,error,count}=await s.sb.from('notifications').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*30,page*30+29);if(error)throw error;
$('#notificationList').innerHTML=(data||[]).map(n=>`<div class="v7-notification ${n.read_at?'':'unread'}"><div><strong>${e(n.title)}</strong><p>${e(n.body)}</p><small>${V.datetime(n.created_at)}</small></div><div class="actions"><button class="btn btn-ghost open-notification" data-id="${n.id}">مشاهده</button>${!n.read_at?`<button class="btn btn-ghost read-notification" data-id="${n.id}">خوانده شد</button>`:''}</div></div>`).join('')||'<p class="empty">اعلانی ندارید.</p>';$('#notificationList').insertAdjacentHTML('beforeend',V.pager(page,count||0,30));
V.bind('.read-notification',async b=>{await V.rpc('read_notifications',{p_id:b.dataset.id});await V.updateNotificationBadge();await draw();});V.bind('.open-notification',async b=>{const n=data.find(x=>x.id===b.dataset.id);await V.rpc('read_notifications',{p_id:n.id});await V.updateNotificationBadge();const route=n.link;if(route&&/^[a-z-]+$/.test(route))await c.navigate(route);});
$('#prevPage').disabled=page===0;$('#nextPage').disabled=(page+1)*30>=(count||0);V.bind('#prevPage',async()=>{page--;await draw();});V.bind('#nextPage',async()=>{page++;await draw();});}
V.bind('#readAllNotifications',async()=>{await V.rpc('read_notifications');await V.updateNotificationBadge();await draw();});await draw();};
})();
