# استقرار افزایشی OAuth روی مدرسهٔ موجود

انتخاب فعلی مالک **`efibfevyiepkwpnobaro`** است؛ سایت و داده‌های واقعی مدرسه روی همین پروژه می‌مانند. این انتخاب جایگزین تصمیم قبلی به راه‌اندازی مدرسهٔ تازه در `pukanizbahswrupscfmg` شده است. حساب جدید یا انتقال داده لازم نیست و پروژهٔ آماده‌باش حذف یا بازنصب نمی‌شود.

## وضعیت بررسی‌شده — ۲۰۲۶-۱۰-۰۹

بررسی فقط‌خواندنی پروژهٔ فعلی، یک مدیر فعال با رمز تغییرکرده و TOTP تأییدشده، دو دبیر، سه دانش‌آموز و داده‌های آموزشی واقعی را نشان داد. همان هویت‌های Supabase Auth، UUIDها، پروفایل‌ها و روابط منابع حفظ می‌شوند. از مدیر موجود برای MFA، ثبت Client و Consent استفاده می‌شود؛ ساخت مدیر نخست یا اجرای SQL درج پروفایل جزو این استقرار نیست.

تابع‌های زندهٔ `chatgpt-api`، `chatgpt-mcp` و `consent-location` بررسی و حفظ می‌شوند. Provider OAuth بومی پروژه غیرفعال و فاقد Client ثبت‌شده است؛ وجود تابع‌های قدیمی به‌تنهایی جریان کامل اتصال حساب با MFA، Consent، کد یک‌بارمصرف و scopeهای آموزشی را فراهم نمی‌کند. `oauth-connector` جریان افزایشی را به Auth و مجوزهای همان مدرسه متصل می‌کند.

اجرای SQL جدید روی پروژهٔ فعلی هنوز تأیید نشده و استقرار تابع‌های این تغییر در آن باقی مانده است. تابع‌های جدید تاکنون فقط در پروژهٔ آماده‌باش مستقر و آزموده شده‌اند. تغییرات شاخه هنوز به `main` و سایت منتشرشده منتقل نشده‌اند؛ ورود واقعی با این قابلیت، callback و اتصال ChatGPT هنوز پذیرش نهایی ندارند.

## SQL افزایشی برای مالک

