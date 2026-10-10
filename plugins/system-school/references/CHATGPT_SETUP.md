> نسخهٔ همراه بستهٔ Plugin؛ SQL و مستندات کامل در Repository لینک شده‌اند و با Upload افزونه اجرا نمی‌شوند.

# فعال‌سازی اتصال مدرسهٔ موجود در ChatGPT

پروژهٔ انتخاب‌شده **`efibfevyiepkwpnobaro`**، همان Backend فعلی سایت و کاربران واقعی مدرسه است. مدیر فعالِ دارای رمز تغییرکرده و TOTP تأییدشده از قبل وجود دارد؛ از همان حساب و MFA استفاده می‌شود. ساخت مدیر تازه، درج پروفایل، انتقال کاربران یا تغییر پروژه لازم نیست. ساختار نصب‌شده در `pukanizbahswrupscfmg` فعلاً آماده‌باش می‌ماند.

این قابلیت با **GPT Actions** و OAuth Authorization Code کار می‌کند. اجرای SQL جدید روی پروژهٔ انتخاب‌شده هنوز تأیید نشده و تابع‌های جدید مدرسه تاکنون فقط در پروژهٔ آماده‌باش مستقر شده‌اند. تغییرات این شاخه هنوز روی `main` و سایت منتشرشده قرار نگرفته‌اند؛ URLهای زیر تنظیم نهایی‌اند و تا پایان استقرار، تأیید اتصال عملی نیستند.

## اجرای SQL توسط مالک

