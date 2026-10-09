import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function readKey(newEnvName: string, legacyEnvName: string): string {
  const modern = Deno.env.get(newEnvName);
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
      const first = Object.values(parsed || {})[0];
      if (first) return String(first);
    } catch (_) {
      // Ignore and fall back to legacy variable.
    }
  }

  const legacy = Deno.env.get(legacyEnvName);
  if (legacy) return legacy;

  throw new Error(`MISSING_ENV_KEY: ${newEnvName}/${legacyEnvName}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const parts = [
      e.message,
      e.error_description,
      e.msg,
      e.code,
      e.status,
      e.name,
    ].filter(Boolean).map(String);

    if (parts.length) return parts.join(" | ");

    try {
      return JSON.stringify(error);
    } catch (_) {
      return "UNKNOWN_OBJECT_ERROR";
    }
  }

  return String(error);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // We intentionally return HTTP 200 for application errors so the browser
  // receives the actual error text instead of a generic FunctionsHttpError.
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("MISSING_SUPABASE_URL");

    const publishableKey = readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secretKey = readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("UNAUTHORIZED: missing user token");

    const caller = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const admin = createClient(supabaseUrl, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData?.user) {
      throw new Error(`UNAUTHORIZED: ${formatError(authError || "user not found")}`);
    }

    // OAuth clients use the narrow chatgpt-api resource server, not admin actions.
    const {data: claimsData, error: claimsError}=await caller.auth.getClaims(token);
    if(claimsError || !claimsData?.claims || claimsData.claims.client_id)throw new Error("UNAUTHORIZED");

    // Manager authorization is checked with the server/admin client.
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("role, active, must_change_password")
      .eq("id", authData.user.id)
      .single();

    if (profileError) {
      throw new Error(`PROFILE_LOOKUP_FAILED: ${formatError(profileError)}`);
    }
    if (!callerProfile?.active) throw new Error("USER_INACTIVE");
    if (callerProfile.must_change_password) throw new Error("ACCOUNT_NOT_READY");
    if (callerProfile.role !== "manager") throw new Error("MANAGER_ONLY");

    // Manager operations require a second factor (TOTP / AAL2), not only
    // possession of the password. The supplied JWT was already validated above.
    const { data: aalData, error: aalError } =
      await caller.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (aalError) {
      throw new Error(`MFA_CHECK_FAILED: ${formatError(aalError)}`);
    }
    if (aalData?.currentLevel !== "aal2") {
      throw new Error("MFA_REQUIRED");
    }

    const body = await req.json();
    const action = String(body.action || "");

    if (action === "health") {
      return json({
        ok: true,
        manager: true,
        mfa_aal2: true,
        admin_client: true,
        key_mode: Deno.env.get("SUPABASE_SECRET_KEYS") ? "new-secret-key" : "legacy-service-role",
      });
    }

    if (action === "create") {
      const nationalId = String(body.national_id || "").trim();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "");

      if (!/^\d{10}$/.test(nationalId)) {
        throw new Error("INVALID_NATIONAL_ID");
      }
      if (!fullName || !["teacher", "student"].includes(role)) {
        throw new Error("INVALID_DATA");
      }

      const email = `${nationalId}@school.local`;

      const { data, error: createError } = await admin.auth.admin.createUser({
        email,
        password: nationalId,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          national_id: nationalId,
          role,
        },
      });

      if (createError || !data?.user) {
        throw new Error(`AUTH_CREATE_FAILED: ${formatError(createError || "missing created user")}`);
      }

      const { error: insertError } = await admin.rpc("apply_profile_patch", {
        p_user: data.user.id,
        p_actor: authData.user.id,
        p_create: true,
        p_patch: {
          national_id: nationalId,
          full_name: fullName,
          role,
          active: true,
          must_change_password: true,
        },
      });

      if (insertError) {
        // Roll back Auth user if profile creation fails.
        const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
        const rollbackText = rollbackError ? ` | ROLLBACK_FAILED: ${formatError(rollbackError)}` : "";
        throw new Error(`PROFILE_CREATE_FAILED: ${formatError(insertError)}${rollbackText}`);
      }

      return json({
        ok: true,
        user_id: data.user.id,
      });
    }

    if (action === "update") {
      const userId = String(body.user_id || "");
      const nationalId = String(body.national_id || "").trim();
      const fullName = String(body.full_name || "").trim();
      const role = String(body.role || "");
      const password = body.password ? String(body.password) : undefined;
      if (password && password.length < 8) throw new Error("WEAK_PASSWORD");

      if (
        !userId ||
        !/^\d{10}$/.test(nationalId) ||
        !fullName ||
        !["teacher", "student"].includes(role)
      ) {
        throw new Error("INVALID_DATA");
      }

      const attrs: Record<string, unknown> = {
        email: `${nationalId}@school.local`,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          national_id: nationalId,
          role,
        },
      };

      if (password) attrs.password = password;
      if (password) {
        // Close the account gate before changing the password for active sessions.
        const { error: gateError } = await admin.rpc("apply_profile_patch", {
          p_user: userId, p_actor: authData.user.id, p_patch: { must_change_password: true },
        });
        if (gateError) throw new Error("PROFILE_UPDATE_FAILED");
      }

      const { error: authUpdateError } =
        await admin.auth.admin.updateUserById(userId, attrs);

      if (authUpdateError) {
        throw new Error(`AUTH_UPDATE_FAILED: ${formatError(authUpdateError)}`);
      }

      const { error: updateError } = await admin.rpc("apply_profile_patch", {
        p_user: userId,
        p_actor: authData.user.id,
        p_patch: {
          national_id: nationalId,
          full_name: fullName,
          role,
          ...(password ? { must_change_password: true } : {}),
        },
      });

      if (updateError) {
        throw new Error(`PROFILE_UPDATE_FAILED: ${formatError(updateError)}`);
      }

      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.user_id || "");
      if (!userId) throw new Error("INVALID_DATA");
      if (userId === authData.user.id) throw new Error("CANNOT_DELETE_SELF");

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        throw new Error(`AUTH_DELETE_FAILED: ${formatError(error)}`);
      }

      return json({ ok: true });
    }

    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const message = formatError(error);
    console.error("ADMIN_USER_ERROR", message);
    return json({ ok: false, error: message }, 200);
  }
});
