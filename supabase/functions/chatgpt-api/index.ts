// Read-only OAuth resource server for a single registered ChatGPT client.
// Supabase Auth handles Authorization Code + PKCE, sessions, refresh and revoke.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function envKey(modern: string, legacy: string): string {
  const raw = Deno.env.get(modern);
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      const key = keys.default || Object.values(keys)[0];
      if (typeof key === "string" && key) return key;
    } catch { /* fallback below */ }
  }
  const key = Deno.env.get(legacy);
  if (!key) throw new Error("MISSING_CONFIGURATION");
  return key;
}
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: HEADERS });

type AccessClaims = {
  sub?: string; client_id?: string; iss?: string; iat?: number;
  exp?: number; aal?: string; aud?: string | string[]; email?: string;
};
function decodeClaims(token: string): AccessClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("INVALID_TOKEN");
  const base = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base.padEnd(Math.ceil(base.length / 4) * 4, "=")));
}
function targetAction(path: string): "me" | "classes" | null {
  if (path.endsWith("/chatgpt-api/me")) return "me";
  if (path.endsWith("/chatgpt-api/my/classes")) return "classes";
  return null;
}
Deno.serve(async (request) => {
  if (request.method !== "GET") return json(405, { error: "method_not_allowed" });
  const action = targetAction(new URL(request.url).pathname);
  if (!action) return json(404, { error: "not_found" });
  const bearer = /^Bearer (\S+)$/i.exec(request.headers.get("Authorization") || "");
  if (!bearer) return json(401, { error: "unauthorized" });
  try {
    const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
    const clientId = Deno.env.get("CHATGPT_OAUTH_CLIENT_ID");
    const audience = Deno.env.get("CHATGPT_RESOURCE_AUDIENCE");
    if (!url || !clientId || !audience ||
        audience !== url + "/functions/v1/chatgpt-mcp" ||
        Deno.env.get("CHATGPT_OAUTH_PRIVACY_SAFE") !== "true")
      return json(503, { error: "not_configured" });

    // Unverified JWT payload is used ONLY as an additional restriction;
    // the authoritative user identity comes from a live Supabase Auth check.
    const claims = decodeClaims(bearer[1]);
    const now = Math.floor(Date.now() / 1000);
    if (claims.client_id !== clientId || claims.iss !== url + "/auth/v1"
      || claims.aud !== audience ||
      (typeof claims.email === "string" && /[0-9]{10}@school\.local/i.test(claims.email))
      || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
      || claims.iat! > now + 60 || claims.exp! <= now) {
      return json(401, { error: "unauthorized" });
    }
    const publicKey = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const caller = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(bearer[1]);
    if (authError || !authData?.user || claims.sub !== authData.user.id)
      return json(401, { error: "unauthorized" });
    const admin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Always check a current, revocable grant. This closes access immediately
    // after Disconnect, even for not-yet-expired JWTs.
    const [{ data: app, error: appError }, { data: profile, error: profileError }] =
      await Promise.all([
        admin.from("oauth_connected_apps").select("scopes,authorized_at,revoked_at")
          .eq("user_id", authData.user.id).eq("client_id", clientId).maybeSingle(),
        admin.from("profiles").select("id,full_name,role,active,must_change_password")
          .eq("id", authData.user.id).single(),
      ]);
    if (appError || profileError) return json(503, { error: "service_unavailable" });
    if (!app || app.revoked_at || Date.parse(app.authorized_at) > claims.iat! * 1000 + 1000
      || !profile?.active || profile.must_change_password) {
      return json(403, { error: "access_denied" });
    }
    if (profile.role === "manager" && claims.aal !== "aal2")
      return json(403, { error: "mfa_required" });

    const requiredScope = action === "me" ? "profile.read" : "classes.read";
    if (!Array.isArray(app.scopes) || !app.scopes.includes(requiredScope))
      return json(403, { error: "insufficient_scope" });

    if (action === "me") {
      return json(200, { id: profile.id, display_name: profile.full_name });
    }

    let allowedIds: string[] | null = null;
    if (profile.role === "teacher" || profile.role === "student") {
      const table = profile.role === "teacher" ? "teacher_assignments" : "class_students";
      const column = profile.role === "teacher" ? "teacher_id" : "student_id";
      const { data: links, error } = await admin.from(table).select("class_id")
        .eq(column, profile.id).limit(500);
      if (error) return json(503, { error: "service_unavailable" });
      allowedIds = [...new Set((links || []).map((link: {class_id: string}) => link.class_id))];
    } else if (profile.role !== "manager") {
      return json(403, { error: "access_denied" });
    }
    if (allowedIds !== null && !allowedIds.length) return json(200, { classes: [] });
    let query = admin.from("classes").select("id,title,academic_year")
      .order("title").limit(100);
    if (allowedIds !== null) query = query.in("id", allowedIds);
    const { data: classes, error: classError } = await query;
    if (classError) return json(503, { error: "service_unavailable" });
    return json(200, { classes: classes || [] });
  } catch {
    // Do not return token, database, or auth implementation details.
    return json(401, { error: "unauthorized" });
  }
});