1. از دیتابیس فعلی Backup قابل‌بازیابی تهیه کنید. [SQL Editor پروژهٔ فعلی](https://supabase.com/dashboard/project/efibfevyiepkwpnobaro/sql/new) را باز کنید و نام پروژه و نقش `postgres` را بررسی کنید.
2. فایل آمادهٔ [source-oauth-setup.sql](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/supabase/source-oauth-setup.sql) را کامل کپی و یک‌بار اجرا کنید. این بسته [Migration OAuth](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/supabase/migrations/20261007_oauth_connector.sql)، [کنترل Session مدیر](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/supabase/migrations/20261009_manager_session_guard.sql) و مجوز اجرای `public.oauth_postgrest_guard()` برای `service_role` را در یک تراکنش اجرا می‌کند. اجرای فایل‌های پایه، Migrationهای نسخهٔ ۷ یا نصب‌کنندهٔ `school` روی این پروژه لازم نیست.
3. خروجی موفق بسته باید `oauth_tables=7`، `oauth_rls_tables=7`، `service_guard_allowed=true` و `manager_session_guard_ready=true` داشته باشد. اگر SQL خطا داد، متن خطا را بدون رمز، Token یا اطلاعات کاربر گزارش کنید؛ Migration را برای دورزدن خطا دوباره اجرا یا جدول‌های موجود را حذف نکنید. پس از تأیید موفقیت، کنترل catalog و استقرار تابع‌ها انجام شود.

این SQL حساب، Password، TOTP یا داده‌های آموزشی فعلی را بازسازی نمی‌کند. توابع موجود `chatgpt-api`، `chatgpt-mcp` و `consent-location` حفظ می‌شوند. Backend جدید فقط پس از نصب SQL، با `SYSTEM_DB_SCHEMA=public` مستقر می‌شود؛ تنظیمات Auth، کلیدهای پروژه و سیاست‌های جاری سایت حفظ می‌شوند. راهنمای فنی و وضعیت مراحل در [MIGRATION.md](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/docs/MIGRATION.md) آمده است.

## استفاده از مدیر موجود

بعد از استقرار Backend و انتشار رابط، مدیر با روش فعلی وارد سایت شود. Session معتبر به ورود دوباره با Password نیاز ندارد. اگر TOTP اتصال قدیمی‌تر از ۱۰ دقیقه باشد، همان عامل موجود برای تأیید تازه استفاده می‌شود؛ عامل تأییدشده دوباره ثبت نمی‌شود. بدون MFA معتبر، ثبت Client یا صدور کد OAuth ممکن نیست. رمز، JWT، Setup Key و OTP مدیر را در چت، GitHub یا ابزار توسعه ارسال نکنید.

## تنظیم GPT Actions

1. در ChatGPT، **Create a GPT → Configure → Actions → Create new action** را باز کنید.
2. فایل [chatgpt-openapi.yaml](chatgpt-openapi.yaml) را کپی یا از URL خام شاخهٔ منتشرشده Import کنید. URLهای Server، Authorization و Token باید همگی به `efibfevyiepkwpnobaro` اشاره کنند.
3. **Authentication → OAuth** را انتخاب کنید. Callback URL دقیق نمایش‌داده‌شده توسط GPT Builder را کپی کنید؛ برای هر GPT ممکن است متفاوت باشد.
4. مدیر در سایت منتشرشده، **برنامه‌های متصل → ثبت برنامه برای اتصال ChatGPT** را باز کند. همان callback را دقیق ثبت کند و فقط Scopeهای لازم را انتخاب کند. پیش‌فرض اطلاعات پایهٔ حساب است. Client باید confidential باشد. اگر GPT Actions شما PKCE ارسال نمی‌کند، الزام PKCE را فقط برای همین Client غیرفعال کنید؛ برای Client عمومی S256 اجباری است.
5. `Client ID` و `Client Secret` یک‌بار نمایش داده می‌شوند. آن‌ها را در تنظیم OAuth خود GPT قرار دهید؛ رمز حساب مدرسه یا کد TOTP را در ChatGPT وارد نکنید. درخواست ثبت Client و Consent باید TOTP تازهٔ مدیر را داشته باشد.

| تنظیم | مقدار |
| --- | --- |
| Authorization URL | `https://efibfevyiepkwpnobaro.supabase.co/functions/v1/oauth-connector/oauth/authorize` |
| Token URL | `https://efibfevyiepkwpnobaro.supabase.co/functions/v1/oauth-connector/oauth/token` |
| Refresh | همان Token URL با `grant_type=refresh_token` |
| Token exchange | POST؛ `client_secret_post` یا `client_secret_basic`، فقط یکی |
| Scope حداقلی | `profile.read` |
| Scopeهای اختیاری | `classes.read grades.read assignments.read`، فقط موارد ثبت‌شده برای Client |

6. تنظیم GPT را ذخیره کنید و یک Action را آزمایش کنید. گزینهٔ **Sign in / Connect** کاربر را به سایت مدرسه می‌برد. کاربر با ورود یا Session فعلی، MFA در صورت نیاز و Consent صریح برمی‌گردد. ChatGPT فقط Token اتصال را دریافت می‌کند.
7. با حساب واقعی دانش‌آموز، دبیر و مدیر بررسی کنید که اطلاعات مجاز فعلی برمی‌گردند و منابع دیگران قابل‌مشاهده نیستند. deny، Refresh، Session قبلی و Disconnect نیز آزموده شوند.

Callback و ثبت Client به GPT واقعی و حساب مدیر وابسته‌اند؛ آدرس callback فرضی یا wildcard اتصال را کامل نمی‌کند. Client Secret را فقط در تنظیمات امن GPT نگه دارید. رابط REST این تغییر، GPT Actions را فراهم می‌کند؛ وضعیت تابع MCP موجود، پذیرش مستقل خود را دارد.

## قطع اتصال

کاربر در سایت **برنامه‌های متصل → قطع اتصال** را انتخاب کند. Access Token، Refresh Token، کدها و درخواست‌های معلق همان اتصال باطل می‌شوند. برای اتصال دوباره، Consent تازه لازم است. مدیر با مجوز داخلی و MFA تازه نیز می‌تواند Client یا اتصال مجاز را لغو کند.

جزئیات سیاست‌ها و تست‌ها در [OAUTH.md](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/docs/OAUTH.md) و وضعیت استقرار در [MIGRATION.md](https://github.com/mozdbaranarshiya/system/blob/feature/secure-chatgpt-oauth/docs/MIGRATION.md) آمده‌اند.
