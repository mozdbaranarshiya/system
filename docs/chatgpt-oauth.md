# اتصال فقط‌خواندنی ChatGPT به سامانه مدارس — راهنمای اجرا و بررسی امنیت

> **تا تأیید پروژهٔ Supabase و تست واقعی فعال نکنید.** این شاخه شامل کد قابل تست است، نه یک اتصال زندهٔ تأییدشده. از ادغام کد ورود جدید در GitHub Pages پیش از استقرار school-login خودداری کنید.

## معماری

1. کاربر فقط در صفحهٔ رسمی مدرسه با کد ملی، رمز عبور و (برای مدیر) TOTP وارد می‌شود. رمز و کد TOTP هرگز از ChatGPT درخواست نمی‌شوند.
2. [school-login](../supabase/functions/school-login/index.ts) کد ملی را در جدول private-by-RLS profiles پیدا می‌کند، ایمیل **غیرهویتی** واقعی Auth را از Admin API می‌گیرد، رمز را با خود Supabase Auth بررسی می‌کند و نشست را به مرورگر مدرسه بازمی‌گرداند. خود ایمیل دیگر از کد ملی ساخته نمی‌شود.
3. Supabase Auth OAuth 2.1 Server مسئول ثبت Client، Authorization Code + PKCE، Consent، Token، Refresh و Grant است. [js/oauth.js](../js/oauth.js) فقط برای Client ازپیش‌ثبت‌شده و Scope استاندارد profile صفحهٔ رضایت را نمایش می‌دهد؛ در دیتابیس قابلیت‌های داخلی profile.read و classes.read ثبت می‌شوند (این‌ها **OAuth scope پروتکلی نیستند**).
4. [chatgpt-mcp](../supabase/functions/chatgpt-mcp/index.ts) یک سرور MCP بدون حالت روی Streamable HTTP است. آدرس اصلی آن:
   https://YOUR_REAL_PROJECT_REF.supabase.co/functions/v1/chatgpt-mcp
   مسیر GET زیر برای کشف OAuth وجود دارد:
   https://YOUR_REAL_PROJECT_REF.supabase.co/functions/v1/chatgpt-mcp/.well-known/oauth-protected-resource
   این سرور تنها دو ابزار get_my_school_account و get_my_school_classes را عرضه می‌کند و هر دو read-only هستند.
5. [chatgpt-api](../supabase/functions/chatgpt-api/index.ts) روی هر فراخوانی، توکن OAuth را با Supabase Auth تأیید می‌کند، client_id، issuer، audience اختصاصی، expiry، مجوز محلی معتبر، نقش، وضعیت حساب و MFA مدیر را بررسی می‌کند. فهرست کلاس فقط مطابق عضویت دانش‌آموز/تخصیص دبیر برگشت داده می‌شود؛ توکن با کد ملی در claim ایمیل رد می‌شود.
6. [Migration 20261009](../supabase/migrations/20261009_chatgpt_oauth.sql) دسترسی مستقیم JWTهای OAuth به REST/RPC/Storage را می‌بندد. [Migration 20261010](../supabase/migrations/20261010_chatgpt_token_audience.sql) Custom Access Token Hook برای audience اختصاصی سرور MCP را تعریف می‌کند و user_metadata را از OAuth JWT حذف می‌کند؛ باید در Dashboard به‌صورت دستی فعال شود.

## مانع اجرایی فعلی: پروژهٔ نامنطبق

- آدرس موجود در config.js مخزن: https://efibfevyiepkwpnobaro.supabase.co
- پروژهٔ Supabase متصل به گفتگوی فعلی: pukanizbahswrupscfmg (این دو یکسان نیستند).
- **هیچ SQL، Secret، Hook، تغییر کاربر یا Edge Function را روی پروژهٔ اشتباه اجرا نکنید.** نخست از Dashboard مالکیت پروژهٔ مقصد را تأیید کنید یا GitHub Pages را به پروژهٔ جدید و کنترل‌شده با مهاجرت مستقل و مجوز صریح متصل کنید. اطلاعات واقعی کاربران نباید بدون برنامهٔ انتقال به پروژهٔ متفاوت منتقل شود.

## ترتیب استقرار، مخصوص مالک پروژهٔ صحیح