ابتدا Backup قابل‌بازیابی بگیرید. [SQL Editor پروژهٔ فعلی](https://supabase.com/dashboard/project/efibfevyiepkwpnobaro/sql/new) را با نقش `postgres` باز کنید و شناسهٔ پروژه را پیش از اجرا کنترل کنید. فایل آمادهٔ [source-oauth-setup.sql](../supabase/source-oauth-setup.sql) را کامل کپی و **یک‌بار** اجرا کنید. این بسته شامل موارد زیر در یک تراکنش است:

| ترتیب | منبع | تغییر |
| --- | --- | --- |
| ۱ | [20261007_oauth_connector.sql](../supabase/migrations/20261007_oauth_connector.sql) | Schema خصوصی `system_oauth`، Consent، code/token، RPCهای service-only، Audit، لغو و cleanup |
| ۲ | [20261009_manager_session_guard.sql](../supabase/migrations/20261009_manager_session_guard.sql) | RPC فقط-service برای کنترل Session و عامل TOTP جاری مدیر |
| ۳ | مجوز اجرایی بستهٔ SQL | `grant execute on function public.oauth_postgrest_guard() to service_role;` برای اجرای guard موجود در درخواست PostgREST خدمت |

فایل پایهٔ `schema.sql`، چهار Migration نسخهٔ ۷، نصب‌کنندهٔ `school` و فایل ساخت مدیر روی پروژهٔ فعلی اجرا نمی‌شوند. Migration OAuth نصب اولیه است؛ اجرای دوباره روش upgrade یا رفع خطا نیست. اگر اجرا خطا داد، تراکنش متوقف می‌شود و پیش از هر تلاش بعدی باید خطا و catalog بررسی شوند. حساب‌ها، Passwordها، عوامل MFA و داده‌های آموزشی موجود بازسازی یا پاک نمی‌شوند.

پس از موفقیت SQL، وجود هفت جدول OAuth با RLS، ACL تابع‌های service-only، Triggerهای لغو دسترسی، مدیر موجود و شمارش داده‌های قبلی بررسی شوند. `system_oauth` و `system_private` در Data API expose نشوند. اگر `pg_cron` موجود باشد Migration Job ساعتی `system-oauth-cleanup` را می‌سازد؛ در غیر این صورت scheduler مورداعتماد باید `select public.oauth_cleanup();` را با نقش مالک یا service هر ساعت اجرا کند. انقضای توکن در هر درخواست کنترل می‌شود و به cleanup وابسته نیست.

تولید دوبارهٔ artifact برای بازبینی محلی با [prepare-source-oauth.mjs](../supabase/prepare-source-oauth.mjs) انجام می‌شود:

```bash
node supabase/prepare-source-oauth.mjs --out /tmp/system-source-oauth-review
```

این ابزار به دیتابیس متصل نمی‌شود و `source-oauth.sql` و Manifest تولید می‌کند؛ فایل‌های خروجی قبلی را overwrite نمی‌کند. فایل SQL Editor ثبت‌شده باید با خروجی و Hash Manifest همان نسخه برابر باشد.

## تنظیم و استقرار Backend

فقط تنظیمات سفارشی لازم برای سه تابع افزایشی پیکربندی شوند:

```text
SYSTEM_DB_SCHEMA=public
OAUTH_SITE_URL=https://mozdbaranarshiya.github.io/system/index.html
OAUTH_ALLOWED_ORIGINS=https://mozdbaranarshiya.github.io
OAUTH_ALLOW_LOCAL_HTTP=false
```

کلیدهای `SUPABASE_*` را runtime همان پروژه فراهم می‌کند. کلیدهای فعلی، تنظیمات سراسری Auth، Passwordها، Sessionها، MFA و سیاست‌های مدرسه در این مرحله حفظ می‌شوند؛ تغییر کلید یا غیرفعال‌کردن Provider دیگری جزو این استقرار نیست. Secret و Service Role در مخزن، مرورگر یا ChatGPT قرار نمی‌گیرند.

`oauth-connector`، `admin-user` و `account-security` جداگانه با شناسهٔ صریح `efibfevyiepkwpnobaro` و `--no-verify-jwt` مستقر شوند. هر سه JWT دقیق کاربر را از Supabase Auth معتبر می‌کنند و `verify_jwt=false` در `supabase/config.toml` برای همین کنترل صریح ثبت شده است. OAuth علاوه بر JWT سایت، code exchange و توکن opaque را با مرز مستقل خود بررسی می‌کند. تابع‌های دیگر از جمله `chatgpt-api`، `chatgpt-mcp` و `consent-location` حفظ شوند؛ deploy با `--prune` انجام نشود.

در مدیریت کاربران و تغییر رمز مدیر، معتبرشدن JWT به‌تنهایی کافی نیست. RPC `public.assert_manager_session` فعال‌بودن مدیر و Auth، Session جاری AAL2 و عامل TOTP تأییدشدهٔ دقیق همان Session را بررسی می‌کند. حذف/انقضای Session، حذف عامل، downgrade یا خطای بررسی باعث رد عملیات می‌شود. سیاست AAL2 فعلی این عملیات حفظ می‌شود؛ فقط اتصال و مدیریت OAuth به TOTP تازه در ۱۰ دقیقهٔ گذشته نیاز دارد. قابلیت‌های موجود مدیریت کاربران و تغییر رمز حفظ می‌شوند؛ تغییر رمز اولیهٔ خود مدیر پس از MFA معتبر همچنان مجاز است.

## رابط و پذیرش انتشار

تنظیم عمومی سایت باید URL و Publishable Key همان پروژهٔ فعلی را نگه دارد. Database schema برابر `public` و Bucket تکلیف `assignment-files` است؛ مقدارهای پیش‌فرض برنامه همین‌ها هستند. برای این استقرار کلید `SUPABASE_AUTH_STORAGE_KEY` اضافه نشود تا Session موجود از namespace پیش‌فرض SDK ادامه یابد. تنظیمات `school`، `school-assignment-files` یا `system-school-pukan-auth` مربوط به آماده‌باش‌اند.

پس از نصب SQL و استقرار Backend، رابط همین شاخه منتشر شود. مدیر موجود وارد شود؛ Session معتبر نیاز به ورود دوباره با Password ندارد و TOTP تازه با عامل موجود تأیید می‌شود. مدیر callback دقیق ساخته‌شده توسط GPT Builder را در «برنامه‌های متصل» ثبت می‌کند. مراحل در [CHATGPT_SETUP.md](CHATGPT_SETUP.md) آمده‌اند.

پیش از اعلام اتصال کامل، Login، MFA تازه و رد Context قدیمی، Consent/deny، PKCE، code single-use، Refresh و Disconnect، دسترسی دانش‌آموز به دادهٔ خودش، تخصیص فعلی دبیر، مجوز واقعی مدیر و تابع‌های قبلی آزموده شوند. نبود Client واقعی یا callback تأییدشده با تست محلی جبران نمی‌شود. برای بازگشت، Backup و نسخهٔ قبلی رابط حفظ شوند؛ حذف حساب، داده یا منابع آماده‌باش روش rollback نیست.

## سابقهٔ پروژهٔ آماده‌باش

پروژهٔ `pukanizbahswrupscfmg` از قبل سرویس آزمون را در `public` دارد. نصب جداگانهٔ مدرسه در `school`، `school_private`، `school_oauth` و Bucket خصوصی `school-assignment-files` انجام شده است. ۴۷ جدول مدرسه و هفت جدول OAuth همگی RLS دارند و پروفایل مدرسه صفر است. داده‌ها، Policyها، تابع‌ها و Triggerهای قبلی با snapshot پیش از نصب مقایسه و حفظ شدند.

در آخرین بررسی، سه تابع مدرسه نسخهٔ ۲ `ACTIVE` با `verify_jwt=false` و `exam-api` نسخهٔ ۷ فعال بودند. Data API فقط `public,graphql_public,school` را expose می‌کند و Jobهای مستقل `school-v7-reminders` و `school-oauth-cleanup` فعال‌اند. ۲۱ بررسی مستقیم HTTP مرزهای رد درخواست، CORS، schema خصوصی و RPCهای فقط-service موفق شدند؛ هیچ ورود واقعی یا callback مدرسهٔ آماده‌باش آزموده نشد.

کلیدها و امضای `ES256` این آماده‌باش پیش‌تر تنظیم شده‌اند؛ این تغییرها شامل پروژهٔ فعلی `efibfevyiepkwpnobaro` نمی‌شوند. کاربران یا داده‌های مدرسه به آماده‌باش منتقل نشده‌اند. با انتخاب فعلی، نصب‌کنندهٔ [install-school.mjs](../supabase/install-school.mjs) دوباره اجرا و منابع آن پاک نمی‌شوند. ادامهٔ استقرار این سامانه از مدرسهٔ موجود استفاده می‌کند.

مدیریت از `api.supabase.com` انجام می‌شود و آزمون تابع‌های مدرسهٔ موجود به دسترسی شبکهٔ `efibfevyiepkwpnobaro.supabase.co` نیاز دارد. ذخیرهٔ Draft تنظیمات محیط به‌تنهایی اعمال شبکه نیست؛ تنظیمات بازسازی محیط باید Save و Publish شوند.
