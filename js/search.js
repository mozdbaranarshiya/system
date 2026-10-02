(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const typeLabels={student:"دانش‌آموز",teacher:"دبیر",class:"کلاس",subject:"درس",assignment:"تکلیف",exam:"آزمون",announcement:"اطلاعیه",form:"فرم",extracurricular:"فوق‌برنامه"};
let timer=null,lastQuery="";
function ensureSearch(){
  if($("#globalSearchWrap"))return;
  const topbar=document.querySelector(".topbar");if(!topbar)return;
  const wrap=document.createElement("div");wrap.id="globalSearchWrap";wrap.className="global-search-wrap";
  wrap.innerHTML='<button id="globalSearchToggle" class="icon-btn global-search-toggle" type="button" aria-label="جست‌وجوی سراسری">⌕</button><div id="globalSearchPanel" class="global-search-panel hidden"><div class="global-search-input-wrap"><span>⌕</span><input id="globalSearchInput" autocomplete="off" placeholder="نام، کد ملی، کلاس، درس، تکلیف، آزمون…"></div><div id="globalSearchResults" class="global-search-results"><div class="empty">برای جست‌وجو حداقل دو حرف بنویسید.</div></div></div>';
  topbar.insertBefore(wrap,document.querySelector(".topbar-meta"));
  $("#globalSearchToggle").onclick=()=>{const p=$("#globalSearchPanel");p.classList.toggle("hidden");if(!p.classList.contains("hidden"))setTimeout(()=>$("#globalSearchInput").focus(),30)};
  $("#globalSearchInput").addEventListener("input",e=>{clearTimeout(timer);const q=e.target.value.trim();timer=setTimeout(()=>search(q),300)});
  document.addEventListener("click",e=>{if(!wrap.contains(e.target))$("#globalSearchPanel")?.classList.add("hidden")});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#globalSearchPanel")?.classList.add("hidden")});
}
async function search(q){
  const box=$("#globalSearchResults");if(!box)return;
  if(q.length<2){box.innerHTML='<div class="empty">برای جست‌وجو حداقل دو حرف بنویسید.</div>';return}
  lastQuery=q;box.innerHTML='<div class="empty">در حال جست‌وجو…</div>';
  const {data,error}=await api.state.sb.rpc("global_search",{p_query:q});
  if(q!==lastQuery)return;
  if(error){box.innerHTML='<div class="empty">جست‌وجو انجام نشد.</div>';return}
  const rows=Array.isArray(data)?data:[];
  if(!rows.length){box.innerHTML='<div class="empty">نتیجه‌ای پیدا نشد.</div>';return}
  const groups=new Map();
  rows.forEach(r=>{const k=r.type||"other";if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r)});
  box.innerHTML=[...groups.entries()].map(([type,items])=>`<section class="search-group"><h4>${api.esc(typeLabels[type]||type)}</h4>${items.map(r=>`<button class="search-result" data-type="${api.esc(r.type)}" data-id="${api.esc(r.id)}" data-route="${api.esc(r.route||"")}"><strong>${api.esc(r.title)}</strong><small>${api.esc(r.subtitle||"")}</small></button>`).join("")}</section>`).join("");
  document.querySelectorAll(".search-result").forEach(b=>b.onclick=()=>{
    if(b.dataset.type==="student")window.SystemV7SelectedStudent=b.dataset.id;
    $("#globalSearchPanel").classList.add("hidden");
    if(b.dataset.route)api.navigate(b.dataset.route);
  });
}
window.addEventListener("system:entered",ensureSearch);
api.registerModule({routes:{}});
})();