### ۱. آماده‌سازی

- از Auth Users، دیتابیس و تنظیمات فعلی پشتیبان بگیرید. محدودیت نرخ Auth، Recovery و امنیت GitHub Pages را بررسی کنید.
- با Supabase CLI نسخهٔ فعلی، شاخه را دریافت کنید و فقط به پروژهٔ مرجع درست link کنید؛ پروژهٔ واقعی را با URL config.js تطبیق دهید.
- متغیر SCHOOL_LOGIN_ORIGIN را دقیقاً برابر **origin** وب‌سایت تعیین کنید؛ برای این GitHub Pages مقدار آن https://mozdbaranarshiya.github.io است، **بدون** /system/. کلید Secret/Service Role تنها در تنظیمات امن Edge نگهداری شود.

### ۲. ابتدا school-login، سپس سایت و مهاجرت هویت

~~~bash
supabase link --project-ref YOUR_VERIFIED_PROJECT_REF
supabase secrets set SCHOOL_LOGIN_ORIGIN=https://mozdbaranarshiya.github.io
supabase functions deploy school-login --no-verify-jwt
~~~

school-login به‌دلیل استفاده قبل از لاگین باید بدون JWT gateway اجرا شود، اما خودش Origin، شناسه، رمز و Supabase Auth را بررسی می‌کند. HTTPS، نرخ‌محدودسازی Auth و پایش تلاش‌های ناموفق الزامی‌اند. با حساب‌های تست، ورود، تغییر رمز، MFA، Logout و Refresh را بررسی کنید.

**پیش از تغییر ایمیل حساب‌های قبلی**، فرانت‌اند این شاخه که از school-login استفاده می‌کند باید منتشر و آزموده شده باشد؛ نگاشت رمز قدیمی و جدید توسط همین Adapter انجام می‌شود. مسیر ورود قدیمی نباید پس از مهاجرت در تولید باقی بماند.

### ۳. مهاجرت ایمیل‌های حساس به شناسه‌های مبهم

اسکریپت [scripts/migrate-oauth-identities.ts](../scripts/migrate-oauth-identities.ts) حالت Dry-run دارد و هیچ رمز یا ایمیلی را چاپ نمی‌کند. ابتدا با Credential مدیر Auth پروژهٔ مقصد تست کنید و سپس با تأیید و بکاپ اجرا کنید:

~~~bash
export SUPABASE_URL=https://YOUR_VERIFIED_PROJECT_REF.supabase.co
export SCHOOL_EXPECTED_SUPABASE_REF=YOUR_VERIFIED_PROJECT_REF
export SUPABASE_SERVICE_ROLE_KEY=YOUR_SECRET_FROM_SECURE_ENV
deno run --allow-env --allow-net scripts/migrate-oauth-identities.ts
export SCHOOL_IDENTITY_MIGRATION_CONFIRM=I_HAVE_BACKED_UP_AND_DEPLOYED_SCHOOL_LOGIN
deno run --allow-env --allow-net scripts/migrate-oauth-identities.ts --execute
~~~

اسکریپت ایمیل Auth را به u-<UUID>@school.local تغییر می‌دهد و user_metadata را پاک می‌کند. تغییر نام کاربری قابل مشاهده در UI مدرسه رخ نمی‌دهد؛ profiles.national_id برای Login داخلی می‌ماند. هر خطا یا باقی‌ماندن ایمیل حساس در user یا identities باید جلوی فعال شدن OAuth را بگیرد.

**ممیزی الزامی قبل از فعال‌سازی:** Auth admin.getUserById، خروجی /auth/v1/user برای JWT عادی و OAuth، OAuth JWT رمزگشایی‌شده، OAuth UserInfo برای هر Scope قابل درخواست، identities و user_metadata را با حساب تست بررسی کنید که کد ملی وجود نداشته باشد. از دادهٔ واقعی افراد در لاگ و تست عمومی استفاده نکنید. اگر قدیمی‌ترین شناسه‌ها یا نشست‌ها همچنان دادهٔ حساس برمی‌گردانند، انتشار را متوقف کنید و نشست‌های قدیمی را طبق سیاست مدرسه باطل کنید.

### ۴. دیتابیس، OAuth Server و audience

