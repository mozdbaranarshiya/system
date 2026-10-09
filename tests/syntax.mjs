import { readFile,readdir } from 'node:fs/promises';
import { Script } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
for(const file of ['app.js','config.js',...(await readdir('js')).map(f=>'js/'+f)])new Script(await readFile(file,'utf8'),{filename:file});
for(const file of ['supabase/functions/admin-user/index.ts','supabase/functions/account-security/index.ts','supabase/functions/chatgpt-api/index.ts'])stripTypeScriptTypes(await readFile(file,'utf8'));
console.log('JavaScript and Edge Function syntax checks passed.');
