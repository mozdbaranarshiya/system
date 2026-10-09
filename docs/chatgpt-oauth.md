# اتصال امن ChatGPT به سامانه `system`

> وضعیت: کد پیشنهادی روی شاخهٔ توسعه است؛ تا انجام مراحل بخش «قبل از انتشار» **قابل استفاده در محیط تولید نیست**. این قابلیت مستقل از روش ورود موجود طراحی نشده است؛ بر Supabase Auth متکی است.

## معماری و جریان اتصال

- Frontend: GitHub Pages، رابط فعلی `index.html`، `app.js` و `js/oauth.js`؛ ورود با کد ملی و رمز عبور **فقط داخل دامنهٔ سامانه** و Supabase Auth انجام می‌شود.
- Authorization Server: **Supabase Auth OAuth 2.1 Server**. خودش کلاینت‌ها، redirect URI دقیق، Authorization Code + PKCE S256، Consent واقعی، Refresh/Rotation، لغو Grant و endpointهای استاندارد را مدیریت می‌کند. از OAuth Server موازی، Implicit و ارسال رمز به ChatGPT استفاده نکنید.
- Resource Server: `supabase/functions/chatgpt-api/index.ts` یک Edge Function برای درخواست‌های فقط‌خواندنی. API از Supabase Auth توکن را بررسی می‌کند، Client را به کلاینت ثبت‌شده محدود می‌کند، وضعیت اتصال و پروفایل را از دیتابیس می‌خواند، سطح MFA مدیر را الزام می‌کند، سپس **مجوز داخلی/مالکیت منبع** را کنترل می‌کند.
- Postgres: `oauth_connected_apps` برای دسترسی‌های محدود و لغو فوری؛ RLS و `oauth_postgrest_guard` برای جلوگیری از دسترسی مستقیم توکن‌های OAuth به API گستردهٔ Supabase. دو Edge Function قدیمی نیز JWT دارای `client_id` را رد می‌کنند.
- Roleها از خود دیتابیس: فقط `student`، `teacher`، `manager`؛ هیچ Role ارسالی از طرف ChatGPT معتبر نیست.

```text
ChatGPT → Supabase Auth /oauth/authorize → GitHub Pages (?authorization_id=...)
→ Supabase existing session / login → manager TOTP AAL2 → password-ready gate
→ Consent → Supabase approveAuthorization → code + state to ChatGPT
→ /oauth/token (PKCE) → OAuth JWT (client_id) → Edge chatgpt-api
→ live Auth verification + active grant + profile + user roles/assignments → response
```

حالت SSO: اگر نشست معتبر سایت فعال باشد، مجدداً رمز عبور درخواست نمی‌شود؛ مدیر همچنان به MFA سطح `aal2` نیاز دارد. در حالت MFA enrollment، همان UI قبلی TOTP کار می‌کند. `must_change_password` مانع اتصال تا تغییر رمز می‌شود.

## API و مجوزها

| Endpoint | HTTP | OAuth | قابلیت مجاز محلی | کنترل داخلی |
|---|---|---|---|---|
| `/functions/v1/chatgpt-api/me` | GET | Bearer JWT + client_id | `profile.read` | کاربر فعال، رمز تغییرکرده، مدیر AAL2، Grant فعال |
| `/functions/v1/chatgpt-api/my/classes` | GET | Bearer JWT + client_id | `classes.read` | دانش‌آموز: `class_students` خودش؛ دبیر: `teacher_assignments` خودش؛ مدیر: کلاس‌های سامانه پس از MFA |

این دو قابلیت محلی به شکل قابل ابطال در `oauth_connected_apps.scopes` قرار می‌گیرند. **این‌ها Scope استاندارد OAuth نیستند.** Supabase Auth در نسخهٔ فعلی Scope سفارشی `profile.read` یا `classes.read` را در Authorization Request پشتیبانی نمی‌کند. برای درخواست OAuth تنها از scope استاندارد `profile` استفاده کنید؛ از `email` و `openid` جز در صورت ضرورت خودداری کنید. سایر APIهای نمرات، دانش‌آموزان و نوشتن داده **فعلاً عمداً عرضه نشده‌اند**. برای افزودن آنها ابتدا مالکیت و مجوز هر منبع را بررسی و تست کنید.

پاسخ `me`: `{"id":"...","display_name":"..."}`. پاسخ `my/classes`: `{"classes":[{"id":"...","title":"...","academic_year":"..."}]}`. اطلاعات حساس مثل کد ملی، نمره، رمز، توکن و MFA secret برنمی‌گردند.

## Endpoints استاندارد Supabase Auth

برای Supabase URL همان پروژهٔ مربوط به این سایت:

- Authorize: `https://<ref>.supabase.co/auth/v1/oauth/authorize`
- Token و Refresh: `https://<ref>.supabase.co/auth/v1/oauth/token`
- JWKS: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`
- OIDC Discovery: `https://<ref>.supabase.co/auth/v1/.well-known/openid-configuration`
- OAuth Authorization Server Discovery: `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`

