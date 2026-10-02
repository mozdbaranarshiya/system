import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function readPublishableKey(): string {
  const modern = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
      const first = Object.values(parsed || {})[0];
      if (first) return String(first);
    } catch (_) {}
  }
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  throw new Error("MISSING_PUBLISHABLE_KEY");
}

function textError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch (_) { return String(error); }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("MISSING_SUPABASE_URL");

    const publishableKey = readPublishableKey();
    const authorization = req.headers.get("Authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new Error("UNAUTHORIZED");

    const client = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userData, error: userError } = await client.auth.getUser(accessToken);
    if (userError || !userData?.user) throw new Error("UNAUTHORIZED");

    const body = await req.json();
    const newPassword = String(body.new_password || "");
    if (newPassword.length < 8) throw new Error("PASSWORD_TOO_SHORT");

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("national_id,active")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !profile) throw new Error("PROFILE_NOT_FOUND");
    if (!profile.active) throw new Error("USER_INACTIVE");
    if (newPassword === profile.national_id) throw new Error("PASSWORD_SAME_AS_NATIONAL_ID");

    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/,"")}/auth/v1/user`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: newPassword }),
    });

    if (!authResponse.ok) {
      const raw = await authResponse.text();
      console.error("AUTH_PASSWORD_UPDATE_FAILED", raw);
      throw new Error("PASSWORD_UPDATE_FAILED");
    }

    const { data: completedAt, error: completeError } =
      await client.rpc("complete_password_change");

    if (completeError) {
      throw new Error(completeError.message || "PASSWORD_COMPLETION_FAILED");
    }

    return json({ ok: true, password_changed_at: completedAt });
  } catch (error) {
    const message = textError(error);
    console.error("CHANGE_PASSWORD_ERROR", message);
    return json({ ok: false, error: message }, 200);
  }
});
