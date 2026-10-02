(() => {
"use strict";

const V = window.SchoolV8 = window.SchoolV8 || {};
V.routes = V.routes || {};
V.context = V.context || {};

V.registerRoute = (name, fn) => { V.routes[name] = fn; };
V.app = () => window.SchoolApp;
V.state = () => window.SchoolApp?.state;
V.sb = () => V.state()?.sb;

V.weekdays = ["شنبه","یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه"];
V.attendanceLabels = {
  present:"حاضر",
  absent:"غایب",
  excused_absent:"غیبت موجه",
  unexcused_absent:"غیبت غیرموجه",
  late:"تأخیر",
  early_leave:"خروج زودهنگام"
};
V.eventLabels = {
  exam:"امتحان",holiday:"تعطیلی",parent_meeting:"جلسه اولیا",trip:"اردو",
  competition:"مسابقه",cultural:"برنامه فرهنگی",school_meeting:"جلسه مدرسه",
  deadline:"مهلت مهم",other:"سایر"
};

const ERROR_MAP = {
  ACCESS_DENIED:"شما اجازه مشاهده یا تغییر این اطلاعات را ندارید.",
  UNAUTHORIZED:"نشست شما معتبر نیست؛ دوباره وارد شوید.",
  SCHEDULE_NOT_FOUND:"جلسه برنامه هفتگی پیدا نشد.",
  INVALID_ATTENDANCE_STATUS:"وضعیت حضور و غیاب معتبر نیست.",
  STUDENT_NOT_IN_CLASS:"این دانش‌آموز عضو کلاس انتخاب‌شده نیست.",
  EXAM_NOT_AVAILABLE:"این آزمون در دسترس نیست.",
  EXAM_NOT_STARTED:"زمان شروع آزمون هنوز نرسیده است.",
  EXAM_ENDED:"مهلت شرکت در آزمون پایان یافته است.",
  EXAM_TIME_FINISHED:"زمان آزمون شما به پایان رسیده است.",
  EXAM_ALREADY_SUBMITTED:"این آزمون قبلاً ارسال شده است.",
  EXAM_ATTEMPT_INVALID:"تلاش آزمون معتبر نیست.",
  QUESTION_NOT_IN_EXAM:"سؤال موردنظر در این آزمون وجود ندارد.",
  FORM_NOT_ACTIVE:"این فرم فعال نیست.",
  FORM_NOT_OPEN:"زمان پاسخ‌گویی به فرم هنوز شروع نشده است.",
  FORM_CLOSED:"مهلت ارسال فرم پایان یافته است.",
  FORM_ALREADY_SUBMITTED:"این فرم قبلاً ارسال شده است.",
  FORM_REQUIRED_FIELD_MISSING:"لطفاً همه فیلدهای الزامی را تکمیل کنید.",
  POLL_NOT_FOUND:"نظرسنجی پیدا نشد.",
  POLL_NOT_STARTED:"نظرسنجی هنوز شروع نشده است.",
  POLL_ENDED:"مهلت شرکت در نظرسنجی پایان یافته است.",
  POLL_ALREADY_VOTED:"شما قبلاً در این نظرسنجی رأی داده‌اید.",
  POLL_RESULTS_HIDDEN:"نتایج این نظرسنجی هنوز منتشر نشده است.",
  CLASS_NOT_AVAILABLE:"این کلاس فوق‌برنامه در دسترس نیست.",
  CLASS_FULL:"ظرفیت کلاس تکمیل شده است.",
  ALREADY_REGISTERED:"شما قبلاً برای این کلاس ثبت‌نام کرده‌اید.",
  REGISTRATION_NOT_STARTED:"ثبت‌نام هنوز شروع نشده است.",
  REGISTRATION_ENDED:"مهلت ثبت‌نام پایان یافته است.",
  APPOINTMENT_SLOT_CONFLICT:"برای این ساعت زمان ملاقات دیگری ثبت شده است.",
  APPOINTMENT_SLOT_UNAVAILABLE:"این زمان برای رزرو در دسترس نیست.",
  APPOINTMENT_SLOT_EXPIRED:"این زمان ملاقات گذشته است.",
  APPOINTMENT_FULL:"ظرفیت این زمان ملاقات تکمیل شده است.",
  APPOINTMENT_ALREADY_REQUESTED:"برای این زمان قبلاً درخواست ملاقات ثبت کرده‌اید.",
  REPORT_TYPE_INVALID:"نوع گزارش انتخاب‌شده معتبر نیست."
};

V.errorText = (err) => {
  const raw = err?.message || err?.details || String(err || "خطای نامشخص");
  const key = Object.keys(ERROR_MAP).find(k => raw.includes(k));
  if (key) return ERROR_MAP[key];
  if (/duplicate key|unique constraint/i.test(raw)) return "این مورد قبلاً ثبت شده است یا با اطلاعات موجود تداخل دارد.";
  if (/row-level security|violates row-level/i.test(raw)) return "شما اجازه انجام این عملیات را ندارید.";
  if (/network|fetch|Failed to fetch/i.test(raw)) return "ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید.";
  if (/JWT|session|token/i.test(raw)) return "نشست شما منقضی شده است؛ دوباره وارد شوید.";
  return "عملیات انجام نشد. لطفاً دوباره تلاش کنید.";
};

V.rpc = async (name, args={}) => {
  const {data,error} = await V.sb().rpc(name,args);
  if (error) throw error;
  return data;
};

V.withBusy = async (button, task, busyText="در حال انجام…") => {
  const old = button?.textContent;
  if (button) { button.disabled=true; button.textContent=busyText; }
  try { return await task(); }
  finally { if(button){button.disabled=false;button.textContent=old;} }
};

V.escape = (v) => V.app().esc(v);
V.fa = (v) => V.app().toFaDigits(v);
V.en = (v) => V.app().toEnDigits(v);
V.dateTime = (v) => v ? new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)) : "-";
V.dateOnly = (v) => v ? new Intl.DateTimeFormat("fa-IR-u-ca-persian",{dateStyle:"medium"}).format(new Date(v)) : "-";
V.timeOnly = (v) => v ? new Intl.DateTimeFormat("fa-IR",{hour:"2-digit",minute:"2-digit"}).format(new Date(v)) : "-";
V.isoDate = (d=new Date()) => d.toISOString().slice(0,10);
V.debounce = (fn,ms=300) => { let t; return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms);} };
V.studentClassId = (studentId=V.state()?.profile?.id) => V.state()?.classStudents.find(x=>x.student_id===studentId)?.class_id || null;
V.classStudents = (classId) => {
  const s=V.state();
  const ids=s.classStudents.filter(x=>x.class_id===classId).map(x=>x.student_id);
  return s.profiles.filter(p=>ids.includes(p.id)&&p.role==="student");
};
V.classLabel = (id) => V.app().className(id);
V.subjectLabel = (id) => V.app().subjectName(id);
V.userLabel = (id) => V.app().userName(id);

V.showError = (err) => V.app().toast(V.errorText(err),true);
V.success = (msg) => V.app().toast(msg);

V.route = (name,context={}) => {
  Object.assign(V.context,context);
  return V.app().navigate(name);
};
})();