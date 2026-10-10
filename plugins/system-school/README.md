# افزونهٔ اتصال سامانهٔ مدرسه

این بسته، **Plugin راه‌اندازی و Integration** با ساختار نمونه‌های رسمی OpenAI است: `.codex-plugin/plugin.json` و Skill همراه آن. Helper واقعی Python فقط چهار API خواندن OAuth پروژهٔ مدرسه را فراخوانی می‌کند. هیچ دادهٔ نمایشی یا حساب مشترک مدیر در بسته وجود ندارد.

**پذیرش ZIP در ChatGPT → Plugins → Upload plugin هنوز آزمایش نشده است.** این بسته MCP Server، شناسهٔ App ثبت‌شده یا تنظیم خودکار OAuth پلتفرم ندارد. Upload موفق، به‌تنهایی ورود، صدور Token یا اجرای Helper را فراهم نمی‌کند. مسیر رسمی GPT Actions نیز جداگانه در [راهنمای اتصال](references/CHATGPT_SETUP.md) و [OpenAPI](references/chatgpt-openapi.yaml) آمده است.

## وضعیت اتصال واقعی

پروژهٔ مقصد همان Backend فعلی مدرسه، `efibfevyiepkwpnobaro` است. هنگام آماده‌سازی این بسته، اجرای SQL OAuth روی این پروژه، استقرار تابع جدید و انتشار شاخه روی سایت هنوز پذیرش نهایی نداشتند. بستهٔ افزونه SQL نصب‌کننده یا ابزار تغییر Production اجرا نمی‌کند. مالک باید طبق مستندات Repository این پیش‌نیازها را تکمیل و صحت استقرار را بررسی کند.

کاربر فقط روی دامنهٔ خود مدرسه Login، MFA و Consent انجام می‌دهد. ChatGPT نباید Password، OTP، MFA Secret یا Session JWT سایت را دریافت کند. ثبت Client از حساب مدیر موجود و MFA تازه انجام می‌شود؛ callback باید دقیقاً همان آدرس تولیدشده توسط پلتفرم باشد. Client Secret فقط در تنظیم امن OAuth پلتفرم قرار می‌گیرد، نه در ZIP، GitHub یا چت.

## پیش‌نیاز اجرای Helper

Runtime باید **صریحاً** این سه قابلیت را فراهم کند:

1. اجرای Python 3.10+ برای Helper همراه بسته.
2. HTTPS به `https://efibfevyiepkwpnobaro.supabase.co`.
3. اتصال OAuth پلتفرم و تزریق امن Access Token کاربر فعلی به متغیر `SYSTEM_SCHOOL_ACCESS_TOKEN`، بدون نمایش مقدار به مدل.

Manifest حاضر هیچ قرارداد فرضی برای تزریق Token تعریف نمی‌کند. پشتیبانی این binding در Upload surface فعلی تأیید نشده است. اگر Runtime آن را فراهم نکند، افزونه باید فقط راهنمای راه‌اندازی بدهد و درخواست دادهٔ احراز‌شده را متوقف کند؛ Token را از کاربر در چت نخواهد خواست. این بسته broker برای Token Exchange، Refresh، نگهداری Secret یا شروع خودکار Connect ندارد.

## استفاده پس از اتصال پشتیبانی‌شده

از پوشهٔ بسته، بدون درج هیچ Credential در دستور:

```bash
python3 skills/system-school/scripts/school_api.py me
python3 skills/system-school/scripts/school_api.py classes --limit 50
python3 skills/system-school/scripts/school_api.py grades --limit 50
python3 skills/system-school/scripts/school_api.py assignments --limit 50
```

`--class-id` و `--student-id` UUID می‌پذیرند. `--subject-id` فقط برای grades و assignments است. Pagination محدود به `limit=1..100` و `offset=0..10000` است. فقط GET به Origin و چهار Path ثابت مجاز است. Redirect رد می‌شود، TLS بررسی می‌شود، پاسخ حداکثر ۱ MiB است و خطاها Body، Header، Credential یا متن Exception را نمایش نمی‌دهند. Helper فقط فیلدهای تعریف‌شده در OpenAPI را برمی‌گرداند؛ نقش و Permission ارسالی Client مجوزی ایجاد نمی‌کند.

Scope حداقل `profile.read` است؛ خواندن کلاس، نمره یا تکلیف به‌ترتیب `classes.read`، `grades.read` و `assignments.read` لازم دارد. Backend هم‌زمان Scope، Permission داخلی فعلی و دسترسی به همان Resource را کنترل می‌کند. هیچ API نوشتن، تغییر نمره، مدیریت Client یا عملیات مدیریتی از Helper در دسترس نیست.

برای قطع اتصال، کاربر در سایت «برنامه‌های متصل → قطع اتصال» را انتخاب کند. Token منقضی/لغوشده به اتصال دوباره با OAuth پشتیبانی‌شده نیاز دارد؛ Helper خود Refresh یا Revoke نمی‌کند.

## منابع قالب و تفاوت پلتفرم‌ها

- [نمونه‌های رسمی Plugin و ساختار `.codex-plugin`](https://github.com/openai/plugins/blob/main/README.md)
- [نمونهٔ رسمی Minimal Plugin](https://github.com/openai/plugins/blob/main/plugins/plugin-eval/fixtures/minimal-plugin/.codex-plugin/plugin.json)
- [GPT Actions: Schema در Actions](https://github.com/openai/openai-cookbook/blob/main/examples/chatgpt/gpt_actions_library/gpt_action_github.md)
- [GPT Actions: OAuth و Callback تولیدشده](https://github.com/openai/openai-cookbook/blob/main/examples/chatgpt/gpt_actions_library/gpt_action_google_drive.ipynb)
- [ChatGPT Apps: اتصال به MCP Server واقعی](https://github.com/openai/openai-apps-sdk-examples/blob/main/README.md)

قالب پوشه از نمونهٔ رسمی گرفته شده؛ پذیرش UI مقصد و تزریق OAuth نیازمند آزمون واقعی پلتفرم‌اند. در مسیر sharing فعلی Codex، آرشیو رسمی ابزار `.tar.gz` است؛ ZIP این Repository را نباید بدون آزمون مقصد معادل آن دانست. هیچ `.mcp.json` با URL اشتباه REST یا `.app.json` با App ID ساختگی در این بسته نیست.
