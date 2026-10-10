import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { generateSchoolInstallation, sources } from '../supabase/install-school.mjs';
import { database } from './database-setup.mjs';
import { seed, migrate, seedOAuthSessions, ids as publicIds } from './fixtures.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const uuid = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={manager:uuid(1),teacher:uuid(2),student:uuid(3),otherStudent:uuid(4),initial:uuid(5),examOnly:uuid(6),removable:uuid(7),grade:uuid(20),class:uuid(21),otherClass:uuid(22),subject:uuid(23)};
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
const installation=await generateSchoolInstallation();

async function setup(cryptoSchema='public') {
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;
    create schema auth;create schema storage;create schema extensions;
    create extension pgcrypto with schema ${cryptoSchema};
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
    create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
    create table auth.users(id uuid primary key,email text,encrypted_password text,banned_until timestamptz,deleted_at timestamptz);
    create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users,status text,factor_type text);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users,aal text,factor_id uuid,not_after timestamptz);
    grant usage on schema auth to supabase_auth_admin;
    grant select,update on auth.users to supabase_auth_admin;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated;
    insert into storage.buckets values('assignment-files','existing-exam-files',true,1024,null);
    -- Deliberately broad old policies must not allow access to the new bucket.
    create policy assignment_files_select on storage.objects for select to public using(true);
    create policy exam_files_write on storage.objects for all to public using(true) with check(true);
    create type public.user_role as enum('exam_teacher','exam_student');
    create table public.exams(id uuid primary key,owner uuid references auth.users,title text);
    alter table public.exams enable row level security;
    create policy exam_existing_read on public.exams for select to authenticated using(owner=auth.uid());
    grant select on public.exams to authenticated;
    create function public.is_manager() returns boolean language sql stable as $$select false$$;
    create function public.get_app_bootstrap() returns jsonb language sql as $$select '{"existing":"exam-api"}'::jsonb$$;
    create function public.save_score() returns text language plpgsql as $$begin return 'original exam helper';end$$;
    create function public.exam_auth_guard() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger exam_auth_guard before update on auth.users for each row execute function public.exam_auth_guard();
  `);
  for(const [key,id] of Object.entries(ids).filter(([key])=>!['grade','class','otherClass','subject'].includes(key))) {
    await db.query(`insert into auth.users(id,email,encrypted_password) values($1,$2,${cryptoSchema}.crypt($3,${cryptoSchema}.gen_salt('bf')))`,[id,key+'@school.local','IsolationFixtureStrongPassword!']);
  }
  await db.query("insert into public.exams(id,owner,title) values($1,$2,'محتوای آزمون موجود'),($3,$4,'آزمون حساب مشترک')",[uuid(101),ids.examOnly,uuid(102),ids.removable]);
  await db.query("insert into storage.objects(id,bucket_id,name,owner) values($1,'assignment-files','existing/file.txt',$2)",[uuid(103),ids.examOnly]);
  return db;
}
async function snapshot(db) {
  const queries={
    exams:'select * from public.exams order by id',
    auth:'select * from auth.users order by id',
    bucket:"select * from storage.buckets where id='assignment-files'",
    policies:"select * from pg_policies where schemaname='public' or (schemaname='storage' and policyname not like 'school\\_%' escape '\\') order by schemaname,tablename,policyname",
    functions:"select p.proname,pg_get_functiondef(p.oid) as definition,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_manager','get_app_bootstrap','save_score','exam_auth_guard') order by p.proname",
    triggers:"select tgname,pg_get_triggerdef(oid) definition from pg_trigger where tgrelid='auth.users'::regclass and tgname='exam_auth_guard'",
    enum:"select e.enumlabel from pg_enum e where e.enumtypid='public.user_role'::regtype order by e.enumsortorder",
  };
  const value={};for(const [name,sql] of Object.entries(queries))value[name]=(await db.query(sql)).rows;
  return value;
}
async function asRole(db,role,fn,sub=null,aal='aal1') {
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub,aal})]);await db.exec('set role '+role);
  try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");}
}
const call=(db,name,args,schema='school')=>{
  const entries=Object.entries(args);
  return db.query(`select ${schema}.${name}(${entries.map(([key],i)=>key+' => $'+(i+1)).join(',')}) value`,entries.map(([,value])=>value)).then(r=>r.rows[0].value);
};
const op=(db,action,data)=>asRole(db,'service_role',()=>call(db,'oauth_operation',{p_action:action,p_data:data}));
const api=(db,token,resource='me',filters={})=>asRole(db,'service_role',()=>call(db,'oauth_api',{p_token_hash:token,p_resource:resource,p_filters:filters}));
const sessions=Object.fromEntries(['manager','teacher','student','otherStudent','initial','removable'].map((key,i)=>[ids[key],uuid(1000+i)]));
async function seedSchool(db) {
  for(const [key,role] of [['manager','manager'],['teacher','teacher'],['student','student'],['otherStudent','student'],['initial','student'],['removable','student']]) {
    await db.query('insert into school.profiles(id,national_id,full_name,role,must_change_password) values($1,$2,$3,$4,$5)',[ids[key],String(Object.values(ids).indexOf(ids[key])+1).padStart(10,'0'),'Fixture '+key,role,key==='initial']);
    if(key==='manager')await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[uuid(2000),ids.manager]);
    await db.query('insert into auth.sessions(id,user_id,aal,factor_id) values($1,$2,$3,$4)',[sessions[ids[key]],ids[key],key==='manager'?'aal2':'aal1',key==='manager'?uuid(2000):null]);
  }
  await db.query("insert into school.grade_levels(id,title) values($1,'هفتم')",[ids.grade]);
  await db.query("insert into school.classes(id,grade_id,title) values($1,$3,'مجاز'),($2,$3,'غیرمجاز')",[ids.class,ids.otherClass,ids.grade]);
  await db.query("insert into school.subjects(id,grade_id,title) values($1,$2,'ریاضی')",[ids.subject,ids.grade]);
  await db.query('insert into school.class_students(class_id,student_id) values($1,$3),($2,$4)',[ids.class,ids.otherClass,ids.student,ids.otherStudent]);
  await db.query('insert into school.teacher_assignments(teacher_id,class_id,subject_id) values($1,$2,$3)',[ids.teacher,ids.class,ids.subject]);
  await db.query("insert into school.scores(student_id,class_id,subject_id,continuous_score,final_score) values($1,$2,$3,14,18),($4,$5,$3,16,20)",[ids.student,ids.class,ids.subject,ids.otherStudent,ids.otherClass]);
  await db.exec('update school.school_settings set report_cards_open=true');
}
const client=uuid(3000),callback='https://chatgpt.com/aip/school-isolation/oauth/callback',challenge='b'.repeat(43);
let serial=4000;
async function connect(db,user,scopes=['profile.read','classes.read','grades.read']) {
  const number=serial++;
  const request={request_id:uuid(number),client_id:client,redirect_uri:callback,user_id:user,session_id:sessions[user],scopes,state:'isolation-'+number,code_challenge:challenge,csrf_hash:hash('csrf-'+number),mfa_time:user===ids.manager?Math.floor(Date.now()/1000):null};
  assert.ok((await op(db,'prepare',request)).request_id);
  const code=hash('code-'+number),access=hash('access-'+number),refresh=hash('refresh-'+number);
  assert.equal((await op(db,'decide',{...request,approve:true,code_hash:code})).approved,true);
  const exchange={client_id:client,code_hash:code,redirect_uri:callback,code_challenge:challenge,access_hash:access,refresh_hash:refresh};
  assert.equal((await op(db,'exchange',exchange)).expires_in,900);
  const grant=(await db.query('select grant_id from school_oauth.codes where code_hash=$1',[code])).rows[0].grant_id;
  return {access,refresh,grant,exchange};
}

await test('Generator checks reviewed sources and emits a reproducible atomic SHA manifest',async()=>{
  assert.equal(installation.manifest.steps.length,sources.length+1);assert.equal(installation.manifest.atomic_sha256,hash(installation.sql));
  assert.deepEqual(installation.manifest.steps.slice(0,sources.length).map(s=>s.source_sha256),sources.map(s=>s.sha256));
  assert.equal((await generateSchoolInstallation()).manifest.atomic_sha256,installation.manifest.atomic_sha256);
  assert.equal((installation.sql.match(/^begin;$/gmi)||[]).length,1);assert.equal((installation.sql.match(/^commit;$/gmi)||[]).length,1);
  assert.doesNotMatch(installation.sql,/\bpublic\.|search_path=public|n\.nspname='public'|set role postgres/i);
  assert.match(installation.sql,/from public,anon,authenticated/); // PUBLIC role is not an application schema.
  assert.match(installation.sql,/storage\.buckets\(id,name,public,file_size_limit\)/);
});

for(const cryptoSchema of ['public','extensions']) {
  const db=await setup(cryptoSchema);
  try {
    const before=await snapshot(db);
    await test(`Full school installation preserves existing public app and Auth with pgcrypto in ${cryptoSchema}`,async()=>{
      await db.exec(installation.sql);assert.deepEqual(await snapshot(db),before);
      assert.equal((await db.query("select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto'")).rows[0].nspname,cryptoSchema);
      assert.equal((await db.query("select public.save_score() result")).rows[0].result,'original exam helper');
      assert.equal((await db.query("select count(*)::int count from school.exams")).rows[0].count,0);
    });
    await test('Storage bucket and policy names are separate without changing the old public flag',async()=>{
      const newBucket=(await db.query("select * from storage.buckets where id='school-assignment-files'")).rows[0];
      assert.equal(newBucket.public,false);assert.equal(newBucket.file_size_limit,20971520);
      const policies=(await db.query("select policyname from pg_policies where schemaname='storage' and policyname like 'school\\_%' escape '\\'")).rows;
      assert.ok(policies.length>=9);assert.equal((await db.query("select count(*)::int count from pg_trigger where tgrelid='auth.users'::regclass and tgname in ('exam_auth_guard','school_oauth_auth_security')")).rows[0].count,2);
    });
    await seedSchool(db);
    await test('School account readiness and manager MFA use the separate schema',async()=>{
      assert.equal(await asRole(db,'authenticated',()=>call(db,'account_ready',{}),ids.student),true);
      assert.equal(await asRole(db,'authenticated',()=>call(db,'account_ready',{}),ids.initial),false);
      assert.equal(await asRole(db,'authenticated',()=>call(db,'is_manager',{}),ids.manager),false);
      assert.equal(await asRole(db,'authenticated',()=>call(db,'is_manager',{}),ids.manager,'aal2'),true);
      assert.equal((await db.query('select public.is_manager() value')).rows[0].value,false);
      assert.equal((await asRole(db,'authenticated',()=>db.query('select * from school.scores'),ids.initial)).rows.length,0);
    });
    await test('Manager privilege assertions accept only the persisted verified AAL2 session',async()=>{
      const check=(user=ids.manager,session=sessions[ids.manager])=>asRole(db,'service_role',()=>call(db,'assert_manager_session',{p_user:user,p_session:session}));
      assert.equal(await check(),true);
      for(const [user,session] of [[null,sessions[ids.manager]],[ids.manager,null],[ids.manager,uuid(999)],[ids.manager,sessions[ids.student]],[ids.student,sessions[ids.student]],[ids.examOnly,sessions[ids.manager]]])await assert.rejects(()=>check(user,session),/MFA_REQUIRED/);
      for(const role of ['anon','authenticated'])await asRole(db,role,()=>assert.rejects(()=>call(db,'assert_manager_session',{p_user:ids.manager,p_session:sessions[ids.manager]}),/permission denied/),ids.manager,'aal2');
      await db.query('update school.profiles set must_change_password=true where id=$1',[ids.manager]);
      assert.equal(await check(),true); // Required for the first manager password change.
      await db.query('update school.profiles set must_change_password=false where id=$1',[ids.manager]);
      for(const mutation of ["aal='aal1'","not_after=clock_timestamp()-interval '1 second'","factor_id=null","factor_id='"+uuid(999)+"'"]){
        await db.query('update auth.sessions set '+mutation+' where id=$1',[sessions[ids.manager]]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
        await db.query("update auth.sessions set aal='aal2',not_after=null,factor_id=$1 where id=$2",[uuid(2000),sessions[ids.manager]]);
      }
      for(const mutation of ["status='unverified'","factor_type='phone'","user_id='"+ids.student+"'"]){
        await db.query('update auth.mfa_factors set '+mutation+' where id=$1',[uuid(2000)]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
        await db.query("update auth.mfa_factors set status='verified',factor_type='totp',user_id=$1 where id=$2",[ids.manager,uuid(2000)]);
      }
      await db.query('delete from auth.mfa_factors where id=$1',[uuid(2000)]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
      await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",[uuid(2000),ids.manager]);
      for(const mutation of ["active=false","role='teacher'"]){
        await db.query('update school.profiles set '+mutation+' where id=$1',[ids.manager]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
        await db.query("update school.profiles set active=true,role='manager' where id=$1",[ids.manager]);
      }
      for(const mutation of ["banned_until=clock_timestamp()+interval '1 hour'","deleted_at=clock_timestamp()"]){
        await db.query('update auth.users set '+mutation+' where id=$1',[ids.manager]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
        await db.query('update auth.users set banned_until=null,deleted_at=null where id=$1',[ids.manager]);
      }
      await db.query('delete from auth.sessions where id=$1',[sessions[ids.manager]]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
      await db.query("insert into auth.sessions(id,user_id,aal,factor_id) values($1,$2,'aal2',$3)",[sessions[ids.manager],ids.manager,uuid(2000)]);
      assert.equal(await check(),true);
    });
    await test('Default function search paths exclude the unrelated public application',async()=>{
      const functions=(await db.query("select p.proname,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('school','school_private','school_oauth') and p.prosecdef")).rows;
      assert.ok(functions.length>20);for(const fn of functions){assert.ok(fn.proconfig?.some(v=>v.startsWith('search_path=')),fn.proname);assert.doesNotMatch(fn.proconfig.join(','),/\bpublic\b/);}
    });
    await test('Opaque lifecycle RPCs and private schema remain service-only',async()=>{
      for(const role of ['anon','authenticated'])await asRole(db,role,async()=>{
        await assert.rejects(()=>call(db,'oauth_operation',{p_action:'client',p_data:{client_id:client}}),/permission denied/);
        await assert.rejects(()=>db.query('select * from school_oauth.clients'),/permission denied/);
      },ids.student);
      await asRole(db,'service_role',()=>assert.rejects(()=>db.query('select * from school_oauth.clients'),/permission denied/));
    });
    await test('Client registration requires the real manager and persisted MFA context',async()=>{
      const register={actor:ids.manager,session_id:sessions[ids.manager],mfa_time:Math.floor(Date.now()/1000),client_id:client,name:'ChatGPT',redirect_uris:[callback],allowed_scopes:['profile.read','classes.read','grades.read'],secret_hash:hash('school-client-fixture'),pkce_required:true};
      assert.equal((await op(db,'register',{...register,mfa_time:null})).error,'mfa_required');
      assert.equal((await op(db,'register',{...register,actor:ids.teacher,session_id:sessions[ids.teacher]})).error,'access_denied');
      assert.equal((await op(db,'register',register)).ok,true);
    });
    const student=await connect(db,ids.student),teacher=await connect(db,ids.teacher),manager=await connect(db,ids.manager);
    await test('School OAuth API applies scopes, student ownership and teacher assignment',async()=>{
      assert.deepEqual(await api(db,student.access),{id:ids.student,display_name:'Fixture student'});
      assert.deepEqual((await api(db,student.access,'classes')).rows.map(row=>row.id),[ids.class]);
      assert.equal((await api(db,student.access,'grades',{student_id:ids.otherStudent})).error,'access_denied');
      assert.deepEqual((await api(db,teacher.access,'classes')).rows.map(row=>row.id),[ids.class]);
      assert.equal((await api(db,teacher.access,'grades',{class_id:ids.otherClass})).error,'access_denied');
      assert.equal((await api(db,manager.access,'classes')).rows.length,2);
      const narrow=await connect(db,ids.student,['profile.read']);assert.equal((await api(db,narrow.access,'classes')).error,'insufficient_scope');
    });
    await test('Unrelated native Auth security updates keep school grants and the old exam app intact',async()=>{
      const publicBefore=(await db.query('select * from public.exams order by id')).rows;
      const grantsBefore=(await db.query('select id,revoked_at from school_oauth.grants order by id')).rows;
      await asRole(db,'supabase_auth_admin',async()=>{
        await db.query('update auth.users set encrypted_password=$1 where id=$2',[hash('unrelated-native-password-update'),ids.examOnly]);
        await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1",[ids.examOnly]);
        await db.query('update auth.users set deleted_at=clock_timestamp() where id=$1',[ids.examOnly]);
      });
      assert.deepEqual((await db.query('select * from public.exams order by id')).rows,publicBefore);
      assert.deepEqual((await db.query('select id,revoked_at from school_oauth.grants order by id')).rows,grantsBefore);
      assert.equal((await api(db,teacher.access)).id,ids.teacher);
      assert.equal((await db.query("select count(*)::int count from pg_trigger where tgrelid='auth.users'::regclass and tgname='exam_auth_guard'")).rows[0].count,1);
    });
    await test('Single use, refresh and disconnect operate only on the isolated grants',async()=>{
      assert.equal((await op(db,'exchange',student.exchange)).error,'invalid_grant');
      const access=hash('rotated-'+cryptoSchema),refresh=hash('rotated-refresh-'+cryptoSchema);
      assert.equal((await op(db,'refresh',{client_id:client,refresh_hash:student.refresh,access_hash:access,next_refresh_hash:refresh})).expires_in,900);
      assert.equal((await api(db,access)).id,ids.student);
      assert.equal((await op(db,'disconnect',{actor:ids.student,session_id:sessions[ids.student],grant_id:student.grant})).ok,true);
      assert.equal((await api(db,access)).error,'invalid_token');
    });
    await test('Broad existing Storage policies cannot read another school user file',async()=>{
      await db.query('insert into storage.objects(id,bucket_id,name,owner) values($1,$2,$3,$4)',[uuid(5001),'school-assignment-files',ids.student+'/private.txt',ids.student]);
      await db.query('insert into storage.objects(id,bucket_id,name,owner) values($1,$2,$3,$4)',[uuid(5002),'school-assignment-files',ids.otherStudent+'/private.txt',ids.otherStudent]);
      const visible=async user=>(await asRole(db,'authenticated',()=>db.query("select * from storage.objects where bucket_id='school-assignment-files'"),user)).rows;
      assert.deepEqual((await visible(ids.student)).map(row=>row.id),[uuid(5001)]);assert.deepEqual((await visible(ids.otherStudent)).map(row=>row.id),[uuid(5002)]);assert.equal((await visible(ids.examOnly)).length,0);
      assert.equal((await asRole(db,'authenticated',()=>db.query("select * from storage.objects where bucket_id='assignment-files'"),ids.examOnly)).rows.length,1);
    });
    await test('Existing anonymous and PUBLIC Storage policies cannot expose the private school bucket',async()=>{
      await asRole(db,'anon',async()=>{
        assert.equal((await db.query("select * from storage.objects where bucket_id='school-assignment-files'")).rows.length,0);
        assert.equal((await db.query("select * from storage.objects where bucket_id='assignment-files'")).rows.length,1);
        await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('school-assignment-files','anonymous/file.txt')"),/row-level security/);
      });
    });
    await test('A former teacher cannot read an existing submission file after assignment revocation',async()=>{
      const assignment=uuid(5100),fileId=uuid(5101),filePath=ids.student+'/submitted.txt';
      await asRole(db,'authenticated',()=>db.query("insert into school.assignments(id,teacher_id,class_id,subject_id,title,due_at) values($1,$2,$3,$4,'Homework',clock_timestamp()+interval '1 day')",[assignment,ids.teacher,ids.class,ids.subject]),ids.teacher);
      await asRole(db,'authenticated',()=>call(db,'submit_assignment',{p_assignment:assignment,p_file_path:filePath,p_original_name:'submitted.txt'}),ids.student);
      await db.query("insert into storage.objects(id,bucket_id,name,owner) values($1,'school-assignment-files',$2,$3)",[fileId,filePath,ids.student]);
      const visible=()=>asRole(db,'authenticated',()=>db.query('select id from storage.objects where id=$1',[fileId]),ids.teacher);
      assert.equal((await visible()).rows.length,1);
      await db.query('delete from school.teacher_assignments where teacher_id=$1 and class_id=$2 and subject_id=$3',[ids.teacher,ids.class,ids.subject]);
      assert.equal((await visible()).rows.length,0);
      assert.equal((await asRole(db,'authenticated',()=>db.query('select id from storage.objects where id=$1',[fileId]),ids.student)).rows.length,1);
      await db.query('insert into school.teacher_assignments(teacher_id,class_id,subject_id) values($1,$2,$3)',[ids.teacher,ids.class,ids.subject]);
      assert.equal((await visible()).rows.length,1);
    });
    await test('Storage insertion, deletion and moves cannot cross the school bucket boundary',async()=>{
      await asRole(db,'authenticated',async()=>{
        await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('school-assignment-files',$1)",[ids.otherStudent+'/forged.txt']),/row-level security/);
        await db.query("insert into storage.objects(bucket_id,name) values('school-assignment-files',$1)",[ids.student+'/own.txt']);
        assert.equal((await db.query("delete from storage.objects where bucket_id='school-assignment-files' and name=$1 returning id",[ids.otherStudent+'/private.txt'])).rows.length,0);
        await assert.rejects(()=>db.query("update storage.objects set bucket_id='school-assignment-files',name=$1 where bucket_id='assignment-files'",[ids.student+'/moved.txt']),/row-level security/);
        assert.equal((await db.query("update storage.objects set name='modified.txt' where bucket_id='school-assignment-files' returning id")).rows.length,0);
      },ids.student);
      assert.equal((await db.query('select count(*)::int count from storage.objects where id=$1',[uuid(5002)])).rows[0].count,1);
    });
    await test('School access removal rejects every browser role, nonmanager actor and manager/self targets',async()=>{
      for(const role of ['anon','authenticated'])await asRole(db,role,()=>assert.rejects(()=>call(db,'remove_profile_access',{p_user:ids.removable,p_actor:ids.manager}),/permission denied/),ids.manager,'aal2');
      for(const args of [{p_user:ids.removable,p_actor:ids.teacher},{p_user:ids.manager,p_actor:ids.manager},{p_user:ids.manager,p_actor:ids.student},{p_user:ids.examOnly,p_actor:ids.manager}])await asRole(db,'service_role',()=>assert.rejects(()=>call(db,'remove_profile_access',args),/ACCESS_DENIED/));
    });
    await test('Removing school access preserves shared Auth, password and old exam ownership',async()=>{
      const connected=await connect(db,ids.removable),beforeRemoval=await snapshot(db);
      // An ordinary populated account must still be removable. These records
      // have NO ACTION profile FKs, so DELETE would fail and leave access live.
      await db.query("insert into school.notifications(user_id,type,title,dedup_key) values($1,'fixture','Existing history','removal-history')",[ids.removable]);
      await asRole(db,'service_role',()=>call(db,'remove_profile_access',{p_user:ids.removable,p_actor:ids.manager}));
      assert.deepEqual(await snapshot(db),beforeRemoval);
      assert.equal((await db.query('select active from school.profiles where id=$1',[ids.removable])).rows[0].active,false);
      assert.equal((await db.query('select count(*)::int count from school.notifications where user_id=$1',[ids.removable])).rows[0].count,1);
      assert.equal((await api(db,connected.access)).error,'invalid_token');
      assert.equal((await op(db,'refresh',{client_id:client,refresh_hash:connected.refresh,access_hash:hash('removed-access'),next_refresh_hash:hash('removed-refresh')})).error,'invalid_grant');
      assert.equal((await db.query("select user_id from school.audit_logs where action='SCHOOL_ACCESS_REMOVED'")).rows[0].user_id,ids.manager);
      assert.equal((await asRole(db,'authenticated',()=>db.query('select * from public.exams'),ids.removable)).rows.length,1);
    });
    await test('A second installation fails before changing any existing object',async()=>{
      const beforeRetry=await snapshot(db);await assert.rejects(()=>db.exec(installation.sql),/SCHOOL_INSTALL_NOT_EMPTY/);await db.exec('rollback');assert.deepEqual(await snapshot(db),beforeRetry);
    });
  } finally {await db.close();}
}

await test('A late SQL failure rolls back the whole installation including Storage and Auth triggers',async()=>{
  const db=await setup();try{
    const before=await snapshot(db);
    await assert.rejects(()=>db.exec(installation.sql.replace(/commit;\s*$/,'select school.missing_install_guard();\ncommit;')),/does not exist/);await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int count from pg_namespace where nspname in ('school','school_private','school_oauth')")).rows[0].count,0);
    assert.deepEqual(await snapshot(db),before);
    assert.equal((await db.query("select count(*)::int count from storage.buckets where id='school-assignment-files'")).rows[0].count,0);
  }finally{await db.close();}
});
await test('Shared name collisions fail before application objects are created',async()=>{
  const db=await setup();try{
    await db.exec("insert into storage.buckets(id,name,public) values('school-assignment-files','unrelated',true)");
    await assert.rejects(()=>db.exec(installation.sql),/SCHOOL_INSTALL_SHARED_NAME_COLLISION/);await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int count from pg_namespace where nspname='school'")).rows[0].count,0);
  }finally{await db.close();}
});
await test('Missing pgcrypto and incompatible native Auth fail before installation',async()=>{
  for(const fault of ['drop extension pgcrypto','alter table auth.sessions drop column not_after','drop function auth.role()']) {
    const db=await setup();try{
      await db.exec(fault);
      await assert.rejects(()=>db.exec(installation.sql),/SCHOOL_INSTALL_REQUIRES_PGCRYPTO|SCHOOL_INSTALL_NATIVE_AUTH_VERSION_UNSUPPORTED|SCHOOL_INSTALL_REQUIRES_NATIVE_AUTH_STORAGE/);await db.exec('rollback');
      assert.equal((await db.query("select count(*)::int count from pg_namespace where nspname='school'")).rows[0].count,0);
    }finally{await db.close();}
  }
});
await test('An edited input migration cannot emit an unreviewed installation artifact',async()=>{
  const directory=await mkdtemp('/tmp/system-schema-isolation-');try{
    for(const source of sources){const dest=path.join(directory,source.file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,await readFile(source.file));}
    await writeFile(path.join(directory,sources.at(-1).file),(await readFile(sources.at(-1).file,'utf8'))+'\n-- Changed without review\n');
    await assert.rejects(()=>generateSchoolInstallation({root:directory}),/Unreviewed migration source/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
await test('The additive manager-session migration works with the original public installation',async()=>{
  const db=await database();try{
    await seed(db);await migrate(db);const nativeSessions=await seedOAuthSessions(db);
    await db.exec(await readFile('supabase/migrations/20261009_manager_session_guard.sql','utf8'));
    const check=(user=publicIds.manager,session=nativeSessions[publicIds.manager].session_id)=>asRole(db,'service_role',()=>call(db,'assert_manager_session',{p_user:user,p_session:session},'public'));
    assert.equal(await check(),true);
    await db.query("update auth.sessions set aal='aal1' where id=$1",[nativeSessions[publicIds.manager].session_id]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
    await db.query("update auth.sessions set aal='aal2' where id=$1",[nativeSessions[publicIds.manager].session_id]);
    await db.query('delete from auth.mfa_factors where id=$1',[nativeSessions[publicIds.manager].factor_id]);await assert.rejects(()=>check(),/MFA_REQUIRED/);
    for(const role of ['anon','authenticated'])await asRole(db,role,()=>assert.rejects(()=>call(db,'assert_manager_session',{p_user:publicIds.manager,p_session:nativeSessions[publicIds.manager].session_id},'public'),/permission denied/),publicIds.manager,'aal2');
  }finally{await db.close();}
});
console.log(`School schema isolation: ${passed} checks passed with actual PostgreSQL/PGlite; existing application preserved.`);
