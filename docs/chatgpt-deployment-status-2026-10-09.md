# وضعیت استقرار اتصال ChatGPT — ۹ اکتبر ۲۰۲۶

> **این یک استقرار نیمه‌کامل و غیرفعال است.** هیچ OAuth Client زنده‌ای ثبت/تأیید نشده؛ عملیات End-to-End در ChatGPT اجرا نشده‌اند. این فایل گزارش اقدامات واقعی است و جایگزین تست تولید نیست.

## پروژهٔ مقصد

- شناسه: `efibfevyiepkwpnobaro`
- نام: `isfahan-education-system`
- وضعیت پروژه در آغاز بررسی: `ACTIVE_HEALTHY`
- مخزن کد: `mozdbaranarshiya/system` و PR شماره ۱۳ (Draft)
- پروژهٔ Supabase دیگری که قبلاً متصل بود مقصد استقرار **نیست**.

## نصب‌های انجام‌شده و بررسی‌شده

1. Migration مدیریتی `chatgpt_oauth_isolation_grants_20261009` با پاسخ `success:true` ثبت شد.
2. در بررسی بعدی، جدول `public.oauth_connected_apps` و محافظ PostgREST موجود بودند؛ ۵۲ سیاست محدودکننده بر جداول public و یک سیاست بر Storage دیده شد. هر ۶ Auth User و ۶ Profile باقی بودند.
3. Migration `chatgpt_token_audience_hook_20261010` با پاسخ `success:true` ثبت شد؛ **تعریف تابع Hook نصب شده، نه اینکه Hook الزاماً در Authentication Dashboard فعال شده باشد**.
4. Edge Function `chatgpt-mcp` نسخهٔ ۱ با وضعیت `ACTIVE` مستقر شد.
5. Edge Function `chatgpt-api` نسخهٔ ۱ با وضعیت `ACTIVE` مستقر شد.
6. فهرست نهایی Migrationها و توابع Supabase وجود هر دو Migration و هر دو تابع را تأیید کرد. جدول مجوزها صفر سطر داشت؛ بنابراین هیچ کاربری به ChatGPT دسترسی نگرفته است.
7. GitHub Actions آخرین نسخهٔ کد: [نتیجهٔ موفق CI](https://github.com/mozdbaranarshiya/system/actions/runs/37908077789). این تست‌ها Mock/PGlite هستند، نه OAuth واقعی.

## مواردی که انجام نشد و نباید فعال فرض شود

- **مشکل محرمانگی:** ۶/۶ Auth User هنوز ایمیل مشتق‌شده از کد ملی دارند؛ ۵ حساب هم کلید ملی را در user_metadata دارند و اطلاعات هویت در auth.identities موجود است. بیرون‌دادن JWT OAuth به سرویس خارجی در این وضعیت ممنوع است.
- تابع جدید `school-login` هنگام انتشار توسط کنترل ابزار مسدود شد؛ منتشر نشده است. رابط فعلی سایت هنوز مسیر قدیمی `national_id@school.local` را برای Login استفاده می‌کند.
- `CHATGPT_OAUTH_PRIVACY_SAFE` در `config.js` همچنان `false` است و Secret سمت Edge عمداً فعال نشده. مسیرهای منتشرشده تا روشن شدن این کلید و ارائه Client ID/Audience معتبر با پاسخ غیرفعال بسته‌اند.
- OAuth Server در Dashboard، ثبت Client واقعی، Client ID، URI برگشت ChatGPT، Site URL/Authorization Path و Custom Access Token Hook در Dashboard با ابزارهای حاضر تنظیم نشده‌اند.
- Edge Functionهای قدیمی `admin-user` و `account-security` بازنشر نشده‌اند؛ تغییر نسخه‌های زنده پیش از هماهنگ‌سازی مهاجرت هویت می‌تواند Login یا ساخت کاربر را مختل کند.
- نسخهٔ پشتیبان خارج از پروژه، دسترسی بازیابی و آزمون Restore تأیید نشده‌اند. بنابراین ایمیل کاربران، Auth metadata، رمزها و دیتابیس تولید تغییر داده نشدند.
- تست واقعی Browser Login، TOTP، OAuth grant/deny، refresh/revoke، اعتبار JWT در API و اتصال ChatGPT انجام نشده است. تلاش برای اجرای بعضی queryهای پس از Migration نیز توسط کنترل‌های ابزار رد شد؛ به جای تأیید ساختگی، فقط مواردی که واقعاً کنترل شدند گزارش می‌شود.
- PR هنوز Draft است و وارد `main` یا GitHub Pages نشده؛ وجود Edge Functionها بدون مرورگر/کلاینت کامل به معنای قابلیت قابل استفاده نیست.

## اقدامات بعدی فقط به ترتیب امن

1. نسخهٔ پشتیبان قابل بازیابی Auth + DB + Storage تهیه و بازیابی آن آزمایش شود.
2. `school-login` با `SCHOOL_LOGIN_ORIGIN` صحیح مستقر و با حساب آزمایشی بررسی شود. نسخهٔ جدید مرورگر و ورود معمولی باید همزمان و کنترل‌شده منتشر شوند.
3. ایمیل Auth و identity data کاربران به شناسه‌های تصادفی و بدون کد ملی تبدیل شوند. ابزار `scripts/migrate-oauth-identities.ts` فقط با dry run، تأیید هدف و آزمون نشت JWT/Auth اجرا شود.
4. Client را در Supabase OAuth 2.1 ثبت کنید و Redirect URI واقعی ChatGPT را در allowlist بگذارید. `system_private.chatgpt_oauth_config` را با Client ID/Audience واقعی پر کنید و Hook سفارشی را در Dashboard فعال و تست کنید.
5. نسخه‌های هماهنگ `admin-user` و `account-security` مستقر و RLS/RPC/Storage در برابر OAuth JWT آزمایش شوند.
6. فقط پس از عبور همهٔ موارد، پرچم مرورگر و Secret سمت Edge را فعال کرده و E2E واقعی از ChatGPT را انجام دهید؛ سپس PR را Merge/Deploy کنید.

راهنمای تفصیلی: [اتصال ChatGPT](chatgpt-oauth.md).

## هشدارهای بررسی امنیتی غیرمرتبط با انتشار

Supabase Advisor همچنان هشدارهای اجرای SECURITY DEFINER توسط برخی نقش‌ها و تنظیم Leaked Password Protection را گزارش می‌کند. قبل از عرضهٔ عمومی باید جداگانه ارزیابی شوند؛ تغییر دسته‌جمعی مجوزهای قدیمی بدون ارزیابی وابستگی‌ها توصیه نمی‌شود.
