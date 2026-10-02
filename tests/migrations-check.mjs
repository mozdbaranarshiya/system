import { database } from './database-setup.mjs';
import { readFile, readdir } from 'node:fs/promises';
const db=await database();
try {
  for (const file of (await readdir('supabase/migrations')).filter(f=>f.startsWith('20261002_')).sort()) {
    try { await db.exec(await readFile('supabase/migrations/'+file,'utf8')); console.log('Applied',file); }
    catch(e) { console.error(file,e.message,e.position,e.query?.slice(Math.max(0,Number(e.position)-100),Number(e.position)+100)); process.exitCode=1; break; }
  }
} finally { await db.close(); }
