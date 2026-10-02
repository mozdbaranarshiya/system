(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const statusLabel={pending:"در انتظار",approved:"تأیید شده",rejected:"رد شده",cancelled:"لغو شده",completed:"انجام شده"};
async function render(){
  api.setPage("ملاقات‌ها","رزرو ملاقات با مدیر یا دبیر");
  const st=api.state;
  const [{data:slots,error:se},{data:apps,error:ae}]=await Promise.all([
    st.sb.from("appointment_slots").select("*").order("date").order("start_time"),
    st.sb.from("appointments").select("*").order("created_at",{ascending:false})
  ]);
  if(se)throw se;if(ae)throw ae;
  const staff=["manager","teacher"].includes(st.profile.role);
  if(staff){
    const mySlots=(slots||[]).filter(s=>s.staff_id===st.profile.id);
    const myIds=new Set(mySlots.map(s=>s.id));
    const incoming=(apps||[]).filter(a=>myIds.has(a.slot_id));
    const slotRows=mySlots.map(s=>`<tr><td>${api.toFaDigits(s.date)}</td><td>${api.toFaDigits(String(s.start_time).slice(0,5))}</td><td>${api.toFaDigits(String(s.end_time).slice(0,5))}</td><td>${api.esc(s.location||"-")}</td><td>${s.capacity}</td></tr>`);
    const appRows=incoming.map(a=>`<tr><td>${api.esc(api.userName(a.requester_id))}</td><td>${api.esc(a.subject)}</td><td><span class="badge">${statusLabel[a.status]}</span></td><td><div class="actions"><button class="btn btn-ghost review-app" data-id="${a.id}" data-status="approved">تأیید</button><button class="btn btn-ghost review-app" data-id="${a.id}" data-status="rejected">رد</button><button class="btn btn-ghost review-app" data-id="${a.id}" data-status="completed">انجام شد</button></div></td></tr>`);
    $("#content").innerHTML=`<div class="grid-2"><div class="card"><div class="panel-head"><h3>زمان‌های آزاد من</h3><button class="btn btn-primary" id="newSlot">+ زمان جدید</button></div><br>${api.table(["تاریخ","شروع","پایان","مکان","ظرفیت"],slotRows,"زمانی تعریف نشده است.")}</div><div class="card"><h3>درخواست‌ها</h3><br>${api.table(["درخواست‌کننده","موضوع","وضعیت","عملیات"],appRows,"درخواستی وجود ندارد.")}</div></div>`;
    $("#newSlot").onclick=slotModal;
    document.querySelectorAll(".review-app").forEach(b=>b.onclick=async()=>{const {error}=await st.sb.rpc("review_appointment",{p_appointment:b.dataset.id,p_status:b.dataset.status});if(error)return api.toast(api.errText(error),true);api.toast("وضعیت ملاقات به‌روزرسانی شد.");render();});
    return;
  }
  const active=(slots||[]).filter(s=>s.active),mine=apps||[];
  const cards=active.map(s=>{const own=mine.find(a=>a.slot_id===s.id&&a.requester_id===st.profile.id);return `<article class="appointment-card"><div><h3>${api.esc(api.userName(s.staff_id))}</h3><p class="muted">${api.toFaDigits(s.date)} — ${api.toFaDigits(String(s.start_time).slice(0,5))} تا ${api.toFaDigits(String(s.end_time).slice(0,5))}</p><span class="badge">${api.esc(s.location||"محل اعلام نشده")}</span></div>${own?`<span class="badge">${statusLabel[own.status]}</span>`:`<button class="btn btn-primary book-app" data-id="${s.id}">درخواست ملاقات</button>`}</article>`}).join("");
  $("#content").innerHTML=`<div class="appointment-list">${cards||'<div class="card empty">زمان آزادی برای ملاقات وجود ندارد.</div>'}</div>`;
  document.querySelectorAll(".book-app").forEach(b=>b.onclick=()=>bookModal(b.dataset.id));
}
function slotModal(){
  api.modal("زمان آزاد ملاقات",`<div class="form-grid"><label><span>تاریخ</span><input id="slotDate" type="date"></label><label><span>شروع</span><input id="slotStart" type="time"></label><label><span>پایان</span><input id="slotEnd" type="time"></label><label><span>مکان</span><input id="slotLoc"></label><label><span>ظرفیت</span><input id="slotCap" inputmode="numeric" value="1"></label></div>`,async()=>{const {error}=await api.state.sb.rpc("save_appointment_slot",{p_id:null,p_date:$("#slotDate").value,p_start:$("#slotStart").value,p_end:$("#slotEnd").value,p_location:$("#slotLoc").value,p_capacity:Number(api.toEnDigits($("#slotCap").value||"1"))});if(error){const m=error.message;throw new Error(m.includes("APPOINTMENT_SLOT_CONFLICT")?"این زمان با زمان دیگری تداخل دارد.":m)}api.toast("زمان ملاقات ثبت شد.");render();},"ثبت زمان");
}
function bookModal(slotId){
  api.modal("درخواست ملاقات",`<div class="form-grid"><label class="wide"><span>موضوع</span><input id="appSubject"></label><label class="wide"><span>توضیحات</span><textarea id="appDesc"></textarea></label></div>`,async()=>{const {error}=await api.state.sb.rpc("request_appointment",{p_slot:slotId,p_subject:$("#appSubject").value.trim(),p_description:$("#appDesc").value.trim()});if(error){const m=error.message;throw new Error(m.includes("SLOT_FULL")?"ظرفیت این زمان تکمیل شده است.":m.includes("APPOINTMENT_CONFLICT")?"برای این ساعت ملاقات دیگری دارید.":m)}api.toast("درخواست ملاقات ارسال شد.");render();},"ارسال درخواست");
}
api.registerModule({nav:{manager:[["appointments","ملاقات‌ها"]],teacher:[["appointments","ملاقات‌ها"]],student:[["appointments","ملاقات‌ها"]]},routes:{appointments:render}});
})();