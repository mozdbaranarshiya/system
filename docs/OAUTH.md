# اتصال امن حساب مدرسه به ChatGPT

## Current Architecture / Authentication / Roles

پروژه نسخهٔ ۷ رابط HTML/CSS/JavaScript فارسی روی GitHub Pages دارد؛ Framework و build فرانت‌اند ندارد. Backend موجود Supabase Auth، PostgreSQL/RLS و Deno Edge Functions است. `profiles.id` به `auth.users.id` متصل است. Login موجود کد ملی را به ایمیل `national_id@school.local` تبدیل می‌کند؛ بررسی و hash رمز فقط در Supabase Auth انجام می‌شود. Session مرورگر را SDK با Bearer JWT نگه می‌دارد، نه Cookie متعلق به این برنامه. OAuth جایگزین Login نیست.

نقش‌های واقعی فقط `student`، `teacher` و `manager` هستند. نماینده و سرگروه رابطهٔ منابع هستند. جدول Permission عمومی وجود ندارد؛ مجوزها در SQL/RLS و توابع `account_ready`، `is_manager`، `teacher_has_access`، `can_read_class` و `can_read_student` تعریف شده‌اند. عضویت دانش‌آموز از `class_students` و تخصیص دبیر از `teacher_assignments` خوانده می‌شود. مدیر باید AAL2 داشته باشد و حساب فعال با رمز اولیهٔ تغییرکرده باشد.

فایل‌های مرتبط: `app.js`، `js/auth.js`، `js/core.js`، `index.html`، `supabase/schema.sql`، migrationهای نسخهٔ ۷ و `supabase/functions/account-security/` و `admin-user/`. تست‌های موجود از PGlite، JSDOM، Node و Playwright استفاده می‌کنند. Audit موجود immutable است؛ خطاهای جدید JSON استاندارد و بدون جزئیات داخلی‌اند.

## Architecture implemented

یک Edge Function به نام `oauth-connector` رابط OAuth-compatible Authorization Code را فراهم می‌کند و از Supabase Auth موجود برای هویت و TOTP استفاده می‌کند. هیچ رمز، OTP یا TOTP secret به ChatGPT ارسال نمی‌شود. نقش، User ID، Session ID و زمان MFA از ورودی Client گرفته نمی‌شوند؛ تابع ابتدا JWT دقیق را از `/auth/v1/user` اعتبارسنجی می‌کند و سپس Claimهای معتبر آن را می‌خواند. JWT صادرشده برای OAuth بومی Supabase نمی‌تواند برای تصمیم Consent یا مدیریت اتصال استفاده شود.

دیتابیس مالک تراکنش‌ها، Consent، هش کدها/توکن‌ها و revocation است. جدول‌های `system_oauth` خصوصی، با RLS و بدون مجوز مستقیم حتی برای `service_role` هستند. فقط دو RPC صریح `oauth_operation` و `oauth_api` برای Edge service client مجوز اجرا دارند؛ کاربران عادی حتی با JWT معتبر نمی‌توانند RPC را اجرا کنند. این RPCها مرز مورداعتمادند و باید فقط پس از اعتبارسنجی HTTP/Auth فراخوانی شوند؛ service key هرگز در مرورگر نیست.

### Files added / modified

