// Stateless, read-only Streamable HTTP MCP endpoint for ChatGPT.
// Deploy without gateway JWT verification: tool calls are authenticated by chatgpt-api.

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
const VERSION = "2025-03-26";
const TOOLS = [
  {
    name: "get_my_school_account",
    description: "Read the connected user's school display name and pseudonymous account ID. Never exposes national ID or password.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    securitySchemes: [{ type: "oauth2", scopes: ["profile"] }],
  },
  {
    name: "get_my_school_classes",
    description: "Read classes permitted for the connected student, teacher or MFA-verified manager.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    securitySchemes: [{ type: "oauth2", scopes: ["profile"] }],
  },
];
Deno.serve(async (req) => {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const resource = url + "/functions/v1/chatgpt-mcp";
  const metadataUrl = resource + "/.well-known/oauth-protected-resource";
  const path = new URL(req.url).pathname;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  };
  const respond = (code: number, value: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(value), { status: code, headers: { ...headers, ...extra } });
  const challenge = () => respond(401, { error: "unauthorized" }, {
    "WWW-Authenticate": 'Bearer resource_metadata="' + metadataUrl + '", scope="profile"',
  });
  const response = (id: Rpc["id"], result: unknown) =>
    respond(200, { jsonrpc: "2.0", id, result });
  const rpcError = (id: Rpc["id"], code: number, message: string) =>
    respond(200, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (!url.startsWith("https://") || Deno.env.get("CHATGPT_OAUTH_PRIVACY_SAFE") !== "true")
    return respond(503, { error: "not_configured" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method === "GET" && path.endsWith("/chatgpt-mcp/.well-known/oauth-protected-resource")) {
    return respond(200, {
      resource,
      authorization_servers: [url + "/auth/v1"],
      scopes_supported: ["profile"],
      resource_documentation: "https://github.com/mozdbaranarshiya/system/blob/main/docs/chatgpt-oauth.md",
    });
  }
  if (!path.endsWith("/chatgpt-mcp")) return respond(404, { error: "not_found" });
  if (req.method === "GET") return challenge(); // Stateless MCP; no SSE subscriptions.
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });
  if (Number(req.headers.get("Content-Length") || 0) > 16384)
    return respond(413, { error: "request_too_large" });
  let rpc: Rpc;
  try {
    rpc = await req.json();
    if (!rpc || Array.isArray(rpc) || typeof rpc !== "object" ||
        rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
      return rpcError(null, -32600, "Invalid Request");
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (rpc.method === "notifications/initialized" || rpc.method === "notifications/cancelled")
    return new Response(null, { status: 202, headers });
  if (rpc.method === "initialize") return response(rpc.id, {
    protocolVersion: VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "system-school-readonly", version: "1.0.0" },
    instructions: "Only two read-only tools. Never ask the user for a password, national ID or MFA code in ChatGPT.",
  });
  if (rpc.method === "ping") return response(rpc.id, {});
  if (rpc.method === "tools/list") return response(rpc.id, { tools: TOOLS });
  if (rpc.method !== "tools/call") return rpcError(rpc.id, -32601, "Method not found");
  const params = rpc.params;
  if (!params || typeof params !== "object" || Array.isArray(params))
    return rpcError(rpc.id, -32602, "Invalid params");
  const call = params as { name?: string; arguments?: unknown };
  const route = call.name === "get_my_school_account" ? "/me"
    : call.name === "get_my_school_classes" ? "/my/classes" : null;
  if (!route || (call.arguments !== undefined &&
      (typeof call.arguments !== "object" || call.arguments === null ||
        Array.isArray(call.arguments) || Object.keys(call.arguments).length !== 0)))
    return rpcError(rpc.id, -32602, "Invalid tool or arguments");
  const token = /^Bearer (\S+)$/i.exec(req.headers.get("Authorization") || "")?.[1];
  if (!token) return challenge();
  try {
    const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
    let key = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (raw) {
      const keys = JSON.parse(raw);
      key = String(keys.default || Object.values(keys)[0] || key);
    }
    if (!key) return respond(503, { error: "not_configured" });
    const api = await fetch(url + "/functions/v1/chatgpt-api" + route, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, apikey: key, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (api.status === 401) return challenge();
    if (api.status === 403) return rpcError(rpc.id, -32003, "Access denied: reconnect or check school permissions");
    if (!api.ok) return rpcError(rpc.id, -32603, "School API unavailable");
    const result = await api.json();
    return response(rpc.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    });
  } catch {
    return rpcError(rpc.id, -32603, "School API unavailable");
  }
});