- Migrationهای قدیمی v7 باید از قبل نصب باشند؛ سپس به ترتیب 20261009_chatgpt_oauth.sql و 20261010_chatgpt_token_audience.sql را با ابزار معمول Supabase اعمال کنید. اگر pgrst.db_pre_request از قبل Hook دیگری دارد، SQL **عمداً خطا می‌دهد**؛ بدون ترکیب امن Hookها آن را تغییر ندهید.
- در Authentication → OAuth Server، OAuth 2.1 را فعال و Authorization path را به آدرس رضایت سایت https://mozdbaranarshiya.github.io/system/ تنظیم کنید. بررسی کنید پارامتر authorization_id در مرورگر باقی بماند.
- ChatGPT Plugin هنگام ساخت صفحهٔ Callback/Redirect URI دقیق خود را نشان می‌دهد. **همان مقدار نمایش‌داده‌شده** را در Allowlist ثبت OAuth Client استفاده کنید؛ آدرس Redirect را حدس نزنید. ترجیح با Client ازپیش‌ثبت‌شده و PKCE S256 و Scope تنها profile است. Client ID را ثبت کنید، DCR عمومی را بدون ضرورت روشن نکنید.
- جدول خصوصی hook را با مقادیر واقعی Client ID و Resource URL مقداردهی کنید:

~~~sql
insert into system_private.chatgpt_oauth_config (singleton,client_id,audience)
values (true,'YOUR_REGISTERED_CLIENT_ID',
        'https://YOUR_VERIFIED_PROJECT_REF.supabase.co/functions/v1/chatgpt-mcp')
on conflict (singleton) do update
  set client_id = excluded.client_id, audience = excluded.audience;
~~~

- در Authentication → Hooks → Custom Access Token، تابع system_private.chatgpt_access_token_hook را انتخاب و فعال کنید. اگر از قبل Hook فعال وجود دارد **جایگزین نکنید**؛ منطق هر دو را به‌شکل کنترل‌شده ترکیب و آزمون کنید. audience توکن Client منتخب باید دقیقاً با URL Resource برابر باشد؛ سایر کاربران وب نباید تغییر JWT مخرب ببینند.

### ۵. Edge Resource و MCP، سپس فعال‌سازی محافظت‌شده

~~~bash
supabase secrets set CHATGPT_OAUTH_CLIENT_ID=YOUR_REGISTERED_CLIENT_ID
supabase secrets set CHATGPT_RESOURCE_AUDIENCE=https://YOUR_VERIFIED_PROJECT_REF.supabase.co/functions/v1/chatgpt-mcp
supabase functions deploy chatgpt-api --no-verify-jwt
supabase functions deploy chatgpt-mcp --no-verify-jwt
supabase functions deploy admin-user
supabase functions deploy account-security
~~~

این دو endpoint عمومی gateway JWT verification را خاموش می‌کنند، اما **chatgpt-api خودش به‌صورت الزامی JWT را معتبرسازی می‌کند** و هیچ داده‌ای بدون مجوز برنمی‌گرداند؛ chatgpt-mcp درخواست را با همان Bearer به chatgpt-api ارسال می‌کند. برای راه‌اندازی ابتدا Endpointهای عمومی initialize، tools/list و OAuth discovery را بررسی کنید، سپس با JWT نامعتبر، JWT Client دیگر، JWT با Audience اشتباه و JWT لغوشده حتماً رد شدن را آزمایش کنید.

فقط **پس از** رفع کامل محرمانگی هویت، فعال بودن Audience Hook، بررسی Auth UserInfo/Identities، MFA، دیتابیس و تست زنده، Secret زیر را در محیط Edge تنظیم کنید و flag مشابه را در config.js پروژهٔ درست true کنید:

~~~bash
supabase secrets set CHATGPT_OAUTH_PRIVACY_SAFE=true
~~~

هرگز فقط برای عبور از خطای 503 این Flag را true نکنید؛ به‌صورت پیش‌فرض عمداً خاموش است.

## اتصال در ChatGPT