| وضعیت | فایل‌ها | کاربرد |
| --- | --- | --- |
| جدید | `.env.example`، `supabase/config.toml` | Placeholder تنظیمات و استثنای gateway فقط برای تابع OAuth |
| جدید | `supabase/functions/oauth-connector/index.ts`، `handler.ts` | ورود Deno و مرز HTTP/Auth استاندارد |
| جدید | `supabase/migrations/20261007_oauth_connector.sql` | Schema خصوصی، RPCها، audit، revocation trigger و cleanup |
| جدید | `js/oauth.js` | Consent، callback و برنامه‌های متصل با UI موجود |
| جدید | `docs/OAUTH.md`، `docs/chatgpt-openapi.yaml` | راهنمای اجرا/امنیت و schema GPT Actions |
| جدید | `tests/oauth-database.mjs`، `oauth-edge.mjs`، `oauth-integration.mjs` | چرخهٔ SQL، مرز HTTP و Handler→SQL واقعی |
| جدید | `tests/oauth-ui.mjs`، `oauth-browser.mjs` | تعامل Consent/Disconnect و Chromium |
| جدید | `tests/oauth-concurrency.mjs`، `auth-live.mjs` | رقابت PostgreSQL و Password/TOTP واقعی GoTrue |
| تغییر | `app.js`، `index.html`، `js/auth.js`، `styles-v7.css` | اتصال به ورود موجود، step-up، پاک‌کردن MFA، Consent، لینک اتصال و رفع overflow موبایل |
| تغییر | `tests/database-setup.mjs`، `fixtures.mjs`، `syntax.mjs` | Fixture metadata Auth و بررسی تمام Edge Functionها |
| تغییر | `tests/xlsx.mjs`، `browser.mjs` | منبع جایگزین ثابت و تأیید اصالت Excel، fixture برنامهٔ واقعی |
| تغییر | `package.json`، `.gitignore`، `README.md` | دستورهای تست، حفاظت فایل env و راهنمای استفاده |

### انتخاب Provider و Token

