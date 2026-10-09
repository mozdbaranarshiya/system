// Password login adapter: users still type their national ID only on the school's own page.
// Auth emails are opaque, never derived from national IDs. Deploy with --no-verify-jwt.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function readKey(modern: string, legacy: string): string {
  const raw = Deno.env.get(modern);
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      const value = keys.default || Object.values(keys)[0];
      if (typeof value === "string" && value) return value;
    } catch { /* use legacy */ }
  }
  const key = Deno.env.get(legacy);
  if (!key) throw new Error("MISSING_CONFIGURATION");
  return key;
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const allowed = Deno.env.get("SCHOOL_LOGIN_ORIGIN") || "";
  const permitted = Boolean(allowed && origin === allowed && allowed.startsWith("https://"));
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Origin": permitted ? origin : "null",
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });
  if (!permitted) return reply(403, { error: "access_denied" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (Number(req.headers.get("Content-Length") || 0) > 2048)
    return reply(413, { error: "invalid_credentials" });
  try {
    const { national_id, password } = await req.json();
    if (typeof national_id !== "string" || !/^[0-9]{10}$/.test(national_id) ||
        typeof password !== "string" || password.length < 1 || password.length > 256)
      return reply(401, { error: "invalid_credentials" });
    const url = Deno.env.get("SUPABASE_URL");
    if (!url) return reply(503, { error: "unavailable" });
    const admin = createClient(url, readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: lookupError } = await admin.from("profiles")
      .select("id,active").eq("national_id", national_id).maybeSingle();
    if (lookupError) return reply(503, { error: "unavailable" });
    if (!profile?.active) return reply(401, { error: "invalid_credentials" });
    const { data: authRecord, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError || !authRecord?.user?.email)
      return reply(401, { error: "invalid_credentials" });
    const verifier = createClient(url, readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
      email: authRecord.user.email, password,
    });
    if (verifyError || verified?.user?.id !== profile.id || !verified.session?.access_token ||
        !verified.session?.refresh_token)
      return reply(401, { error: "invalid_credentials" });
    return reply(200, {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    });
  } catch {
    return reply(401, { error: "invalid_credentials" });
  }
});
