(() => {
"use strict";
const api=window.SystemV7API;if(!api)return;const $=api.$;
const typeLabel={multiple_choice:"چهارگزینه‌ای",true_false:"صحیح/غلط",short_answer:"پاسخ کوتاه",essay:"تشریحی"};
function friendly(e){
  const m=e?.message||String(e||"");
  const map={EXAM_NOT_AVAILABLE:"آزمون در دسترس نیست.",EXAM_NOT_STARTED:"زمان شروع آزمون هنوز نرسیده است.",EXAM_ENDED:"مهلت آزمون پایان یافته است.",EXAM_TIME_ENDED:"زمان پاسخ‌گویی به آزمون پایان یافته است.",ATTEMPT_ALREADY_SUBMITTED:"این آزمون قبلاً ارسال شده است.",ATTEMPT_NOT_FOUND:"تلاش آزمون پیدا نشد.",QUESTION_NOT_IN_EXAM:"یکی از سؤال‌ها متعلق به این آزمون نیست.",INVALID_OPTION:"گزینه انتخاب‌شده معتبر نیست."};
  return map[m]||api.errText(e);
}
function localIso(v){const d=v?new Date(v):new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
async function render(){
  return api.state.profile.role==="student"?renderStudent():renderStaff();
}
async function renderStaff(){
  api.setPage("آزمون آنلاین","بانک سؤال، آزمون‌ها و تصحیح");
  const [{data:exams,error:ee},{data:questions,error:qe}]=await Promise.all([
    api.state.sb.from("exams").select("*").order("created_at",{ascending:false}),
    api.state.sb.from("question_bank").select("*").order("created_at",{ascending:false})
  ]);
  if(ee)throw ee;if(qe)throw qe;
  const cards=(exams||[]).map(e=>`<article class="exam-card"><div class="panel-head"><div><span class="badge ${e.published?"":"warn"}">${e.published?"منتشرشده":"پیش‌نویس"}</span><h3>${api.esc(e.title)}</h3></div><div class="actions"><button class="btn btn-ghost exam-attempts" data-id="${e.id}">پاسخ‌ها</button><button class="btn btn-ghost exam-toggle" data-id="${e.id}" data-pub="${e.published}">${e.published?"لغو انتشار":"انتشار"}</button><button class="btn btn-ghost danger exam-delete" data-id="${e.id}">حذف</button></div></div><p class="muted">${api.esc(api.className(e.class_id))} — ${api.esc(api.subjectName(e.subject_id))}</p><div class="exam-meta"><span>شروع: ${api.faDateTime(e.start_at)}</span><span>پایان: ${api.faDateTime(e.end_at)}</span><span>مدت: ${api.toFaDigits(e.duration_minutes)} دقیقه</span><span>نمره: ${e.max_score}</span></div></article>`).join("");
  $("#content").innerHTML=`<div class="panel-head page-actions"><div><h3>مدیریت آزمون‌ها</h3><p class="muted">زمان معتبر سرور ملاک ورود و پایان آزمون است.</p></div><div class="actions"><button class="btn btn-ghost" id="questionBankBtn">بانک سؤال (${api.toFaDigits((questions||[]).length)})</button><button class="btn btn-primary" id="newExamBtn">+ آزمون جدید</button></div></div><div class="exam-grid">${cards||'<div class="card empty">آزمونی ثبت نشده است.</div>'}</div>`;
  $("#questionBankBtn").onclick=()=>questionBankModal(questions||[]);
  $("#newExamBtn").onclick=()=>examModal(questions||[]);
  document.querySelectorAll(".exam-toggle").forEach(b=>b.onclick=async()=>{const {error}=await api.state.sb.from("exams").update({published:b.dataset.pub!=="true"}).eq("id",b.dataset.id);if(error)return api.toast(api.errText(error),true);renderStaff();});
  document.querySelectorAll(".exam-delete").forEach(b=>b.onclick=async()=>{if(!confirm("آزمون و پاسخ‌های وابسته حذف شود؟"))return;const {error}=await api.state.sb.from("exams").delete().eq("id",b.dataset.id);if(error)return api.toast(api.errText(error),true);renderStaff();});
  document.querySelectorAll(".exam-attempts").forEach(b=>b.onclick=()=>attemptsModal(b.dataset.id));
}
function availableMappings(){
  const st=api.state;
  return st.profile.role==="teacher"?st.assignments.filter(a=>a.teacher_id===st.profile.id):st.assignments;
}
function questionBankModal(questions){
  const rows=questions.map(q=>`<tr><td>${api.esc(q.question_text)}</td><td>${api.esc(api.subjectName(q.subject_id))}</td><td>${typeLabel[q.question_type]}</td><td>${q.default_score}</td><td><button class="btn btn-ghost danger q-delete" data-id="${q.id}">حذف</button></td></tr>`).join("");
  api.modal("بانک سؤال",`<div class="panel-head"><p class="muted">سؤال‌های صحیح/غلط و چهارگزینه‌ای به‌صورت خودکار تصحیح می‌شوند.</p><button type="button" class="btn btn-primary" id="addQuestion">+ سؤال</button></div><br><div class="table-wrap"><table><thead><tr><th>سؤال</th><th>درس</th><th>نوع</th><th>نمره پیش‌فرض</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="empty">سؤالی وجود ندارد.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
  $("#addQuestion").onclick=()=>questionModal();
  document.querySelectorAll(".q-delete").forEach(b=>b.onclick=async()=>{const {error}=await api.state.sb.from("question_bank").delete().eq("id",b.dataset.id);if(error)return api.toast("سؤالی که در آزمون استفاده شده قابل حذف نیست.",true);$("#modal").close();renderStaff();});
}
function questionModal(){
  const st=api.state,maps=availableMappings(),subjectIds=[...new Set(maps.map(x=>x.subject_id))];
  api.modal("سؤال جدید",`<div class="form-grid"><label><span>درس</span><select id="qSubject">${subjectIds.map(id=>`<option value="${id}">${api.esc(api.subjectName(id))}</option>`).join("")}</select></label><label><span>نوع سؤال</span><select id="qType"><option value="multiple_choice">چهارگزینه‌ای</option><option value="true_false">صحیح/غلط</option><option value="short_answer">پاسخ کوتاه</option><option value="essay">تشریحی</option></select></label><label><span>نمره پیش‌فرض</span><input id="qScore" inputmode="decimal" value="1"></label><label class="wide"><span>متن سؤال</span><textarea id="qText"></textarea></label><label class="wide" id="qOptionsWrap"><span>گزینه‌ها؛ هر گزینه در یک خط</span><textarea id="qOptions" placeholder="گزینه اول&#10;گزینه دوم&#10;گزینه سوم&#10;گزینه چهارم"></textarea></label><label id="qCorrectWrap"><span>شماره گزینه صحیح</span><input id="qCorrect" inputmode="numeric" value="1"></label></div>`,async()=>{
    const type=$("#qType").value,text=$("#qText").value.trim(),score=Number(api.toEnDigits($("#qScore").value));
    if(!text||!score||score<=0)throw new Error("متن سؤال و نمره معتبر الزامی است.");
    const teacherId=st.profile.role==="teacher"?st.profile.id:(maps.find(m=>m.subject_id===$("#qSubject").value)?.teacher_id||st.profile.id);
    const {data:q,error}=await st.sb.from("question_bank").insert({teacher_id:teacherId,subject_id:$("#qSubject").value,question_type:type,question_text:text,default_score:score}).select().single();if(error)throw error;
    if(["multiple_choice","true_false"].includes(type)){
      let opts=type==="true_false"?["صحیح","غلط"]:$("#qOptions").value.split("\n").map(x=>x.trim()).filter(Boolean);
      const correct=Math.max(1,Number(api.toEnDigits($("#qCorrect").value||"1")))-1;
      if(opts.length<2||correct>=opts.length)throw new Error("گزینه‌ها یا پاسخ صحیح معتبر نیست.");
      const {error:oe}=await st.sb.from("question_options").insert(opts.map((x,i)=>({question_id:q.id,option_text:x,is_correct:i===correct,sort_order:i+1})));if(oe)throw oe;
    }
    api.toast("سؤال ثبت شد.");$("#modal").close();renderStaff();
  },"ثبت سؤال");
  const sync=()=>{const v=$("#qType").value,isChoice=["multiple_choice","true_false"].includes(v);$("#qOptionsWrap").classList.toggle("hidden",!isChoice||v==="true_false");$("#qCorrectWrap").classList.toggle("hidden",!isChoice);};
  $("#qType").onchange=sync;sync();
}
function examModal(questions){
  const st=api.state,maps=availableMappings();if(!maps.length)return api.toast("ابتدا تخصیص دبیر به کلاس و درس را ثبت کنید.",true);
  const first=maps[0],start=new Date(Date.now()+3600000),end=new Date(Date.now()+86400000);
  const qHtml=questions.map(q=>`<label class="check-card exam-question-check" data-subject="${q.subject_id}"><input type="checkbox" value="${q.id}" data-score="${q.default_score}"><span><b>${api.esc(q.question_text)}</b><small>${typeLabel[q.question_type]} — ${q.default_score} نمره</small></span></label>`).join("");
  api.modal("آزمون جدید",`<div class="form-grid"><label class="wide"><span>عنوان</span><input id="exTitle"></label><label><span>کلاس/درس/دبیر</span><select id="exCourse">${maps.map(m=>`<option value="${m.teacher_id}|${m.class_id}|${m.subject_id}">${api.esc(api.className(m.class_id))} — ${api.esc(api.subjectName(m.subject_id))} — ${api.esc(api.userName(m.teacher_id))}</option>`).join("")}</select></label><label><span>مدت (دقیقه)</span><input id="exDuration" inputmode="numeric" value="45"></label><label><span>شروع</span><input id="exStart" type="datetime-local" value="${localIso(start)}"></label><label><span>پایان</span><input id="exEnd" type="datetime-local" value="${localIso(end)}"></label><label><span>نمره کل</span><input id="exMax" inputmode="decimal" value="20"></label><label><span>نمایش نتیجه خودکار پس از ارسال</span><select id="exShow"><option value="false">خیر</option><option value="true">بله</option></select></label><label class="wide"><span>توضیحات</span><textarea id="exDesc"></textarea></label><div class="wide"><span class="field-title">سؤال‌ها</span><div id="examQuestionList" class="check-grid">${qHtml||'<div class="empty">بانک سؤال خالی است.</div>'}</div></div></div>`,async()=>{
    const [teacherId,classId,subjectId]=($("#exCourse").value||"||").split("|"),selected=[...document.querySelectorAll("#examQuestionList input:checked")];
    if(!$("#exTitle").value.trim()||!selected.length)throw new Error("عنوان و حداقل یک سؤال الزامی است.");
    const payload={teacher_id:teacherId,class_id:classId,subject_id:subjectId,title:$("#exTitle").value.trim(),description:$("#exDesc").value.trim()||null,start_at:new Date($("#exStart").value).toISOString(),end_at:new Date($("#exEnd").value).toISOString(),duration_minutes:Number(api.toEnDigits($("#exDuration").value)),max_score:Number(api.toEnDigits($("#exMax").value)),published:false,show_result_after_submit:$("#exShow").value==="true"};
    const {data:e,error}=await st.sb.from("exams").insert(payload).select().single();if(error)throw error;
    const {error:qe}=await st.sb.from("exam_questions").insert(selected.map((x,i)=>({exam_id:e.id,question_id:x.value,score:Number(x.dataset.score),sort_order:i+1})));if(qe)throw qe;
    api.toast("آزمون به‌صورت پیش‌نویس ساخته شد.");renderStaff();
  },"ساخت آزمون");
  const filter=()=>{const subject=($("#exCourse").value||"||").split("|")[2];document.querySelectorAll(".exam-question-check").forEach(x=>x.classList.toggle("hidden",x.dataset.subject!==subject));};$("#exCourse").onchange=filter;filter();
}
async function attemptsModal(examId){
  const {data,error}=await api.state.sb.from("exam_attempts").select("*").eq("exam_id",examId).order("started_at",{ascending:false});if(error)return api.toast(api.errText(error),true);
  const rows=(data||[]).map(a=>`<tr><td>${api.esc(api.userName(a.student_id))}</td><td>${api.esc(a.status)}</td><td>${a.auto_score}</td><td>${a.manual_score}</td><td><strong>${a.total_score}</strong></td><td>${["submitted","graded"].includes(a.status)?`<button class="btn btn-ghost grade-attempt" data-id="${a.id}" data-auto="${a.auto_score}" data-manual="${a.manual_score}">تصحیح تشریحی</button>`:"-"}</td></tr>`).join("");
  api.modal("پاسخ‌های آزمون",`<div class="table-wrap"><table><thead><tr><th>دانش‌آموز</th><th>وضعیت</th><th>خودکار</th><th>دستی</th><th>کل</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">هنوز پاسخی ثبت نشده است.</td></tr>'}</tbody></table></div>`,async()=>$("#modal").close(),"بستن");
  document.querySelectorAll(".grade-attempt").forEach(b=>b.onclick=()=>api.modal("ثبت نمره تشریحی",`<label><span>جمع نمره دستی</span><input id="manualExamScore" inputmode="decimal" value="${b.dataset.manual||0}"></label>`,async()=>{const {error}=await api.state.sb.rpc("grade_exam_attempt",{p_attempt:b.dataset.id,p_manual_score:Number(api.toEnDigits($("#manualExamScore").value||"0"))});if(error)throw error;api.toast("نمره آزمون ثبت شد.");$("#modal").close();renderStaff();},"ثبت نمره"));
}
async function renderStudent(){
  api.setPage("آزمون‌های من","آزمون‌های آنلاین منتشرشده");
  const {data,error}=await api.state.sb.from("exams").select("*").eq("published",true).order("start_at",{ascending:true});if(error)throw error;
  const cards=(data||[]).map(e=>{const now=Date.now(),start=new Date(e.start_at).getTime(),end=new Date(e.end_at).getTime();const label=now<start?"هنوز شروع نشده":now>end?"پایان یافته":"ورود به آزمون";return `<article class="exam-card"><span class="badge">${api.esc(api.subjectName(e.subject_id))}</span><h3>${api.esc(e.title)}</h3><p class="muted">${api.esc(e.description||"")}</p><div class="exam-meta"><span>${api.faDateTime(e.start_at)}</span><span>${api.toFaDigits(e.duration_minutes)} دقیقه</span><span>${e.max_score} نمره</span></div><button class="btn btn-primary start-exam" data-id="${e.id}" ${now<start||now>end?"disabled":""}>${label}</button></article>`}).join("");
  $("#content").innerHTML=`<div class="exam-grid">${cards||'<div class="card empty">آزمون فعالی وجود ندارد.</div>'}</div>`;
  document.querySelectorAll(".start-exam").forEach(b=>b.onclick=()=>startExam(b.dataset.id));
}
async function startExam(examId){
  const {data:start,error}=await api.state.sb.rpc("start_exam",{p_exam:examId});if(error)return api.toast(friendly(error),true);
  if(start.status!=="in_progress")return api.toast("این آزمون قبلاً ارسال یا پایان یافته است.",true);
  const {data,error:ce}=await api.state.sb.rpc("get_exam_content",{p_exam:examId,p_attempt:start.attempt_id});if(ce)return api.toast(friendly(ce),true);
  showExam(data);
}
function showExam(data){
  const qs=data.questions||[];
  const qHtml=qs.map((q,i)=>`<section class="exam-question" data-id="${q.id}" data-type="${q.type}"><div class="exam-question-head"><strong>سؤال ${api.toFaDigits(i+1)}</strong><span class="badge">${q.score} نمره</span></div><p>${api.esc(q.text)}</p>${["multiple_choice","true_false"].includes(q.type)?`<div class="exam-options">${(q.options||[]).map(o=>`<label><input type="radio" name="q_${q.id}" value="${o.id}"><span>${api.esc(o.text)}</span></label>`).join("")}</div>`:`<textarea class="exam-answer-text" placeholder="پاسخ شما"></textarea>`}</section>`).join("");
  $("#content").innerHTML=`<div class="exam-live-head"><div><h3>${api.esc(data.exam.title)}</h3><p class="muted">${api.esc(data.exam.description||"")}</p></div><div class="exam-timer" id="examTimer">--:--</div></div><div class="exam-live">${qHtml}</div><div class="exam-submit-bar"><button class="btn btn-primary" id="submitExam">ارسال نهایی آزمون</button></div>`;
  const deadline=new Date(data.deadline).getTime();
  const timer=setInterval(()=>{const sec=Math.max(0,Math.floor((deadline-Date.now())/1000)),m=Math.floor(sec/60),s=sec%60;$("#examTimer").textContent=api.toFaDigits(String(m).padStart(2,"0")+":"+String(s).padStart(2,"0"));if(sec<=0){clearInterval(timer);$("#submitExam").disabled=true;api.toast("زمان آزمون پایان یافت.",true)}},1000);
  $("#submitExam").onclick=async()=>{if(!confirm("پاسخ‌ها نهایی و ارسال شوند؟"))return;const answers=[...document.querySelectorAll(".exam-question")].map(el=>({question_id:el.dataset.id,selected_option_id:el.querySelector("input:checked")?.value||null,answer_text:el.querySelector(".exam-answer-text")?.value.trim()||null}));const btn=$("#submitExam"),old=btn.textContent;btn.disabled=true;btn.textContent="در حال ارسال…";try{const {data:res,error}=await api.state.sb.rpc("submit_exam",{p_attempt:data.attempt_id,p_answers:answers});if(error)throw error;clearInterval(timer);api.toast(res.show_result?`آزمون ارسال شد. نمره خودکار: ${res.auto_score}`:"آزمون با موفقیت ارسال شد.");renderStudent()}catch(e){api.toast(friendly(e),true);btn.disabled=false;btn.textContent=old}};
}
api.registerModule({nav:{manager:[["exams","آزمون‌ها"]],teacher:[["exams","آزمون‌ها"]],student:[["exams","آزمون‌های من"]]},routes:{exams:render}});
})();