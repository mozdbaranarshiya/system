(() => {
'use strict';
const c=window.SystemCore,V=window.SchoolV7,{$,esc:e}=c;let sequence=0;
function resultsHtml(rows){const groups=Object.groupBy(rows,r=>r.category);return Object.entries(groups).map(([category,hits])=>`<div class="v7-search-group"><h4>${e(V.label(category))}</h4>${hits.map(h=>`<button type="button" class="v7-search-hit" data-id="${h.id}" data-route="${e(h.route)}" data-category="${e(category)}">${e(h.title)}</button>`).join('')}</div>`).join('')||'<p class="empty">نتیجه‌ای یافت نشد.</p>';}
function bindHits(root){root.querySelectorAll('.v7-search-hit').forEach(b=>b.onclick=()=>{if(b.dataset.category==='student'){V.focusStudent=b.dataset.id;}$('#searchResults').classList.add('hidden');c.navigate(b.dataset.route);});}
function mount(input,output,dropdown=false){let timer;
input.oninput=()=>{clearTimeout(timer);const current=++sequence,query=c.toEnDigits(input.value).trim();
if(query.length<2){output.replaceChildren();if(dropdown)output.classList.add('hidden');return;}
timer=setTimeout(async()=>{try{const rows=await V.rpc('global_search',{p_query:query});if(current!==sequence||!output.isConnected)return;output.innerHTML=resultsHtml(rows);if(dropdown)output.classList.remove('hidden');bindHits(output);}catch(error){if(current===sequence){output.textContent=c.errText(error);if(dropdown)output.classList.remove('hidden');}}},300);};
input.onkeydown=event=>{if(event.key==='Escape')output.classList.add('hidden');};}
V.setupSearch=()=>mount($('#globalSearch'),$('#searchResults'),true);
V.routes.search=async()=>{V.page('جست‌وجوی سراسری','نام، کد ملی، کلاس، درس و محتوای آموزشی',`<div class="card">${V.field('searchQuery','عبارت جست‌وجو','search','',false)}<div id="searchPageResults"></div></div>`);mount($('#searchQuery'),$('#searchPageResults'));};
document.addEventListener('click',event=>{if(!event.target.closest('.v7-header-search'))$('#searchResults')?.classList.add('hidden');});
})();
