// One-time operator-controlled privacy migration. Dry-run by default.
// Run with an isolated service-role key, and only after deploying school-login.
// Do not enable CHATGPT_OAUTH_PRIVACY_SAFE until the post-migration audit passes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
const expected = Deno.env.get("SCHOOL_EXPECTED_SUPABASE_REF") || "";
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const execute = Deno.args.includes("--execute");
if (!url || !expected || !secret ||
    url !== "https://" + expected + ".supabase.co")
  throw new Error("TARGET_MISMATCH: refuse to access an unverified Supabase project");
if (execute && Deno.env.get("SCHOOL_IDENTITY_MIGRATION_CONFIRM") !==
    "I_HAVE_BACKED_UP_AND_DEPLOYED_SCHOOL_LOGIN")
  throw new Error("CONFIRMATION_REQUIRED");
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let changed = 0, checked = 0, failures = 0;
const looksSensitive = (value: string) => /[0-9]{10}@school\.local/i.test(value);
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
  if (error) throw new Error("LIST_USERS_FAILED");
  const users = data?.users || [];
  if (!users.length) break;
  for (const user of users) {
    checked++;
    const target = "u-" + user.id + "@school.local";
    const changeNeeded = user.email !== target || Object.keys(user.user_metadata || {}).length > 0;
    if (!changeNeeded) continue;
    if (!execute) { changed++; continue; }
    const result = await admin.auth.admin.updateUserById(user.id, {
      email: target, email_confirm: true, user_metadata: {},
    });
    if (result.error) { failures++; continue; }
    const { data: confirmed, error: readError } = await admin.auth.admin.getUserById(user.id);
    const saved = confirmed?.user;
    // Auth's /user response includes identities; an old email there still leaks PII.
    const identityData = JSON.stringify(saved?.identities || []);
    if (readError || saved?.email !== target ||
        Object.keys(saved?.user_metadata || {}).length ||
        looksSensitive(identityData) || looksSensitive(JSON.stringify(saved || {}))) {
      failures++;
      continue;
    }
    // Change counting intentionally does not log user IDs or national IDs.
    changed++;
  }
  if (users.length < 50) break;
}
console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", checked, changed, failures }));
if (failures) throw new Error("PRIVACY_AUDIT_FAILED: keep OAuth disabled");