Token Revocation/Grant management را از API استاندارد Supabase Auth و `supabase.auth.oauth.revokeGrant(clientId)` استفاده کنید؛ endpoint سفارشی برای Token و جدول Authorization Code نسازید. اسناد رسمی: [Getting Started](https://supabase.com/docs/guides/auth/oauth-server/getting-started)، [Flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows).

## مانع انتشار: افشای کد ملی در خود OAuth JWT

**بسیار مهم:** Supabase OAuth JWT استاندارد دارای claim اجباری `email` و ممکن است دارای `user_metadata` باشد؛ فیلتر scope `profile` فقط کافی نیست. در این سامانه email کاربر `national_id@school.local` است و metadata ایجاد/ویرایش کاربران نیز `national_id` دارد. **بنابراین دریافت OAuth Access Token توسط ChatGPT می‌تواند کد ملی (نام کاربری سامانه) را افشا کند، حتی اگر API فقط نام نمایشی برگرداند.**

این یک **شرط مسدودکنندهٔ انتشار** است. برای جلوگیری از فعال‌شدن اشتباهی، `CHATGPT_OAUTH_PRIVACY_SAFE` در `config.js` به‌صورت پیش‌فرض `false` است و Edge Function نیز بدون متغیر محیطی `CHATGPT_OAUTH_PRIVACY_SAFE=true` درخواست را رد می‌کند. این Flag **راه‌حل حریم خصوصی نیست**؛ تنها پس از انجام اصلاح واقعی و تست claimها می‌توان آن را فعال کرد.

راه‌حل نهایی باید ایمیل Auth را از شناسهٔ ملی مستقل کند (در عین حفظ Login نام کاربری با یک لایهٔ نگاشت امن سمت سرور)، metadata حساس را از JWT OAuth حذف کند، و تک‌تک Claimهای Access Token، UserInfo و OIDC را با یک حساب واقعی بررسی کند. چون حذف email از JWT استاندارد Supabase ممکن نیست (required claim)، صرفاً Auth Hook برای حذف metadata یا غیر فعال کردن Scope email کافی نیست. **قبل از رفع این وابستگی، پروژه را روی محیط تولید OAuth-enable نکنید.**

منابع: [Supabase OAuth Token Security](https://supabase.com/docs/guides/auth/oauth-server/token-security)، [Supabase Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

## راه‌اندازی پروژه واقعی

1. **تطبیق پروژه:** پیش از اجرا، URL پروژهٔ متصل به سایت در `config.js` را با Project Ref / پنل خود تطبیق دهید. اشتباه گرفتن دو پروژه موجب خرابی یا نشت داده می‌شود.
2. روی **همان Supabase Project** از Authentication → OAuth Server، OAuth 2.1 Server را فعال کنید. Site URL و Authorization Path را طوری تنظیم کنید که آدرس نهایی دقیقاً `https://mozdbaranarshiya.github.io/system/` شود. مسیر ساخته‌شده را با یک درخواست آزمایشی بررسی کنید؛ تنظیم Site URL بر لینک‌های دیگر Auth اثر دارد.
3. در Authentication → OAuth Apps، یک Client به نام ChatGPT بسازید. برای ChatGPT به‌عنوان سرویس سمت سرور از confidential client استفاده کنید (با توجه به روش Token Endpoint Authentication پشتیبانی‌شده توسط رابط ChatGPT). **فقط URI برگشت واقعی نمایش‌داده‌شده در تنظیمات ChatGPT** را ثبت کنید. Redirect URI باید Exact Match باشد؛ هیچ URL ساختگی یا `*` وارد نکنید. `client_id` را بردارید و `client_secret` را فقط در پیکربندی محرمانهٔ ChatGPT نگه دارید، نه در سایت یا Git.
4. در `config.js`، مقدار `CHATGPT_OAUTH_CLIENT_ID` را با شناسهٔ واقعی جایگزین کنید (این شناسه Secret نیست). در محیط Edge Function همان مقدار را به‌عنوان Secret/Environment `CHATGPT_OAUTH_CLIENT_ID` تنظیم کنید. کلیدهای سرویس Supabase را فقط در Edge Function نگه دارید؛ کد فعلی با `SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY` سازگار است.
   - فقط پس از رفع مشکل افشای کد ملی و اجرای آزمون‌های JWT/UserInfo، Flag عمومی `CHATGPT_OAUTH_PRIVACY_SAFE: true` و Secret هم‌نام Edge Function با مقدار `true` فعال شوند. در حالت پیش‌فرض هر دو خاموش می‌مانند.
5. پس از تأیید وضعیت دیتابیس و پشتیبان‌گیری، Migration `supabase/migrations/20261009_chatgpt_oauth.sql` را **پس از** Migrationهای v7 اعمال کنید. این Migration روی RLS موجود و نقش PostgREST `authenticator` اثر امنیتی دارد. پیش از اجرا، هر `pgrst.db_pre_request` موجود را بررسی کنید؛ Migration در صورت وجود Hook متفاوت خطا می‌دهد و آن را بی‌اجازه جایگزین نمی‌کند. تأثیر بر APIهای عادی سایت را تست کنید.
6. Edge Function را از همان پروژه deploy کنید:
   ```bash
   supabase link --project-ref YOUR_REAL_PROJECT_REF
   supabase functions deploy chatgpt-api
   ```
   سپس اصلاحات دو Edge Function `admin-user` و `account-security` را هم deploy کنید. برای این دو، JWT را در Supabase Auth بررسی کنید، `client_id` را رد کنید و کلید Service Role را داخل Browser قرار ندهید. تنظیم تأیید JWT Edge Functions را در Production بررسی کنید.
7. GitHub Pages را با همین Branch/PR پس از تأیید CI منتشر کنید. `main` تا بررسی نهایی باید دست‌نخورده بماند.
8. در ChatGPT هنگام ساخت Action/Connector مناسب، OAuth را با Authorize و Token URLهای بالا، Client ID/Secret و Scope استاندارد `profile` تنظیم کنید. API base URL را به Edge Function دهید و فقط دو عملیات GET بالا را در OpenAPI تعریف کنید. ChatGPT نباید رمز، کد ملی یا OTP را بپرسد.
   - طرح عملیاتی قابل ورود به ChatGPT در [chatgpt-openapi.yaml](chatgpt-openapi.yaml) قرار دارد. آدرس Server آن باید با پروژهٔ واقعی Supabase یکسان باشد.

## قطع اتصال و دورة عمر توکن

کاربر در `امنیت حساب → برنامه‌های متصل → قطع اتصال ChatGPT` ابتدا Grant داخلی را `revoked_at` می‌کند تا **درخواست بعدی Edge** فوراً رد شود، سپس `revokeGrant` Supabase refresh/sessionهای OAuth را قطع می‌کند. این محافظت از محدودیت طبیعی JWTهای صادرشده که ممکن است تا Expiry در سرویس‌های دیگر پذیرفته شوند مهم است. Account Security سایت و خروج از همهٔ دستگاه‌ها جداگانه باقی می‌ماند.

مقادیر حساس در هیچ Log یا پیکربندی Public ذخیره نشوند. Audit محلی Connect/Disconnect را بدون Token ذخیره می‌کند؛ رخدادهای Authorization/Refresh را در Logهای Supabase Auth بررسی کنید. برای نرخ‌محدودسازی Login/Token/MFA از تنظیمات Supabase و در صورت نیاز لایهٔ Edge استفاده کنید.

## پیش از انتشار و سناریوهای واقعیِ الزامی

- اجرای `npm ci && npm run check && npm test && npm run test:oauth` روی Clone کامل پروژه با Node سازگار و PostgreSQL آزمایشی. Tests جدید در `tests/oauth.mjs` از Mock برای Auth/DB استفاده می‌کنند و **E2E محسوب نمی‌شوند**.
- تست End-to-End روی **پروژهٔ آزمایشی Supabase که با GitHub Pages مرتبط است** برای دانش‌آموز، دبیر و مدیر: OAuth S256+state، callback، Token Exchange، Refresh، AAL2 و TOTP، MFA enrollment، Consent denied، IDOR در کلاس‌ها، Disconnect و Reconnect.
- تست دسترسی مستقیم OAuth JWT به `/rest/v1/*`، `/rest/v1/rpc/*`، Storage، `admin-user` و `account-security`؛ همه باید رد شوند. در عین حال ورود و APIهای قبلی Browser نباید مختل شوند.
- **ریسک حریم خصوصی هویت:** ایمیل داخلی حساب‌ها از کد ملی ساخته می‌شود؛ در Scope `email` یا برخی Endpointهای Supabase Auth احتمال افشای آن به Client خارجی وجود دارد. پیش از عرضه عمومی، داده‌های هویتی و OIDC UserInfo را بررسی و در صورت نیاز تغییر مدل ایمیل یا راهکار واسط ایزوله اجرا کنید.
- مدیریت HTTP headers، CORS محدود، CSRF درخواست Consent، Session fixation، rate limits، audit events، رفتار SDK فعلی و سازگاری Host/Redirect بررسی شوند. `state` و PKCE را ChatGPT/OAuth Server کنترل می‌کنند؛ این‌ها جایگزین CSRF صفحات Forms نیستند.
- Scopeهای OAuth سفارشی فعلاً توسط Supabase پشتیبانی نمی‌شوند؛ پیاده‌سازی آن‌ها در دیتابیس محلی، سطح OAuth Token را کاهش نمی‌دهد. تا اثبات قفل مستقیم سایر APIها، از ورود داده‌های حساس واقعی به جریان OAuth خودداری کنید.

## وضعیت پایان کار

کد Integration و تست‌های Mock/پایگاه دادهٔ آزمایشی افزوده شده‌اند، **اما** پیکربندی واقعی OAuth Client، راه‌اندازی Supabase OAuth Server، نصب Migration، Deploy، تست زنده و Security Review در محیط عملیاتی هنوز لازم است. نباید این وضعیت را «کاملاً production-ready» یا «اتصال واقعی موفق» گزارش کرد.
