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

function databaseSchema(): string {
  const schema = Deno.env.get("SYSTEM_DB_SCHEMA") || "public";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("INVALID_DB_SCHEMA");
  return schema;
}

// Decode only after Auth has validated this exact token. A signed AAL2 claim
// alone can outlive unenrollment, logout or a persisted session downgrade.
function managerSession(token: string, userId: string, supabaseUrl: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || token.length > 8192) throw new Error();
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), x => x.charCodeAt(0))));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!claims || typeof claims !== "object" || Array.isArray(claims)
      || !uuid.test(userId) || claims.sub !== userId || typeof claims.session_id !== "string" || !uuid.test(claims.session_id)
      || claims.aal !== "aal2" || claims.role !== "authenticated" || claims.aud !== "authenticated"
      || claims.iss !== supabaseUrl.replace(/\/$/, "") + "/auth/v1" || Object.hasOwn(claims, "client_id")
      || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error();
    return claims.session_id;
  } catch {
    throw new Error("MFA_REQUIRED");
  }
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
    const schema = databaseSchema();

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) throw new Error("UNAUTHORIZED: missing user token");

    const caller = createClient(supabaseUrl, publishableKey, {
      db: { schema },
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
      db: { schema },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } = await caller.auth.getUser(token);
    if (authError || !authData?.user) {
      throw new Error(`UNAUTHORIZED: ${formatError(authError || "user not found")}`);
    }

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

    const sessionId = managerSession(token, authData.user.id, supabaseUrl);
    try {
      const { data: sessionReady, error: sessionError } = await admin.rpc("assert_manager_session", {
        p_user: authData.user.id, p_session: sessionId,
      });
      if (sessionError || sessionReady !== true) throw new Error();
    } catch {
      throw new Error("MFA_REQUIRED");
    }

    // Auth is shared across schemas. School managers may only mutate accounts
    // that already belong to this school, never another application's users.
    async function requireManagedProfile(userId: string): Promise<void> {
      const { data: target, error } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .single();
      if (error || target?.id !== userId || !["teacher", "student"].includes(target?.role)) {
        throw new Error("TARGET_NOT_MANAGED");
      }
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

      await requireManagedProfile(userId);

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

      await requireManagedProfile(userId);
      // A dedicated school schema shares Auth with the other application.
      // Removing school membership must preserve that identity and its data.
      const { error } = schema === "public"
        ? await admin.auth.admin.deleteUser(userId)
        : await admin.rpc("remove_profile_access", { p_user: userId, p_actor: authData.user.id });
      if (error) {
        throw new Error(schema === "public" ? "AUTH_DELETE_FAILED" : "PROFILE_DELETE_FAILED");
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
