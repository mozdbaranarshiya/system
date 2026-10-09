import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {database} from './database-setup.mjs';
import {seed,migrate,asUser,ids} from './fixtures.mjs';

const db=await database();
let checks=0;
async function oauthUser(id,fn,aal='aal2'){
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[
    JSON.stringify({sub:id,role:'authenticated',aal,client_id:'chatgpt-id'})
  ]);
  await db.exec('set role authenticated');
  try {return await fn();}
  finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims','{}',false)");
  }
}
try {
  await seed(db);
  await migrate(db);
  await db.exec(await readFile('supabase/migrations/20261009_chatgpt_oauth.sql','utf8'));
  checks++;
  await asUser(db,ids.student,async()=>{
    await db.query("insert into public.oauth_connected_apps(user_id,client_id) values($1,'chatgpt-id')",[ids.student]);
    assert.equal((await db.query('select count(*)::int n from public.oauth_connected_apps')).rows[0].n,1);
    checks++;
  });
  await asUser(db,ids.teacher,async()=>{
    assert.equal((await db.query('select count(*)::int n from public.oauth_connected_apps')).rows[0].n,0);
    checks++;
    await assert.rejects(
      db.query("update public.oauth_connected_apps set revoked_at=now() where user_id=$1",[ids.student]),
      /permission denied|row-level security|ACCESS_DENIED|RLS/
    ).catch(async e=>{
      // A hidden UPDATE can legitimately return zero rows rather than throw.
      if(e.code==='ERR_ASSERTION') {
        const rows=await db.query("select count(*)::int n from public.oauth_connected_apps where user_id=$1",[ids.student]);
        assert.equal(rows.rows[0].n,0);
      } else throw e;
    });
  });
  await asUser(db,ids.student,async()=>{
    const {rows}=await db.query("update public.oauth_connected_apps set revoked_at=now() where user_id=$1 returning revoked_at",[ids.student]);
    assert.ok(rows[0].revoked_at);checks++;
  });
  await oauthUser(ids.student,async()=>{
    assert.equal((await db.query('select count(*)::int n from public.oauth_connected_apps')).rows[0].n,0);checks++;
    assert.equal((await db.query('select count(*)::int n from public.classes')).rows[0].n,0);checks++;
    await assert.rejects(db.query('select public.oauth_postgrest_guard()'),/OAUTH_DIRECT_API_DISABLED/);checks++;
  });
  await asUser(db,ids.student,async()=>{
    const result=await db.query('select count(*)::int n from public.classes');
    assert.ok(result.rows[0].n>=1);checks++;
    await db.query('select public.oauth_postgrest_guard()');checks++;
  });
  const logs=(await db.query("select action,record_id from public.audit_logs where table_name='oauth_connected_apps' order by created_at")).rows;
  assert.ok(logs.some(log=>log.action==='OAUTH_CONNECTED'));
  assert.ok(logs.some(log=>log.action==='OAUTH_REVOKED'));
  checks++;
  console.log('OAuth PostgreSQL integration checks:',checks,'passed (PGlite, not live Supabase).');
} finally {
  await db.close();
}
