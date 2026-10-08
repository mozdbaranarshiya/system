import { readFile, readdir } from 'node:fs/promises';
export const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const ids={manager:uuid(1),teacher:uuid(2),otherTeacher:uuid(3),student:uuid(4),classmate:uuid(5),otherStudent:uuid(6),initial:uuid(7),class:uuid(10),otherClass:uuid(11),grade:uuid(20),subject:uuid(30),otherSubject:uuid(31)};
export async function seed(db){
  for(const [n,name,role] of [[1,'مدیر آزمون','manager'],[2,'دبیر ریاضی','teacher'],[3,'دبیر علوم','teacher'],[4,'دانش‌آموز یک','student'],[5,'دانش‌آموز دو','student'],[6,'دانش‌آموز محرمانه','student'],[7,'رمز اولیه','student']]){
    const nid=String(n).padStart(10,'0');
    await db.query("insert into auth.users(id,email,encrypted_password) values($1,$2,crypt($3,gen_salt('bf')))",[uuid(n),nid+'@school.local',n===7?nid:'StrongPassword123!']);
    await db.query('insert into public.profiles(id,national_id,full_name,role) values($1,$2,$3,$4)',[uuid(n),nid,name,role]);
  }
  await db.query("insert into grade_levels(id,title) values($1,'پایه هفتم')",[ids.grade]);
  await db.query("insert into classes(id,grade_id,title,academic_year) values($1,$3,'هفتم الف','1405-1406'),($2,$3,'هفتم ب','1405-1406')",[ids.class,ids.otherClass,ids.grade]);
  await db.query("insert into subjects(id,grade_id,title) values($1,$3,'ریاضی'),($2,$3,'علوم')",[ids.subject,ids.otherSubject,ids.grade]);
  await db.query('insert into teacher_assignments(teacher_id,class_id,subject_id) values($1,$3,$5),($2,$4,$6)',[ids.teacher,ids.otherTeacher,ids.class,ids.otherClass,ids.subject,ids.otherSubject]);
  await db.query('insert into class_students(class_id,student_id) values($1,$3),($1,$4),($2,$5),($1,$6)',[ids.class,ids.otherClass,ids.student,ids.classmate,ids.otherStudent,ids.initial]);
  await db.query("insert into scores(student_id,class_id,subject_id,period,continuous_score,final_score) values($1,$2,$3,'نوبت اول',14,18),($1,$2,$3,'نوبت دوم',18,20)",[ids.student,ids.class,ids.subject]);
  await db.query('insert into class_representatives(class_id,student_id) values($1,$2)',[ids.class,ids.student]);
  await db.query('insert into discipline_scores(class_id,student_id,score,updated_by) values($1,$2,1,$2)',[ids.class,ids.student]);
  await db.query("insert into student_groups(id,teacher_id,class_id,subject_id,name,leader_id) values($1,$2,$3,$4,'گروه قدیمی',$5)",[uuid(40),ids.teacher,ids.class,ids.subject,ids.student]);
  await db.query('insert into student_group_members(group_id,student_id) values($1,$2),($1,$3)',[uuid(40),ids.student,ids.classmate]);
  await db.query("insert into group_score_fields(id,group_id,title,max_score) values($1,$2,'همکاری',5)",[uuid(41),uuid(40)]);
  await db.query('insert into group_score_entries(field_id,student_id,score,submitted_by) values($1,$2,3,$3)',[uuid(41),ids.classmate,ids.student]);
  await db.query("insert into assignments(id,teacher_id,class_id,subject_id,title,due_at) values($1,$2,$3,$4,'تکلیف قدیمی',now()+interval '6 hours')",[uuid(42),ids.teacher,ids.class,ids.subject]);
  await db.query("insert into announcements(id,created_by,title,body,target_type,target_class_id) values($1,$2,'اطلاعیه قدیمی','متن قدیمی','class',$3)",[uuid(43),ids.teacher,ids.class]);
}
export async function migrate(db){for(const file of (await readdir('supabase/migrations')).filter(f=>f.startsWith('20261002_')).sort())await db.exec(await readFile('supabase/migrations/'+file,'utf8'));}
// Mock Auth state for PGlite/HTTP fixture suites. Real Auth tests import current
// sessions/factors from isolated GoTrue instead of using this helper.
export async function seedOAuthSessions(db){
 const sessions={};
 const users=(await db.query('select u.id,p.role from auth.users u join profiles p on p.id=u.id order by u.id')).rows;
 for(const [index,user] of users.entries()){
  const session_id=uuid(8000+index),factor_id=user.role==='manager'?uuid(9000+index):null;
  if(factor_id)await db.query("insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp') on conflict(id) do nothing",[factor_id,user.id]);
  await db.query('insert into auth.sessions(id,user_id,aal,factor_id) values($1,$2,$3,$4) on conflict(id) do nothing',[session_id,user.id,factor_id?'aal2':'aal1',factor_id]);
  sessions[user.id]={session_id,factor_id};
 }
 return sessions;
}
export async function asUser(db,user,fn,aal='aal2'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated',aal})]);await db.exec('set role authenticated');
  try{return await fn();}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claims','{}',false)");}
}
export async function rpc(db,name,args={}){
const entries=Object.entries(args);const result=await db.query(`select public.${name}(${entries.map(([key],i)=>key+'=> $'+(i+1)).join(',')}) as value`,entries.map(([key,value])=>Array.isArray(value)&&['p_fields','p_keys'].includes(key)&&name!=='create_school_form'?'{'+value.join(',')+'}':typeof value==='object'&&value!==null?JSON.stringify(value):value));return result.rows[0].value;}
