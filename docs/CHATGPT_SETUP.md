# فعال‌سازی اتصال مدرسه در ChatGPT

این استقرار با **GPT Actions** و OAuth کار می‌کند. Backend روی `pukanizbahswrupscfmg` آماده است. مالک شروع مدرسهٔ جدید بدون انتقال داده‌های پروژهٔ قبلی را انتخاب کرده است. انتشار سایت و فعال‌سازی واقعی پس از آماده‌شدن مدیر نخست انجام می‌شود؛ وجود Endpoint به‌تنهایی حساب و Client نمی‌سازد.

## مدیر نخست

نام واقعی و کد ملی ۱۰ رقمی مدیر برای پروفایل مدرسه لازم است. رمز را در چت، GitHub یا ابزار توسعه ارسال نکنید. مالک در [Supabase Authentication](https://supabase.com/dashboard/project/pukanizbahswrupscfmg/auth/users) گزینهٔ **Add user → Create user** را انتخاب کند، ایمیل `کدملی@school.local` و رمز قوی انتخابی خودش را وارد و **Auto Confirm** را فعال کند. این باید حساب تازهٔ مدرسه باشد؛ حساب قبلی سرویس آزمون را به مدیر تبدیل نکنید.

پروفایل `school.profiles` باید با UUID همین حساب و نام/کد ملی واقعی، `role=manager`، `active=true` و `must_change_password=true` ساخته شود. اولین ورود به سایت شامل Enrollment و تأیید TOTP و سپس تغییر رمز اولیه است. تا تکمیل MFA و تغییر رمز، Client یا کد OAuth صادر نمی‌شود. روش فعلی تغییر رمز، رمز فعلی را بررسی می‌کند؛ لینک Recovery بدون مسیر تنظیم رمز جایگزین ساخت حساب اولیه نیست.

## تنظیم GPT Actions

1. در ChatGPT، **Create a GPT → Configure → Actions → Create new action** را باز کنید.
2. فایل [chatgpt-openapi.yaml](chatgpt-openapi.yaml) را کپی یا از URL خام شاخهٔ منتشرشده Import کنید. URLهای این فایل برای همین مقصد آماده‌اند.
3. **Authentication → OAuth** را انتخاب کنید. Callback URL دقیق نمایش‌داده‌شده توسط GPT Builder را کپی کنید؛ برای هر GPT ممکن است متفاوت باشد.
4. مدیر در سایت منتشرشده، **برنامه‌های متصل → ثبت برنامه برای اتصال ChatGPT** را باز کند. همان callback را دقیق ثبت کند و فقط Scopeهای لازم را انتخاب کند. پیش‌فرض اطلاعات پایهٔ حساب است. Client باید confidential باشد. اگر GPT Actions شما PKCE ارسال نمی‌کند، الزام PKCE را برای همین Client غیرفعال کنید؛ برای Client عمومی S256 اجباری است.
5. `Client ID` و `Client Secret` یک‌بار نمایش داده می‌شوند. آن‌ها را در تنظیم OAuth خود GPT قرار دهید؛ رمز حساب مدرسه یا کد TOTP را در ChatGPT وارد نکنید. درخواست ثبت Client و Consent باید TOTP تازهٔ مدیر را داشته باشد.

| تنظیم | مقدار |
| --- | --- |
| Authorization URL | `https://pukanizbahswrupscfmg.supabase.co/functions/v1/oauth-connector/oauth/authorize` |
| Token URL | `https://pukanizbahswrupscfmg.supabase.co/functions/v1/oauth-connector/oauth/token` |
| Refresh | همان Token URL با `grant_type=refresh_token` |
| Token exchange | POST؛ `client_secret_post` یا `client_secret_basic`، فقط یکی |
| Scope حداقلی | `profile.read` |
| Scopeهای اختیاری | `classes.read grades.read assignments.read`، فقط موارد ثبت‌شده برای Client |

6. تنظیم GPT را ذخیره کنید و یک Action را آزمایش کنید. گزینهٔ **Sign in / Connect** کاربر را به سایت مدرسه می‌برد. کاربر با ورود یا Session فعلی، MFA در صورت نیاز و Consent صریح برمی‌گردد. ChatGPT فقط Token اتصال را دریافت می‌کند.
7. با حساب واقعی دانش‌آموز، دبیر و مدیر بررسی کنید که منابع دیگران قابل‌مشاهده نیستند. نبود کلاس یا نمره در مدرسهٔ تازه، خروجی خالی معتبر دارد؛ دادهٔ نمایشی ساخته نمی‌شود.

Callback، ثبت Client و MFA به تنظیمات و حساب واقعی مالک وابسته‌اند؛ آدرس callback فرضی یا wildcard اتصال را کامل نمی‌کند. Client Secret را فقط در تنظیمات امن GPT نگه دارید.

## قطع اتصال

کاربر در سایت **برنامه‌های متصل → قطع اتصال** را انتخاب کند. Access Token، Refresh Token، کدها و درخواست‌های معلق همان اتصال باطل می‌شوند. برای اتصال دوباره، Consent تازه لازم است. مدیر با مجوز داخلی و MFA تازه نیز می‌تواند Client یا اتصال مجاز را لغو کند.

جزئیات سیاست‌ها و تست‌ها در [OAUTH.md](OAUTH.md) و وضعیت استقرار در [MIGRATION.md](MIGRATION.md) آمده‌اند.