1. در ChatGPT به **Settings → Plugins** یا صفحهٔ ساخت Plugin سفارشی در دسترس حساب/فضای کاری خود بروید. بسته به سطح دسترسی و نسخهٔ رابط ممکن است مسیر **Settings → Apps → Create** و Developer Mode باشد.
2. نوع **Remote MCP / Custom MCP** را انتخاب کنید. URL دقیق MCP را تنظیم کنید:
   https://YOUR_VERIFIED_PROJECT_REF.supabase.co/functions/v1/chatgpt-mcp
3. احراز هویت **OAuth** را انتخاب کنید. Server از مسیر .well-known/oauth-protected-resource، Supabase Auth را معرفی می‌کند. برای Client ثبت‌شده، مقادیر مورد نیاز را از Supabase بگیرید؛ Scope درخواست فقط profile است. Authorization/Token endpointهای Supabase به‌ترتیب /auth/v1/oauth/authorize و /auth/v1/oauth/token هستند.
4. Redirect URI نمایش داده‌شده در ChatGPT را در OAuth Client در Supabase ثبت کنید، سپس Scan Tools / Test Connection را اجرا کنید. هنگام اتصال، صفحهٔ رسمی مدرسه باز می‌شود؛ کاربر با کد ملی و رمز خودش وارد می‌شود، مدیر MFA را تکمیل می‌کند و به ChatGPT فقط دسترسی نمایش‌داده‌شده را تأیید یا رد می‌کند.
5. در ChatGPT دو دستور آزمایشی بفرستید: «نام حساب مدرسهٔ متصل من را نمایش بده» و «کلاس‌هایی را که مجوز دیدنشان دارم نشان بده». عملیات افزودن، حذف، ثبت نمره یا تغییر داده اصلاً به‌عنوان Tool عرضه نشده‌اند.
6. برای قطع دسترسی، در سامانهٔ مدرسه → امنیت حساب → برنامه‌های متصل، **قطع اتصال ChatGPT** را بزنید. تست کنید توکن قبلی از درخواست بعدی 403/401 بگیرد.

فایل [docs/chatgpt-openapi.yaml](chatgpt-openapi.yaml) مربوط به API مستقیم قدیمی است و **برای Plugin مبتنی بر MCP جایگزین URL سرور MCP نیست**.

## تست، مانیتورینگ و شرط انتشار

~~~bash
npm ci
npm run check
npm test
npm run test:oauth
~~~

تست‌ها شامل تست PGlite دیتابیس و RLS، Mock امنیت Edge، JS/DOM رضایت، adapter ورود و JSON-RPC/MCP هستند، ولی **تست واقعی یکپارچهٔ Supabase و ChatGPT را جایگزین نمی‌کنند**. قبل از ادغام در main موارد زیر در محیط همان پروژهٔ مقصد باید ثبت شوند:

- OAuth grant/deny، PKCE + state، Refresh/Rotation، expiry، Disconnect و Reconnect.
- سطح نقش مدیر AAL1 در برابر AAL2، دانش‌آموز بدون کلاس، دبیر فقط کلاس‌های تخصیص‌یافته، جلوگیری از IDOR و تأیید عدم برگشت شناسهٔ ملی در تمام Claims و Auth endpoints.
- دسترسی مستقیم OAuth JWT به REST/RPC/Storage و Edge Functionهای قدیمی باید رد شود؛ Login، MFA و تغییر رمز معمولی همچنان کار کنند.
- Token Audience دقیق، client_id دقیق، متادیتای Protected Resource، درخواست POST initialize/tools/list/tools/call و پاسخ 401 با WWW-Authenticate.
- بررسی Refresh Token، تنظیم rate limits، audit، تنظیمات Secret و مانیتور کردن لاگ‌ها بدون ذخیرهٔ JWT یا اطلاعات شخصی.

**توضیح وضعیت:** GitHub PR به‌صورت Draft نگهداری شود تا پروژهٔ صحیح، هویت کاربران، OAuth Client، Hook، کلیدها و تست واقعی تأیید شوند. بدون دسترسی به پروژهٔ مقصد، هیچ گزارشی از «استقرار موفق» یا «اتصال واقعی ChatGPT» نباید ارائه شود.

مراجع فنی: [Supabase OAuth Server](https://supabase.com/docs/guides/auth/oauth-server)، [Supabase MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)، [OpenAI Plugin OAuth](https://developers.openai.com/plugins/build/auth).
