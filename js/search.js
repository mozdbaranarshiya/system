(() => {
"use strict";
const V=window.SchoolV8;
let lastQuery="";
const resultBox=()=>document.querySelector("#globalSearchResults");

function group(title,items){
  if(!items?.length)return "";
  return `<section class="search-group"><h4>${V.escape(title)}</h4>${items.map(x=>`<button class="search-result" data-id="${x.id||""}" data-role="${x.role||""}" data-route="${x.route||""}" data-type="${x.type||""}"><strong>${V.escape(x.title||"")}</strong><small>${V.escape(x.subtitle||x.role||x.type||"")}</small></button>`).join("")}</section>`;
}
function close(){resultBox()?.classList.add("hidden")}
async function run(q){
  const target=resultBox();if(!target)return;
  q=q.trim();lastQuery=q;
  if(q.length<2){target.innerHTML="";close();return}
  target.classList.remove("hidden");target.innerHTML='<div class="search-loading">در حال جست‌وجو…</div>';
  try{
    const data=await V.rpc("global_search",{p_query:q});
    if(q!==lastQuery)return;
    target.innerHTML=[group("افراد",data.people),group("کلاس‌ها",data.classes),group("دروس",data.subjects),group("محتوا",data.content)].join("")||'<div class="empty">نتیجه‌ای پیدا نشد.</div>';
    target.querySelectorAll(".search-result").forEach(b=>b.onclick=()=>{
      if(b.dataset.role==="student")V.route("studentProfile",{studentId:b.dataset.id});
      else if(b.dataset.route)V.route(b.dataset.route);
      else if(b.dataset.type==="class")V.route("timetable",{classId:b.dataset.id});
      close();
    });
  }catch(e){target.innerHTML=`<div class="search-error">${V.errorText(e)}</div>`}
}
const debounced=V.debounce(run,320);
function bind(){
  const input=document.querySelector("#globalSearchInput");
  if(!input||input.dataset.bound)return;
  input.dataset.bound="1";
  input.oninput=()=>debounced(input.value);
  input.onfocus=()=>{if(input.value.trim().length>=2)run(input.value)};
  document.addEventListener("click",e=>{if(!e.target.closest(".global-search"))close()});
}
bind();window.addEventListener("school:ready",bind);
})();
