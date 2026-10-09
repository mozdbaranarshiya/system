// تنظیم اتصال فرانت‌اند GitHub Pages به Supabase.
// Publishable key برای استفاده در مرورگر طراحی شده است.
// هرگز Secret / Service Role Key را در این فایل قرار ندهید.
window.APP_CONFIG = {
  SUPABASE_URL: "https://efibfevyiepkwpnobaro.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_zbEGYX6DGhjFRQf6FWiIWQ_IdYj84nW",
  // Must remain false until JWT claims and Auth email mapping no longer expose national IDs.
  CHATGPT_OAUTH_PRIVACY_SAFE: false,
  CHATGPT_OAUTH_CLIENT_ID: "SET_REGISTERED_CHATGPT_CLIENT_ID",
  SCHOOL_NAME: "سامانه آموزش و پرورش استان اصفهان"
};
