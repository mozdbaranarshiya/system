import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { Script } from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
for(const file of ['app.js','config.js',...(await readdir('js')).map(f=>'js/'+f)])new Script(await readFile(file,'utf8'),{filename:file});
async function checkEdge(directory){
for(const entry of await readdir(directory,{withFileTypes:true})){
const file=path.join(directory,entry.name);
if(entry.isDirectory())await checkEdge(file);
else if(file.endsWith('.ts'))stripTypeScriptTypes(await readFile(file,'utf8'),{mode:'transform'});
}}
await checkEdge('supabase/functions');
console.log('JavaScript and Edge Function syntax checks passed.');
