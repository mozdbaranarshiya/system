import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const raw = await readFile("supabase/functions/chatgpt-mcp/index.ts", "utf8");
const source = stripTypeScriptTypes(raw.replace(/^import .*;\r?\n/m, ""));
let passed = 0;
async function invoke(method = "POST", name = "initialize", options = {}) {
  let handler;
  let fetched = 0;
  let forwarded = null;
  const base = "https://test.invalid";
  const mockFetch = async (url, init) => {
    fetched++;
    forwarded = { url, method: init.method, key: init.headers.apikey,
      authorization: init.headers.Authorization };
    const status = options.apiStatus || 200;
    return { status, ok: status === 200, json: async () => ({
      id: "safe-user-id", display_name: "School member",
    }) };
  };
  vm.runInNewContext(source, {
    Deno: { env: { get: key => ({
      SUPABASE_URL: base,
      SUPABASE_ANON_KEY: "public-key",
      CHATGPT_OAUTH_PRIVACY_SAFE: options.privacySafe === false ? "false" : "true",
    })[key] }, serve: cb => handler = cb },
    Request, Response, URL, JSON, Object, String, Number, Boolean, Array, Promise, Error,
    AbortSignal, fetch: mockFetch,
  });
  const args = name === "tools/call" ? { name: options.tool || "get_my_school_account",
    arguments: options.arguments || {} } : {};
  const body = options.rawBody || JSON.stringify({ jsonrpc: "2.0", id: 12,
    method: name, params: args });
  const path = options.metadata ? "/chatgpt-mcp/.well-known/oauth-protected-resource" :
    "/chatgpt-mcp";
  const response = await handler(new Request(base + path, {
    method, headers: {
      ...(options.auth === false ? {} : { Authorization: "Bearer signed.jwt.token" }),
      "Content-Type": "application/json",
    },
    ...(method === "POST" ? { body } : {}),
  }));
  const txt = await response.text();
  return { status: response.status, body: txt ? JSON.parse(txt) : null,
    headers: response.headers, fetched, forwarded };
}
const verify = async (name, method, rpc, opts, expected) => {
  const result = await invoke(method, rpc, opts);
  assert.equal(result.status, expected, name); passed++;
  return result;
};
const meta = await verify("protected metadata", "GET", "", { metadata: true }, 200);
assert.equal(meta.body.resource, "https://test.invalid/functions/v1/chatgpt-mcp"); passed++;
assert.deepEqual(Array.from(meta.body.scopes_supported), ["profile"]); passed++;
const sse = await verify("stateless MCP rejects authenticated SSE GET","GET","",
  {},405);
assert.equal(sse.body.error,"sse_not_supported"); passed++;
const unauthGet = await verify("GET advertises bearer challenge","GET","",
  {auth:false},401);
assert.ok(unauthGet.headers.get("www-authenticate"));passed++;
const init = await verify("initialization", "POST", "initialize", {}, 200);
assert.equal(init.body.result.protocolVersion, "2025-03-26"); passed++;
const listing = await verify("tools listing", "POST", "tools/list", { auth: false }, 200);
assert.equal(listing.body.result.tools.length, 2); passed++;
assert.ok(listing.body.result.tools.every(t=>t.annotations.readOnlyHint)); passed++;
const anonymous = await verify("unauthenticated tool", "POST", "tools/call", { auth:false }, 401);
assert.match(anonymous.headers.get("www-authenticate"), /resource_metadata=/); passed++;
assert.equal(anonymous.fetched, 0); passed++;
const good = await verify("authorized proxy call", "POST", "tools/call", {}, 200);
assert.equal(good.forwarded.url, "https://test.invalid/functions/v1/chatgpt-api/me"); passed++;
assert.equal(good.forwarded.authorization, "Bearer signed.jwt.token"); passed++;
assert.equal(good.body.result.structuredContent.display_name, "School member"); passed++;
await verify("classes tool", "POST", "tools/call",
  { tool:"get_my_school_classes" }, 200);
const denied = await verify("resource rejects invalid token", "POST", "tools/call",
  { apiStatus:401 }, 401);
assert.match(denied.headers.get("www-authenticate"), /scope="profile"/); passed++;
const revoked = await verify("resource rejects revoked grant", "POST", "tools/call",
  { apiStatus:403 }, 200);
assert.equal(revoked.body.error.code, -32003); passed++;
const noWrite = await verify("reject unknown tool", "POST", "tools/call",
  { tool:"delete_all_students" }, 200);
assert.equal(noWrite.body.error.code, -32602); passed++;
assert.equal(noWrite.fetched, 0); passed++;
const invalid = await verify("reject nonempty arguments", "POST", "tools/call",
  { arguments:{ user_id:"other-person" } }, 200);
assert.equal(invalid.fetched, 0); passed++;
const offline = await verify("disabled in production until audited", "POST", "initialize",
  { privacySafe:false }, 503);
assert.equal(offline.body.error, "not_configured"); passed++;
const unexpected = await verify("reject unknown method", "POST", "prompts/list", {}, 200);
assert.equal(unexpected.body.error.code, -32601); passed++;
console.log("MCP discovery and read-only tool security tests:", passed, "passed (mocked API).");
