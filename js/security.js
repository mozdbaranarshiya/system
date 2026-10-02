(() => {
"use strict";

const actionLabels={INSERT:"ایجاد",UPDATE:"ویرایش",DELETE:"حذف"};
const tableLabels={
  profiles:"کاربران",
  scores:"نمرات",
  teacher_assignments:"تخصیص دبیران",
  class_students:"عضویت کلاس",
  discipline_scores:"انضباط",
  school_settings:"تنظیمات سامانه",
  assignments:"تکالیف",
  assignment_submissions:"ارسال تکالیف",
  student_groups:"گروه‌های کلاسی",
  student_group_members:"اعضای گروه",
  group_score_entries:"نمرات سرگروه",
  objections:"اعتراض‌ها",
  announcements:"اطلاعیه‌ها",
  homework_grades:"نمرات تکالیف"
};

function validatePassword(password,confirmPassword,nationalId=""){
  const p=String(password||"");
  if(p.length<8)throw new Error("رمز جدید باید حداقل ۸ کاراکتر باشد.");
  if(p===String(nationalId||""))throw new Error("رمز جدید نباید همان کد ملی باشد.");
  if(confirmPassword!==undefined&&p!==String(confirmPassword||""))throw new Error("تکرار رمز با رمز جدید یکسان نیست.");
  return p;
}

function passwordFormHtml({forced=false}={}){
  return `
    <div class="security-password-form">
      <div class="security-password-head">
        <span class="security-shield">✓</span>
        <div>
          <h3>${forced?"تغییر رمز اولیه الزامی است":"تغییر رمز عبور"}</h3>
          <p class="muted">${forced?"برای ادامه استفاده از سامانه، رمز اولیه را تغییر دهید.":"رمز جدید حداقل ۸ کاراکتر باشد و با کد ملی یکسان نباشد."}</p>
        </div>
      </div>
      <label><span>رمز جدید</span><input id="newPassword" type="password" autocomplete="new-password" minlength="8"></label>
      <label><span>تکرار رمز جدید</span><input id="confirmPassword" type="password" autocomplete="new-password" minlength="8"></label>
      <button id="changeOwnPassword" class="btn btn-primary full" type="button">${forced?"تغییر رمز و ادامه":"ذخیره رمز جدید"}</button>
    </div>`;
}

function actionLabel(action){return actionLabels[action]||action||"-";}
function tableLabel(table){return tableLabels[table]||table||"-";}

window.SystemV7Security={validatePassword,passwordFormHtml,actionLabel,tableLabel};
})();