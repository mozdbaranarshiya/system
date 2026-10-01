import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) throw new Error("UNAUTHORIZED");

    // نقش کاربر واردشده را با همان JWT کاربر بررسی می‌کنیم.
    // این کار باعث می‌شود بررسی نقش دقیقاً مطابق RLS و نشست جاری باشد.
    const { data: callerProfile, error: profileError } = await caller
      .from("profiles")
      .select("role, active")
      .eq("id", authData.user.id)
      .single();

    if (profileError) {
      console.error("PROFILE_LOOKUP_FAILED", profileError);
      throw new Error(`PROFILE_LOOKUP_FAILED: ${profileError.message}`);
    }
    if (!callerProfile?.active) throw new Error("USER_INACTIVE");
    if (callerProfile.role !== "manager") throw new Error("MANAGER_ONLY");

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "create") {
      const nationalId = String(body.national_id || "").trim();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "");
      if (!/^\d{10}$/.test(nationalId)) throw new Error("INVALID_NATIONAL_ID");
      if (!fullName || !["teacher","student"].includes(role)) throw new Error("INVALID_DATA");

      const { data, error } = await admin.auth.admin.createUser({
        email: `${nationalId}@school.local`,
        password: nationalId,
        email_confirm: true,
        user_metadata: { full_name: fullName, national_id: nationalId, role },
      });
      if (error) throw error;

      const { error: insertError } = await admin.from("profiles").insert({
        id: data.user.id, national_id: nationalId, full_name: fullName, role, active: true,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw insertError;
      }
      return json({ ok: true, user_id: data.user.id });
    }

    if (action === "update") {
      const userId = String(body.user_id || "");
      const nationalId = String(body.national_id || "").trim();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "");
      const password = body.password ? String(body.password) : undefined;
      if (!userId || !/^\d{10}$/.test(nationalId) || !fullName || !["teacher","student"].includes(role)) {
        throw new Error("INVALID_DATA");
      }

      const attrs: Record<string, unknown> = {
        email: `${nationalId}@school.local`,
        user_metadata: { full_name: fullName, national_id: nationalId, role },
      };
      if (password) attrs.password = password;

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, attrs);
      if (authUpdateError) throw authUpdateError;

      const { error: updateError } = await admin.from("profiles").update({
        national_id: nationalId, full_name: fullName, role,
      }).eq("id", userId);
      if (updateError) throw updateError;

      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.user_id || "");
      if (!userId) throw new Error("INVALID_DATA");
      if (userId === authData.user.id) throw new Error("CANNOT_DELETE_SELF");
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return json({ ok: true });
    }

    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
