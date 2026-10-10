// OAuth transport boundary. Supabase Auth remains the password/MFA authority;
// transactional, service-only PostgreSQL RPCs own consent and token state.
type Dependencies = { env: (name: string) => string | undefined; fetch: typeof fetch };
type ObjectData = Record<string, any>;
class OAuthError extends Error {
  redirectTarget?: string;
  constructor(public code: string, public status = 400) { super(code); }
}
const SCOPES = ["profile.read", "classes.read", "grades.read", "assignments.read"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (prefix = "") => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), x => x.toString(16).padStart(2, "0")).join("");
}
export async function challenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
const equal = (a: string, b: string) => {
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return different === 0;
};
function unique(params: URLSearchParams): ObjectData {
  const data: ObjectData = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(data, key)) throw new OAuthError("invalid_request");
    data[key] = value;
  }
  return data;
}
async function body(req: Request, json = false): Promise<ObjectData> {
  const contentType = req.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== (json ? "application/json" : "application/x-www-form-urlencoded")) throw new OAuthError("invalid_request", 415);
  if (Number(req.headers.get("content-length") || 0) > 16384) throw new OAuthError("invalid_request", 413);
  const reader = req.body?.getReader(); let size = 0; const parts: Uint8Array[] = [];
  if (reader) while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length; if (size > 16384) { await reader.cancel(); throw new OAuthError("invalid_request", 413); }
    parts.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const text = new TextDecoder().decode(bytes);
  try {
    const value = json ? JSON.parse(text) : unique(new URLSearchParams(text));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch (error) { if (error instanceof OAuthError) throw error; throw new OAuthError("invalid_request"); }
}
function string(data: ObjectData, name: string, max = 2048, required = true): string {
  const value = data[name];
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || (required && !value) || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new OAuthError("invalid_request");
  return value;
}
function scopes(value: string): string[] {
  const list = value.trim().split(/ +/).filter(Boolean);
  if (!list.length || new Set(list).size !== list.length || list.some(x => !SCOPES.includes(x))) throw new OAuthError("invalid_scope");
  return list;
}
function readKey(env: Dependencies["env"], modern: string, legacy: string): string {
  const value = env(modern);
  if (value) { try { const keys = JSON.parse(value); const key = keys.default || Object.values(keys)[0]; if (typeof key === "string" && key) return key; } catch { /* fall back */ } }
  const legacyKey = env(legacy); if (!legacyKey) throw new OAuthError("temporarily_unavailable", 503); return legacyKey;
}
export function makeHandler(deps: Dependencies): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const security: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Vary": "Origin",
    };
    const response = (data: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { ...security, ...extra } });
    try {
      const base = deps.env("SUPABASE_URL")?.replace(/\/$/, "");
      const site = deps.env("OAUTH_SITE_URL");
      const dbSchema = deps.env("SYSTEM_DB_SCHEMA") ?? "public";
      if (!base || !site || !/^[a-z_][a-z0-9_]{0,62}$/.test(dbSchema)) throw new OAuthError("temporarily_unavailable", 503);
      const siteURL = new URL(site);
      const localHTTP = deps.env("OAUTH_ALLOW_LOCAL_HTTP") === "true";
      const secureURL = (value: string) => {
        try { const u = new URL(value); return !u.username && !u.password && !u.hash && (u.protocol === "https:" || (localHTTP && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))); } catch { return false; }
      };
      if (!secureURL(site) || siteURL.search) throw new OAuthError("temporarily_unavailable", 503);
      const allowedOrigins = (deps.env("OAUTH_ALLOWED_ORIGINS") || siteURL.origin).split(",").map(x => x.trim()).filter(Boolean);
      if (allowedOrigins.some(x => !secureURL(x) || new URL(x).origin !== x)) throw new OAuthError("temporarily_unavailable", 503);
      const origin = req.headers.get("origin");
      if (origin && !allowedOrigins.includes(origin)) throw new OAuthError("access_denied", 403);
      if (origin) security["Access-Control-Allow-Origin"] = origin;
      const url = new URL(req.url);
      const root = url.pathname.indexOf("/oauth-connector");
      const path = root >= 0 ? url.pathname.slice(root + "/oauth-connector".length) : url.pathname;
      const browser = path.startsWith("/account/") || ["/oauth/prepare", "/oauth/decision"].includes(path);
      if (browser && !origin) throw new OAuthError("access_denied", 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
        ...security, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Max-Age": "600",
      } });
      const publicKey = readKey(deps.env, "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
      const serviceKey = readKey(deps.env, "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
      async function rpc(name: string, data: ObjectData): Promise<ObjectData> {
        const result = await deps.fetch(base + "/rest/v1/rpc/" + name, {
          method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", "Accept-Profile": dbSchema, "Content-Profile": dbSchema },
          body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
        });
        if (!result.ok) throw new OAuthError("temporarily_unavailable", 503);
        const value = await result.json();
        if (!value || typeof value !== "object") throw new OAuthError("temporarily_unavailable", 503);
        return value;
      }
      const op = (action: string, data: ObjectData) => rpc("oauth_operation", { p_action: action, p_data: data });
      function checked(value: ObjectData): ObjectData {
        if (value.error) {
          const statuses: Record<string, number> = { invalid_client: 401, invalid_token: 401, insufficient_scope: 403, access_denied: 403, mfa_required: 403, account_not_ready: 403, temporarily_unavailable: 503 };
          throw new OAuthError(value.error, statuses[value.error] || 400);
        }
        return value;
      }
      const bearer = () => {
        const header = req.headers.get("authorization") || "";
        if (!/^Bearer [A-Za-z0-9_.~-]+$/i.test(header) || header.length > 8192) throw new OAuthError("invalid_token", 401);
        return header.slice(7);
      };
      async function authenticated(): Promise<ObjectData> {
        const token = bearer();
        if (token.split(".").length !== 3) throw new OAuthError("invalid_token", 401);
        const result = await deps.fetch(base + "/auth/v1/user", {
          headers: { apikey: publicKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
        });
        if (!result.ok) throw new OAuthError("invalid_token", 401);
        const user = await result.json();
        // Decode only AFTER Auth has validated this exact token's signature and expiry.
        let claims: ObjectData;
        try { const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), x => x.charCodeAt(0)))); }
        catch { throw new OAuthError("invalid_token", 401); }
        const now = Math.floor(Date.now() / 1000);
        if (!uuid.test(user.id || "") || claims.sub !== user.id || !uuid.test(claims.session_id || "") || claims.client_id || claims.role !== "authenticated" || claims.aud !== "authenticated" || claims.iss !== base + "/auth/v1" || typeof claims.exp !== "number" || claims.exp <= now) throw new OAuthError("invalid_token", 401);
        const mfa = Array.isArray(claims.amr) ? claims.amr.filter((a: ObjectData) => a.method === "totp" && typeof a.timestamp === "number" && a.timestamp <= now + 30).map((a: ObjectData) => a.timestamp) : [];
        return { user_id: user.id, actor: user.id, session_id: claims.session_id, mfa_time: claims.aal === "aal2" && mfa.length ? Math.max(...mfa) : null };
      }
      async function rate(key: string, limit = 60): Promise<void> {
        const result = checked(await op("rate", { key: await digest(key), limit, window_seconds: 60 }));
        if (!result.allowed) throw new OAuthError("rate_limit_exceeded", 429);
      }
      async function client(id: string): Promise<ObjectData> {
        if (!uuid.test(id)) throw new OAuthError("invalid_client", 401);
        const data = checked(await op("client", { client_id: id }));
        if (!data.active) throw new OAuthError("invalid_client", 401);
        return data;
      }
      async function authorization(data: ObjectData, redirectErrors = false): Promise<ObjectData> {
        const clientId = string(data, "client_id", 100); await rate("authorize:" + clientId);
        const app = await client(clientId);
        const redirect = string(data, "redirect_uri");
        if (!secureURL(redirect) || !Array.isArray(app.redirect_uris) || !app.redirect_uris.includes(redirect)) throw new OAuthError("invalid_request");
        try {
          if (string(data, "response_type", 30) !== "code") throw new OAuthError("unsupported_response_type");
          const state = string(data, "state", 512);
          const requested = scopes(string(data, "scope", 256));
          if (!Array.isArray(app.allowed_scopes) || requested.some(x => !app.allowed_scopes.includes(x))) throw new OAuthError("invalid_scope");
          const pkce = string(data, "code_challenge", 128, false);
          const method = string(data, "code_challenge_method", 30, false);
          if (pkce ? method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(pkce) : !!method || app.public_client || app.pkce_required) throw new OAuthError("invalid_request");
          return { client_id: clientId, redirect_uri: redirect, scopes: requested, state, code_challenge: pkce || null };
        } catch (error) {
          // RFC 6749 4.1.2.1: only a validated registered callback may receive
          // authorization errors. An invalid client or redirect stays local.
          if (redirectErrors && error instanceof OAuthError) {
            const callback = new URL(redirect);
            callback.searchParams.set("error", error.code);
            if (typeof data.state === "string" && data.state.length <= 512 && !/[\x00-\x1f\x7f]/.test(data.state)) callback.searchParams.set("state", data.state);
            error.redirectTarget = callback.href;
          }
          throw error;
        }
      }
      async function tokenClient(data: ObjectData): Promise<ObjectData> {
        let id = string(data, "client_id", 100, false), secret = string(data, "client_secret", 512, false);
        const header = req.headers.get("authorization");
        if (header) {
          if (!/^Basic [A-Za-z0-9+/]+=*$/i.test(header) || id || secret) throw new OAuthError("invalid_client", 401);
          try { const decoded = atob(header.slice(6)); const separator = decoded.indexOf(":"); if (separator < 1) throw new Error(); id = decodeURIComponent(decoded.slice(0, separator)); secret = decodeURIComponent(decoded.slice(separator + 1)); }
          catch { throw new OAuthError("invalid_client", 401); }
        }
        await rate("token:" + id);
        const app = await client(id);
        if (app.public_client ? !!secret : !secret || !equal(await digest(secret), app.secret_hash || "")) throw new OAuthError("invalid_client", 401);
        return { ...app, client_id: id };
      }
      if (path === "/oauth/authorize" && req.method === "GET") {
        await rate("authorize:global", 500);
        const input = unique(url.searchParams); await authorization(input, true);
        siteURL.searchParams.set("oauth", "1");
        for (const key of ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"]) if (input[key]) siteURL.searchParams.set(key, input[key]);
        return new Response(null, { status: 302, headers: { ...security, Location: siteURL.href } });
      }
      if (path === "/oauth/prepare" && req.method === "POST") {
        const auth = await authenticated(); await rate("prepare:" + auth.user_id, 30);
        const input = await authorization(await body(req, true));
        const csrf = random(), requestId = crypto.randomUUID();
        const prepared = checked(await op("prepare", { ...input, ...auth, request_id: requestId, csrf_hash: await digest(csrf) }));
        return response({ ...prepared, csrf_token: csrf });
      }
      if (path === "/oauth/decision" && req.method === "POST") {
        const auth = await authenticated(); await rate("decision:" + auth.user_id, 30);
        const input = await body(req, true), requestId = string(input, "request_id", 100), csrf = string(input, "csrf_token", 100);
        if (!uuid.test(requestId) || typeof input.approve !== "boolean") throw new OAuthError("invalid_request");
        const code = random("soc_");
        const result = checked(await op("decide", { ...auth, request_id: requestId, csrf_hash: await digest(csrf), approve: input.approve, code_hash: await digest(code) }));
        if (!secureURL(result.redirect_uri) || typeof result.state !== "string") throw new OAuthError("temporarily_unavailable", 503);
        const redirect = new URL(result.redirect_uri);
        redirect.searchParams.set(result.approved ? "code" : "error", result.approved ? code : "access_denied");
        redirect.searchParams.set("state", result.state);
        return response({ redirect_url: redirect.href });
      }
      if (path === "/oauth/token" && req.method === "POST") {
        await rate("token:global", 500);
        const input = await body(req), app = await tokenClient(input), grant = string(input, "grant_type", 40);
        const access = random("soa_"), refresh = random("sor_");
        let result: ObjectData;
        if (grant === "authorization_code") {
          const code = string(input, "code", 100), redirect = string(input, "redirect_uri");
          if (!/^soc_[A-Za-z0-9_-]{43}$/.test(code)) throw new OAuthError("invalid_grant");
          const verifier = string(input, "code_verifier", 128, false);
          if (verifier && !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant");
          result = await op("exchange", { client_id: app.client_id, code_hash: await digest(code), redirect_uri: redirect,
            code_challenge: verifier ? await challenge(verifier) : null, access_hash: await digest(access), refresh_hash: await digest(refresh) });
        } else if (grant === "refresh_token") {
          const old = string(input, "refresh_token", 100);
          if (!/^sor_[A-Za-z0-9_-]{43}$/.test(old)) throw new OAuthError("invalid_grant");
          const scope = string(input, "scope", 256, false);
          result = await op("refresh", { client_id: app.client_id, refresh_hash: await digest(old), access_hash: await digest(access), next_refresh_hash: await digest(refresh), scopes: scope ? scopes(scope) : null });
        } else throw new OAuthError("unsupported_grant_type");
        checked(result);
        return response({ access_token: access, token_type: "Bearer", expires_in: result.expires_in, refresh_token: refresh, scope: result.scopes.join(" ") });
      }
      if (path === "/oauth/revoke" && req.method === "POST") {
        await rate("token:global", 500);
        const input = await body(req), app = await tokenClient(input), token = string(input, "token", 100);
        checked(await op("revoke", { client_id: app.client_id, token_hash: await digest(token) }));
        return response({});
      }
      if (path.startsWith("/api/") && req.method === "GET") {
        const resource = path.slice(5);
        if (!["me", "classes", "grades", "assignments"].includes(resource)) throw new OAuthError("invalid_request", 404);
        const token = bearer(); if (!/^soa_[A-Za-z0-9_-]{43}$/.test(token)) throw new OAuthError("invalid_token", 401);
        await rate("api:global", 1000);
        await rate("api:" + await digest(token), 120);
        const filters = unique(url.searchParams);
        if (Object.keys(filters).some(x => !["class_id", "student_id", "subject_id", "offset", "limit"].includes(x))) throw new OAuthError("invalid_request");
        for (const key of ["class_id", "student_id", "subject_id"]) if (filters[key] && !uuid.test(filters[key])) throw new OAuthError("invalid_request");
        for (const [key, max] of [["offset", 10000], ["limit", 100]] as const) if (filters[key] !== undefined && (!/^\d+$/.test(filters[key]) || Number(filters[key]) > max || (key === "limit" && Number(filters[key]) < 1))) throw new OAuthError("invalid_request");
        return response(checked(await rpc("oauth_api", { p_token_hash: await digest(token), p_resource: resource, p_filters: filters })));
      }
      if (path.startsWith("/account/")) {
        const auth = await authenticated(); await rate("account:" + auth.user_id, 30);
        if (path === "/account/connections" && req.method === "GET") return response(checked(await op("connections", auth)));
        if (req.method === "POST") {
          const input = await body(req, true);
          if (path === "/account/disconnect") {
            const grantId = string(input, "grant_id", 100); if (!uuid.test(grantId)) throw new OAuthError("invalid_request");
            return response(checked(await op("disconnect", { ...auth, grant_id: grantId, admin: false })));
          }
          if (path === "/account/admin/revoke") {
            const grantId = string(input, "grant_id", 100); if (!uuid.test(grantId)) throw new OAuthError("invalid_request");
            return response(checked(await op("disconnect", { ...auth, grant_id: grantId, admin: true })));
          }
          if (path === "/account/admin/clients") {
            const name = string(input, "name", 100);
            if (!Array.isArray(input.redirect_uris) || !input.redirect_uris.length || input.redirect_uris.length > 10 || input.redirect_uris.some((x: unknown) => typeof x !== "string" || x.length > 2048 || !secureURL(x))) throw new OAuthError("invalid_request");
            if (!Array.isArray(input.allowed_scopes) || input.allowed_scopes.some((x: unknown) => typeof x !== "string")) throw new OAuthError("invalid_scope");
            const requested = scopes(input.allowed_scopes.join(" "));
            if (typeof input.public_client !== "boolean" || (input.pkce_required !== undefined && typeof input.pkce_required !== "boolean")) throw new OAuthError("invalid_request");
            const secret = input.public_client ? null : random("scs_"), clientId = crypto.randomUUID();
            checked(await op("register", { ...auth, client_id: clientId, name, redirect_uris: input.redirect_uris, allowed_scopes: requested, secret_hash: secret ? await digest(secret) : null, pkce_required: input.public_client || input.pkce_required !== false, allow_local_http: localHTTP }));
            return response({ ok: true, client_id: clientId, ...(secret ? { client_secret: secret } : {}) }, 201);
          }
          if (path === "/account/admin/clients/disable") {
            const clientId = string(input, "client_id", 100); if (!uuid.test(clientId)) throw new OAuthError("invalid_request");
            return response(checked(await op("client_disable", { ...auth, client_id: clientId })));
          }
        }
      }
      return response({ error: "invalid_request" }, 404);
    } catch (error) {
      // Never log request bodies, credentials, authorization headers or OTPs.
      if (!(error instanceof OAuthError)) return response({ error: "temporarily_unavailable" }, 503);
      if (error.redirectTarget) return new Response(null, { status: 302, headers: { ...security, Location: error.redirectTarget } });
      return response({ error: error.code }, error.status, {
        ...(error.status === 429 ? { "Retry-After": "60" } : {}),
        ...(error.status === 401 ? { "WWW-Authenticate": error.code === "invalid_client" ? 'Basic realm="oauth"' : 'Bearer error="invalid_token"' } : {}),
      });
    }
  };
}
