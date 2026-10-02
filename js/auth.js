(() => {
"use strict";
const V=window.SchoolV8;

V.beforeEnter = async (profile) => {
  if (!profile?.must_change_password) return true;

  return await new Promise(resolve => {
    const A=V.app();
    A.modal("تغییر اجباری رمز اولیه",`
      <div class="security-gate">
        <div class="security-gate-icon">🔐</div>
        <h3>رمز اولیه باید تغییر کند</h3>
        <p class="muted">برای حفظ امنیت حساب، پیش از استفاده از سامانه یک رمز جدید با حداقل ۸ کاراکتر انتخاب کنید.</p>
        <div class="form-grid">
          <label class="wide"><span>رمز جدید</span><input id="forceNewPassword" type="password" autocomplete="new-password" minlength="8"></label>
          <label class="wide"><span>تکرار رمز جدید</span><input id="forceNewPassword2" type="password" autocomplete="new-password" minlength="8"></label>
        </div>
      </div>`,
      async()=>{
        const p1=document.querySelector("#forceNewPassword").value;
        const p2=document.querySelector("#forceNewPassword2").value;
        if(p1.length<8) throw new Error("رمز جدید باید حداقل ۸ کاراکتر باشد.");
        if(p1!==p2) throw new Error("تکرار رمز با رمز جدید یکسان نیست.");
        if(p1===profile.national_id) throw new Error("رمز جدید نباید همان کد ملی باشد.");
        const {error}=await V.sb().auth.updateUser({password:p1});
        if(error) throw error;
        await V.rpc("confirm_password_changed");
        profile.must_change_password=false;
        V.success("رمز با موفقیت تغییر کرد.");
        resolve(true);
      },
      "تغییر رمز و ادامه"
    );
    document.querySelector("#modalCancel")?.classList.add("hidden");
    document.querySelector("#modalClose")?.classList.add("hidden");
    document.querySelector("#modal")?.addEventListener("cancel",e=>e.preventDefault(),{once:true});
  });
};

V.registerRoute("accountSecurity", async()=>{
  const A=V.app();
  A.setPage("امنیت حساب","تغییر رمز عبور و مدیریت نشست‌های فعال");
  const {data,error}=await V.sb().rpc("account_security_state");
  if(error) throw error;
  const st=data||{};
  document.querySelector("#content").innerHTML=`
    <div class="grid-2">
      <section class="card">
        <div class="panel-head"><div><h3>تغییر رمز عبور</h3><p class="muted">رمز جدید باید حداقل ۸ کاراکتر باشد.</p></div><span class="setting-icon">🔑</span></div>
        <br>
        <div class="form-grid">
          <label class="wide"><span>رمز جدید</span><input id="secPass1" type="password" autocomplete="new-password"></label>
          <label class="wide"><span>تکرار رمز</span><input id="secPass2" type="password" autocomplete="new-password"></label>
        </div>
        <br><button class="btn btn-primary" id="changeOwnPassword">تغییر رمز</button>
      </section>
      <section class="card">
        <div class="panel-head"><div><h3>نشست‌های حساب</h3><p class="muted">در صورت استفاده از دستگاه مشترک، می‌توانید از همه دستگاه‌ها خارج شوید.</p></div><span class="setting-icon">◉</span></div>
        <div class="security-meta">
          <span>آخرین تغییر ثبت‌شده رمز</span>
          <strong>${st.password_changed_at?V.dateTime(st.password_changed_at):"ثبت نشده"}</strong>
        </div>
        <button class="btn btn-ghost danger" id="logoutEverywhere">خروج از همه دستگاه‌ها</button>
      </section>
    </div>`;

  document.querySelector("#changeOwnPassword").onclick=async e=>{
    try{
      await V.withBusy(e.currentTarget,async()=>{
        const p1=document.querySelector("#secPass1").value;
        const p2=document.querySelector("#secPass2").value;
        if(p1.length<8) throw new Error("رمز جدید باید حداقل ۸ کاراکتر باشد.");
        if(p1!==p2) throw new Error("تکرار رمز یکسان نیست.");
        const {error}=await V.sb().auth.updateUser({password:p1});
        if(error) throw error;
        await V.rpc("confirm_password_changed");
        V.success("رمز عبور با موفقیت تغییر کرد.");
        document.querySelector("#secPass1").value="";
        document.querySelector("#secPass2").value="";
      });
    }catch(err){V.showError(err)}
  };

  document.querySelector("#logoutEverywhere").onclick=async e=>{
    if(!confirm("از همه دستگاه‌های واردشده خارج شوید؟"))return;
    try{
      await V.withBusy(e.currentTarget,async()=>{
        const {error}=await V.sb().auth.signOut({scope:"global"});
        if(error) throw error;
        location.reload();
      });
    }catch(err){V.showError(err)}
  };
});
})();