در مخزن Provider OAuth پیکربندی‌شده وجود نداشت. [OAuth بومی Supabase](https://supabase.com/docs/guides/auth/oauth-server) بررسی شد: scopeهای مستند `openid/email/profile/phone` دسترسی هویت OIDC را کنترل می‌کنند و به‌خودی‌خود مجوز API مدرسه نیستند. همچنین این قابلیت به سیاست سروری جلوگیری از صدور **کد** مدیر پیش از MFA تازه نیاز دارد؛ محافظت صرف صفحهٔ Consent کافی نیست. این افزونه سیاست کامل را پیش از ایجاد کد در SQL اجرا می‌کند، بدون ساخت Login، TOTP یا User موازی.

توکن‌ها opaque و دارای ۲۵۶ بیت تصادف از Web Crypto هستند؛ فقط SHA-256 آن‌ها ذخیره می‌شود. Secret کلاینت نیز تصادفی با همین entropy و فقط هش‌شده است. JWT جدید، کلید امضای جدید یا Claim مجوز ارسالی Client وجود ندارد. این انتخاب قطع فوری دسترسی را ساده می‌کند. این پیاده‌سازی OIDC نیست؛ ID Token، UserInfo OIDC، Discovery OIDC یا JWKS جدید ندارد. اطلاعات حداقلی حساب از `api/me` می‌آید.

## Authentication and MFA flow

1. ChatGPT درخواست را به `/oauth/authorize` می‌فرستد. سرور Client فعال، exact callback، `response_type=code`، scope، state و PKCE را بررسی می‌کند؛ URI نامعتبر هیچ Redirect خارجی ایجاد نمی‌کند.
2. Redirect به `OAUTH_SITE_URL` انجام می‌شود. Login، Session موجود، MFA و تغییر رمز اولیه همان مسیر فعلی سایت هستند. Session معتبر نیاز به Login دوباره ندارد.
3. صفحه، درخواست OAuth را از History پاک می‌کند و فقط در حافظهٔ همان Tab نگه می‌دارد. Reload نیازمند آغاز مجدد اتصال است.
4. `/oauth/prepare` با Bearer JWT معتبر و Origin مجاز، تراکنش ۱۰ دقیقه‌ای و nonce تصادفی یک‌بارمصرف متصل به User و Session می‌سازد.
5. مدیر باید AAL2 همراه AMR روش `totp` با زمان حداکثر ۱۰ دقیقه قبل داشته باشد. SQL علاوه بر JWT معتبر، Session موجود و تاریخ `not_after` را از `auth.sessions` و AAL2 و عامل TOTP تأییدشدهٔ همان کاربر را از `auth.mfa_factors` کنترل می‌کند؛ JWT قدیمی پس از حذف عامل یا downgrade نشست نمی‌تواند کد صادر کند. مقدار `mfa_verified` یا زمان Client پذیرفته نمی‌شود. عاملِ ثبت‌نشده با Enrollment موجود Supabase و QR/Setup Key و اولین OTP تأیید می‌شود. Context قدیمی باعث Challenge تازه است؛ بدون این کنترل، هیچ کد صادر نمی‌شود.
6. کاربر نام Client، حساب، نقش واقعی و scopeهای دقیق را می‌بیند و صریحاً اجازه می‌دهد یا لغو می‌کند. `/oauth/decision` دوباره Session، nonce، انقضا، حساب و MFA مدیر را بررسی می‌کند.
7. Callback ثبت‌شده با `code` یا `error=access_denied` و همان `state` دریافت می‌شود. کلاینت باید state تصادفی متعلق به تراکنش خود را مقایسه کند؛ سرور مقدار آن را حفظ می‌کند و فرم را با nonce جدا محافظت می‌کند.
8. Client کد را با احراز هویت خودش و در صورت نیاز PKCE تبدیل به Access/Refresh Token می‌کند. Plugin فقط این توکن‌ها را نگه می‌دارد.

Supabase مسئول حفاظت TOTP secret، بررسی OTP، challenge expiration، عامل تأییدشده و Auditهای Enrollment/Success/Failure است؛ جدول TOTP یا Recovery Code موازی ساخته نشده است. Supabase Recovery Codes بومی این مسیر را فراهم نمی‌کند؛ recovery مدیر باید از رویهٔ امن و ثبت‌شدهٔ Supabase/عملیات مدرسه انجام شود، نه bypass OAuth.

در Auth خودمیزبان، رمزنگاری بومی دیتابیس GoTrue را با `GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT` و کلیدهای `GOTRUE_SECURITY_DB_ENCRYPTION_*` نسخهٔ مستقر فعال و گردش/Backup کلیدها را مدیریت کنید؛ مقدار کلید فقط در Secret Store سرور باشد. تست Auth این تغییر رمزنگاری بومی TOTP را فعال و ciphertext را بررسی می‌کند. در Supabase میزبانی‌شده تنظیم و حفاظت این ذخیره‌سازی مسئولیت سرویس Auth است؛ این افزونه هیچ TOTP secret را دریافت یا در schema OAuth ذخیره نمی‌کند.

قفل Session با `FOR SHARE NOWAIT` از رقابت صدور کد با تغییر MFA و بن‌بست با ترتیب قفل بومی Auth جلوگیری می‌کند. هنگام درگیری کوتاه قفل، سرور بدون صدور کد پاسخ `temporarily_unavailable` با HTTP 503 می‌دهد؛ Client می‌تواند دوباره تلاش کند. توابع OAuth از isolation پیش‌فرض `READ COMMITTED` استفاده می‌کنند و isolation ناسازگار را رد می‌کنند. انقضا پس از انتظار قفل با `clock_timestamp()` بررسی می‌شود.

خطای Authorization پس از تأیید Client و callback ثبت‌شده، طبق RFC 6749 به همان callback با `error` و state معتبر برمی‌گردد. Client یا callback نامعتبر هیچ Redirect خارجی دریافت نمی‌کند.

## OAuth endpoints

همهٔ مسیرها زیر `https://PROJECT_REF.supabase.co/functions/v1/oauth-connector` هستند.

| روش / مسیر | کاربرد / حفاظت |
| --- | --- |
| `GET /oauth/authorize` | Client ثبت‌شده، callback دقیق، state الزامی، code flow؛ بدون Implicit |
| `POST /oauth/prepare` | JWT اصلی سایت + Origin مجاز؛ درخواست و nonce متصل به Session |
| `POST /oauth/decision` | همان Session + nonce؛ approve/deny و صدور کد |
| `POST /oauth/token` | فرم URL-encoded؛ `authorization_code` یا `refresh_token` |
| `POST /oauth/revoke` | فرم URL-encoded، Client معتبر؛ revoke کل Grant مربوط به token؛ توکن نامعلوم پاسخ موفق idempotent |
| `GET /api/me` | OAuth Bearer + `profile.read`؛ فقط `id` و `display_name` |
| `GET /api/classes` | OAuth Bearer + `classes.read` + `can_read_class` |
| `GET /api/grades` | OAuth Bearer + `grades.read` + مالکیت دانش‌آموز / تخصیص دقیق کلاس و درس دبیر / مدیر مجاز؛ کلید نمایش کارنامه حفظ می‌شود |
| `GET /api/assignments` | OAuth Bearer + `assignments.read` + مخاطب/عضویت گروه دانش‌آموز یا تخصیص فعلی دبیر و مالکیت تکلیف یا مدیر مجاز |
| `GET /account/connections` | JWT سایت + Origin؛ اتصال‌های همان کاربر |
| `POST /account/disconnect` | JWT سایت + Origin + `grant_id` متعلق به کاربر؛ همهٔ Grantهای همان User/Client لغو می‌شوند |
| `POST /account/admin/clients` | مدیر فعال، رمز تغییرکرده، TOTP تازه؛ ثبت Client |
| `POST /account/admin/clients/disable` | همان سیاست مدیر؛ غیرفعال‌سازی Client و تمام Grantها |
| `POST /account/admin/revoke` | همان سیاست مدیر؛ لغو Grant کاربر دیگر با `grant_id` |

فرم‌های Browser از Cookie برای احراز هویت استفاده نمی‌کنند. Authorization header صریح، JSON، Origin محدود و nonce یک‌بارمصرف Consent از درخواست Cross-site جلوگیری می‌کنند. `state` جایگزین این کنترل‌ها نیست. کاربر غیرفعال/رمز اولیه/ban نمی‌تواند کد، refresh یا اطلاعات API دریافت کند.

## Scopes and resource access

| Scope | دادهٔ خروجی |
| --- | --- |
| `profile.read` | نام نمایشی و شناسهٔ همان حساب؛ بدون کد ملی، email، Role یا Permissions |
| `classes.read` | شناسه/عنوان/پایه/سال کلاس‌های مجاز |
| `grades.read` | نمرهٔ تکوینی/پایانی/درس در منابع مجاز |
| `assignments.read` | عنوان، توضیح، کلاس/درس و مهلت تکلیف مجاز؛ بدون فایل یا جواب دیگران |

Scope صرفاً سقف اتصال است؛ نقش و مجوز به Token واگذار نشده‌اند. Scope write/admin تعریف نشده است. API امکان اجرای table/RPC دلخواه ندارد. Queryهای اختیاری `class_id`، `student_id`، `subject_id` UUID معتبر و `limit=1..100`، `offset=0..10000` هستند. فیلتر منبع نامجاز رد می‌شود؛ مجموعهٔ بدون فیلتر فقط منابع مجاز است. پاسخ لیست `{rows,offset,limit}` است.

RPC منبع با service boundary اجرا می‌شود، بنابراین نمی‌توان به RLS ضمنی service role تکیه کرد. ابتدا توکن/Grant/scope را بررسی می‌کند، Context داخلی را به شناسهٔ اثبات‌شدهٔ Grant محدود می‌کند، توابع مجوز موجود را اجرا می‌کند و برای هر Query شرط مالکیت صریح و projection محدود دارد. Context تراکنش پس از استفاده بازگردانده می‌شود. هیچ Role یا Permission ارسالی Plugin خوانده نمی‌شود.

## Token lifecycle and revoke

- Consent/request: ۱۰ دقیقه، nonce یک‌بارمصرف، متصل به User و Session.
- Authorization code: ۱۲۰ ثانیه؛ فقط یک بار، متصل به Grant/Client/callback/scope/PKCE؛ مصرف اتمی زیر row lock.
- Access token: ۱۵ دقیقه؛ وضعیت و مجوز فعلی در هر درخواست بررسی می‌شود.
- Refresh token: انقضای مطلق ۳۰ روز از Grant؛ rotation در هر استفاده، بدون تمدید سقف ۳۰ روز. Scope قابل کاهش است و افزایش رد می‌شود.
- استفادهٔ دوباره از refresh مصرف‌شده کل خانواده را لغو و Audit ثبت می‌کند؛ Client باید refresh را سریالی اجرا کند و پاسخ آخر را اتمی ذخیره کند.
- Disconnect از منوی «برنامه‌های متصل» یا «امنیت حساب» تمام Access/Refresh/Code و درخواست‌های معلق همان User/Client را فوراً غیرقابل استفاده می‌کند؛ درخواست در حال اجرا ممکن است قبل از تکمیل revoke تمام شود.
- تغییر role، active، پرچم/زمان تغییر رمز، hash رمز Auth یا ban/deletion اتصال‌ها را لغو می‌کند. تغییر تخصیص دبیر/عضویت و کلید نمایش کارنامه در همان درخواست بعدی اعمال می‌شود.
- Grant مدیر به شناسهٔ همان عامل TOTP تأییدشده متصل است. حذف عامل، کد صادرشده، Access Token و Refresh Token آن Grant را بی‌اعتبار می‌کند؛ ثبت عامل جدید اتصال قدیمی را احیا نمی‌کند و Consent تازه لازم است.
- برای اتصال دوباره پس از انقضا/لغو، Consent تازه لازم است. خروج عادی از سایت به‌تنهایی اتصال بلندمدت را قطع نمی‌کند؛ از Disconnect استفاده کنید.

Audit جدید فقط Event، شناسهٔ داخلی، Client و Scope را ثبت می‌کند؛ Password، state، code، token، hash token، client secret، OTP و TOTP secret وارد Audit نمی‌شوند. رویدادهای امنیتی `OAUTH_*` در Audit فعلی مدیر قابل مشاهده‌اند. نگه‌داری و cleanup دوره‌ای اطلاعات خصوصی در migration مستند شده است.

اگر `pg_cron` از قبل نصب باشد migration کار ساعتی cleanup را ثبت می‌کند. در غیر این صورت scheduler مورداعتماد باید `select public.oauth_cleanup();` را با نقش مالک دیتابیس یا service اجرا کند. این RPC برای `anon` و `authenticated` مجاز نیست. tombstoneهای refresh مصرف‌شده تا پایان مهلت خانواده حفظ می‌شوند تا cleanup تشخیص reuse را دور نزند؛ نگه‌داری Audit تابع سیاست موجود مدرسه است.

## Client registration / ChatGPT connection

ابتدا callback دقیق نمایش‌داده‌شده در GPT Builder/Connector را دریافت کنید؛ hostname یا path را حدس نزنید و wildcard ثبت نکنید. سپس مدیر با Session سایت و MFA تازه، درخواست JSON زیر را به `/account/admin/clients` بفرستد. Authorization header همان Session معتبر مدیر است؛ آن را در تاریخچهٔ shell، لاگ یا مخزن قرار ندهید.

```json
{
  "name": "ChatGPT",
  "redirect_uris": ["https://EXACT_CALLBACK_FROM_YOUR_CHATGPT_CONFIGURATION"],
  "allowed_scopes": ["profile.read", "classes.read", "grades.read", "assignments.read"],
  "public_client": false,
  "pkce_required": true
}
```

سرور `client_id` و برای confidential client، `client_secret` را فقط هنگام ایجاد برمی‌گرداند. Secret را در Secret Store و تنظیم امن ChatGPT قرار دهید؛ مقدار خام بعداً قابل بازیابی نیست. ثبت Client به Credential کاربر مدرسه نیاز ندارد. Client عمومی secret ندارد و PKCE S256 برای آن اجباری است. برای confidential client نیز پیش‌فرض PKCE اجباری است؛ فقط اگر Client واقعی، مانند برخی GPT Actions، PKCE ارسال نمی‌کند، مدیر می‌تواند هنگام ثبت `pkce_required=false` تنظیم کند. این استثنا برای Client عمومی قابل استفاده نیست و Client confidential همچنان باید Secret معتبر ارائه دهد. Plain PKCE پشتیبانی نمی‌شود.

در ChatGPT Authentication نوع OAuth را انتخاب کنید و Client ID/Secret، Authorization URL و Token URL جدول بالا را وارد کنید. Scopeها را به صورت space-separated و فقط مقدار لازم قرار دهید. احراز هویت Token هم `client_secret_basic` و هم `client_secret_post` پشتیبانی می‌شود؛ دو روش را هم‌زمان ارسال نکنید. schema API در `docs/chatgpt-openapi.yaml` قرار دارد؛ placeholder سرور را با پروژهٔ مستقر جایگزین کنید. این فایل فقط API خواندن را معرفی می‌کند. برای یک MCP Connector لازم است لایهٔ MCP مستقل مطابق نیاز Client اضافه شود؛ این تغییر API مناسب GPT Actions/Plugin OAuth فراهم می‌کند و ادعای MCP server ندارد.

## Local development and migrations

```bash
cd /workspace/system
npm ci --cache /tmp/system-npm-cache --no-audit --no-fund
npm run check
npm test
python3 -m http.server 8080 --bind 127.0.0.1
```

این task محیط ایزوله و checkout موجود دارد؛ بدون درخواست صریح worktree نسازید. frontend build ندارد. آزمون‌های DB روی PostgreSQL آزمایشی واقعی PGlite هستند و Supabase تولید را لمس نمی‌کنند. آزمون‌های HTTP/UI که Auth mock دارند صریحاً همین محدودیت را گزارش می‌کنند. تست Auth زندهٔ opt-in با GoTrue محلی جداست.

بررسی‌های تکمیلی:

```bash
npm run test:xlsx
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:oauth:browser
npm run test:oauth:concurrency
npm run test:auth:live
DENO_DIR=/tmp/system-deno-cache XDG_CACHE_HOME=/tmp/system-deno-cache npm exec --cache /tmp/system-npm-cache --yes --package=deno@2.9.6 -- deno check supabase/functions/oauth-connector/index.ts
```

دو تست آخر npm به Docker محلی نیاز دارند؛ فقط کانتینرهای آزمایشی متعلق به همان اجرا را ایجاد/پاک می‌کنند. تست هم‌زمانی اتصال‌های جدا به PostgreSQL واقعی دارد. تست Auth از تصویر رسمی و pinned GoTrue برای Password و TOTP واقعی استفاده می‌کند؛ production handler به PostgreSQL آزمایشی PGlite متصل است و فقط metadata واقعی Session/Factor، بدون MFA secret، برای کنترل SQL منتقل می‌شود. این تست جایگزین آزمون GPT Client مستقر نیست. تست Browser OAuth پاسخ HTTP/Auth آزمایشی دارد؛ تست Browser اصلی نیز پروژهٔ Supabase واقعی را مسدود می‌کند.

تست Excel فایل SheetJS 0.20.3 را از `cdn.jsdelivr.net` با SHA-256 ثابت `cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41` دریافت می‌کند؛ این bytes با CDN رسمی و tag رسمی `v0.20.3` در `git.sheetjs.com` تطبیق داده شدند. Cache و override هم پیش از اجرا بررسی می‌شوند. TLS و نسخهٔ کتابخانه تغییر نکرده‌اند.

### نتیجهٔ اعتبارسنجی این تغییر — ۲۰۲۶-۱۰-۰۸

| بررسی | نتیجه |
| --- | --- |
| `npm test` | Migrationهای قدیمی و تست واحد موفق؛ ۶۳ DB امنیت، ۹ مرز امنیت حساب، ۷۳ UI موجود، ۴۲ DB OAuth، ۱۰۳ مرز HTTP OAuth، ۲۶ HTTP+SQL و ۱۹ تعامل UI OAuth موفق |
| PostgreSQL با اتصال‌های هم‌زمان واقعی | ۲۶ سناریو موفق؛ single-use، rotation/reuse، Consent/Disconnect، تغییر سیاست، انقضا پس از قفل، cleanup و ترتیب قفل MFA بومی |
| GoTrue واقعی محلی | ۱۸ سناریو موفق؛ رمز صحیح/غلط، ban، Enrollment، OTP صحیح/غلط، Session موجود، ثبت Client مدیر، PKCE، refresh، Disconnect، JWT قدیمی پس از حذف عامل و Logout |
| Chromium اصلی / OAuth | ۵۶ / ۵ بررسی موفق؛ دسکتاپ، موبایل RTL، Consent، deny، قطع اتصال، PDF و Excel |
| Excel با منبع جایگزین | ساخت/بازخوانی فایل واقعی، فارسی، RTL، صفر عددی و کد ملی رشته‌ای موفق |
| Syntax / Deno type check / whitespace | موفق؛ frontend مرحلهٔ build مستقل ندارد |
| OpenAPI | YAML و ۴ operation خواندن، scopeها و تمام referenceهای داخلی بررسی شدند |

هیچ migration، deploy، حساب یا Client واقعی روی Supabase تولید/ChatGPT در این اعتبارسنجی ایجاد نشد. تصویر رسمی GoTrue و PostgreSQL محلی با digest ثابت استفاده شدند و منابع Docker متعلق به تست پاک شدند. باقی‌ماندهٔ پذیرش انتشار، آزمون Client واقعی با callback و تنظیمات استقرار است.

روی دیتابیس v7 موجود فقط `supabase/migrations/20261007_oauth_connector.sql` را بعد از چهار migration نسخهٔ ۷ اجرا کنید. Schema و migrationهای قدیمی را دوباره اجرا نکنید. ابتدا Backup و Staging؛ هیچ migration تولید در این کار اجرا نشده است. migration جدید transaction دارد و جدول قدیمی را بازسازی/حذف نمی‌کند. تغییر امنیتی Auth/Profile trigger و service-only RPCها را در staging بررسی کنید. این migration یک‌بار اجرا می‌شود، اجرای دوبارهٔ آن روش upgrade نیست.

برای Edge Functions، `.env.example` فقط placeholder دارد. فایل واقعی `.env` ignored است و باید خارج از Git، با دسترسی محدود نگه‌داری شود. `supabase functions serve oauth-connector --no-verify-jwt --env-file PATH_TO_LOCAL_ENV` در محیط Supabase محلی؛ برای localhost فقط `OAUTH_ALLOW_LOCAL_HTTP=true` و Client callback محلی دقیق مجاز است. frontend هم config عمومی همان پروژهٔ آزمایشی را لازم دارد؛ service key هرگز در `config.js` قرار نمی‌گیرد.

## Production configuration required

1. Backup و اجرای migration جدید روی Staging و سپس پروژهٔ موردنظر با نقش مالک دیتابیس.
2. `SUPABASE_URL` و کلید public و service در Edge runtime موجود باشند؛ در Supabase میزبانی‌شده این مقدارها معمولاً از runtime فراهم می‌شوند و لازم نیست Secret رزروشده با پیشوند `SUPABASE_` دوباره ثبت شود. متغیرهای modern `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` JSON هم پشتیبانی می‌شوند. URL و public key همان پروژه در config عمومی سایت مجازند؛ service key هیچ‌گاه در Git/ChatGPT/Browser نباشد. فقط متغیرهای سفارشی `OAUTH_*` را برای تابع پیکربندی کنید؛ `.env.example` فایل placeholder محیط محلی است و نباید بدون جایگزینی مقدارها به تولید ارسال شود.
3. `OAUTH_SITE_URL` آدرس کامل HTTPS صفحهٔ اصلی واقعی، بدون Query/Fragment؛ `OAUTH_ALLOWED_ORIGINS` فهرست Originهای HTTPS دقیق با کاما و بدون path، wildcard یا slash آخر. `OAUTH_ALLOW_LOCAL_HTTP=false`.
4. استقرار تابع با `supabase functions deploy oauth-connector --no-verify-jwt`؛ این gateway exception فقط تابع جدید را پوشش می‌دهد. خود تابع JWT سایت و opaque token را مستقل بررسی می‌کند. `admin-user` و `account-security` فعلی همچنان مستقر باشند.
5. انتشار فایل‌های frontend و تنظیم Client/callback/secret امن ChatGPT. حساب مدیر MFA موجود را تکمیل کند. Rate limit ورود و MFA را در تنظیمات Supabase Auth فعال/بررسی کنید؛ Endpointهای جدید محدودسازی مشترک دیتابیس و User/Client/Token دارند. محدودسازی لبهٔ شبکه نیز برای حملهٔ حجمی مناسب است.
6. HTTPS و Headerهای سایت روی میزبان دارای Header control: `X-Content-Type-Options: nosniff`، `Referrer-Policy: no-referrer`، `Content-Security-Policy` با `frame-ancestors 'none'` و sourceهای دقیق موردنیاز. CSP باید CDN SDK، فونت، SheetJS و اتصال پروژه Supabase فعلی را لحاظ کند؛ `default-src *` نسازید. GitHub Pages تنظیم Header سفارشی فراهم نمی‌کند؛ برای حفاظت صفحهٔ Consent/MFA از clickjacking از میزبان/Reverse Proxy مناسب استفاده کنید. meta CSP جایگزین frame-ancestors نیست.
7. Session سایت فعلی SDK/localStorage است؛ flags Cookie در این برنامه وجود ندارد. در صورت انتقال به SSR/cookie در آینده Secure/HttpOnly/SameSite و CSRF فرم لازم‌اند. Session JWT و refresh سایت را در URL یا log نگذارید.
8. نرخ/اندازهٔ Audit و جدول‌های OAuth را پایش و cleanup مقرر را زمان‌بندی کنید. raw headers/body توکن‌ها را در gateway/proxy و telemetry ثبت نکنید. Source و Token را در Error Monitoring redaction کنید.
9. تست end-to-end واقعی دانش‌آموز، دبیر، مدیر، Session قبلی، deny، refresh و Disconnect با ChatGPT و Supabase آزمایشی اجرا شود؛ callback/client registration و سرویس تولید در این task ایجاد نشده‌اند.

## Security concerns already present

RLS جدول classes برای کاربران آماده گسترده است؛ API جدید شرط `can_read_class` را اضافه می‌کند. خواندن برخی تکلیف‌های قدیمی به `teacher_id` تاریخی تکیه می‌کند؛ API جدید تخصیص فعلی را کنترل می‌کند. API فعلی پروفایل ممکن است کد ملی داشته باشد؛ API جدید آن را حذف می‌کند. توابع قدیمی CORS `*` دارند و SDK مرورگر CDN major-version بدون pin/SRI است؛ این تغییر CORS تابع جدید را محدود می‌کند، ولی hardening کل پروژه موضوع جداگانه است. localStorage در برابر XSS آسیب‌پذیر است؛ CSP، pin SDK و بررسی افزونه‌های third-party قبل از انتشار امنیتی توصیه می‌شود.

این OAuth-compatible provider اختصاصی، اگرچه با تست‌های تراکنشی/امنیتی پوشش داده شده، گواهی conformance یا audit بیرونی OAuth ندارد. پیش از عرضهٔ عمومی دادهٔ آموزشی حساس، بازبینی امنیتی مستقل و آزمون Client واقعی لازم است. محدودیت‌های آزمون شبکه و نتیجهٔ هر suite در گزارش کار به‌صورت جدا ارائه می‌شوند.
