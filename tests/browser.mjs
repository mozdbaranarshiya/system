import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { database } from './database-setup.mjs';
import { seed,migrate,ids } from './fixtures.mjs';
import {adapter} from './adapter.mjs';
import {loadPinnedSheetJS} from './xlsx.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const sheetjsSource=await loadPinnedSheetJS();
const db=await database();await seed(db);await migrate(db);
// A populated period is required to exercise the visible mobile timetable.
const period=await db.query("insert into school_periods(title,period_order,start_time,end_time) values('زنگ اول آزمون',1,'08:00','09:00') returning id");
await db.query("insert into timetable_entries(class_id,subject_id,teacher_id,weekday,period_id,academic_year) values($1,$2,$3,$4,$5,'1405-1406')",[ids.class,ids.subject,ids.teacher,(new Date().getUTCDay()+1)%7,period.rows[0].id]);
const root=process.cwd(),query=adapter(db);
const server=http.createServer(async(req,res)=>{
try{
if(req.url==='/__db'){
let data='';for await(const chunk of req)data+=chunk;
const body=JSON.parse(data);const job=query(body);
try{res.setHeader('content-type','application/json');res.end(JSON.stringify(await job));}catch(error){res.end(JSON.stringify({error:{message:error.message,code:error.code},data:null}));}return;
}
const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+'/')){res.statusCode=403;res.end();return;}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/index.html';
await mkdir('test-results/tmp',{recursive:true});process.env.TMPDIR=path.resolve('test-results/tmp');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];let assertions=0;
async function session(user,viewport){
const context=await browser.newContext({viewport,timezoneId:'Asia/Tehran'});const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(value=>window.__TEST_USER=value,ids[user]);
await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'text/javascript',path:path.join(root,'tests/mock-supabase.js')}));
await page.route('https://*.supabase.co/**',route=>{errors.push('Unexpected live backend request');return route.abort();});
await page.route('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',route=>route.fulfill({contentType:'text/javascript',body:sheetjsSource}));
await page.goto(url);await page.waitForFunction(()=>window.SystemCore?.state.profile);return {context,page};}
async function navigate(page,route){await page.evaluate(route=>window.SystemCore.navigate(route),route);await page.waitForTimeout(80);assert.equal(await page.locator('#content .alert-warning').count(),0,'Route failed: '+route+' '+await page.locator('#content').textContent());assertions++;}
try{
const {context,page}=await session('manager',{width:1440,height:1000});
await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('برنامه امروز'));
for(const route of ['users','structure','assignments','scores','homeworkGrades','excel','announcements','settings','timetable','attendance','exams','question-bank','calendar','notifications','student-profile','behavior','forms','polls','extracurricular','appointments','reports','search','security','audit'])await navigate(page,route);
await navigate(page,'forms');await page.click('#newForm');assert.equal(await page.locator('#modal[open]').count(),1);await page.fill('#fTitle','فرم آزمون مرورگر');await page.fill('.field-label','نام تیم');await page.click('#modalSubmit');await page.waitForFunction(()=>!document.querySelector('#modal').open);assert.ok((await page.locator('#formList').textContent()).includes('فرم آزمون مرورگر'));assertions++;
await page.evaluate(id=>window.SchoolV7.focusStudent=id,ids.student);await navigate(page,'student-profile');await page.click('#profileReport');await page.waitForFunction(()=>document.querySelector('#pageTitle').textContent==='کارنامه تحصیلی');assert.ok((await page.locator('#content').textContent()).includes('۱۷.۵۰'));assertions++;
await page.screenshot({path:'test-results/desktop-report.png',fullPage:true});
await page.emulateMedia({media:'print'});await page.pdf({path:'test-results/report.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
const download=page.waitForEvent('download');await page.click('#exportSchoolReport');const file=await download;await file.saveAs('test-results/report.xlsx');assertions++;
assert.equal(await page.evaluate(()=>window.XLSX.version),'0.20.3');const exported=await readFile('test-results/report.xlsx');assert.equal(exported[0],0x50);assert.equal(exported[1],0x4b);assertions++;
await navigate(page,'dashboard');await page.screenshot({path:'test-results/desktop-dashboard.png',fullPage:true});await context.close();
const mobile=await session('student',{width:390,height:844});await mobile.page.waitForFunction(()=>document.querySelector('#content').textContent.includes('برنامه امروز'));
for(const route of ['report','homework','groups','announcements','teachers','objections','timetable','attendance','exams','calendar','notifications','student-profile','behavior','forms','polls','extracurricular','appointments','reports','search','security'])await navigate(mobile.page,route);
await navigate(mobile.page,'dashboard');const overflow=await mobile.page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);await mobile.page.screenshot({path:'test-results/mobile-dashboard.png',fullPage:true});assert.equal(overflow,false,'Mobile horizontal overflow');assertions++;
await navigate(mobile.page,'timetable');assert.equal(await mobile.page.locator('.v7-weekly').isVisible(),false);assert.equal(await mobile.page.locator('.v7-daily').isVisible(),true);assert.ok((await mobile.page.locator('.v7-daily').textContent()).includes('ریاضی'));assertions++;await mobile.context.close();
const initial=await session('initial',{width:390,height:844});assert.equal(await initial.page.locator('#passwordView').isVisible(),true);assert.equal(await initial.page.locator('#appView').isVisible(),false);assertions++;await initial.context.close();
assert.deepEqual(errors,[]);console.log(`Browser checks: ${assertions} passed; no JavaScript errors.`);
}catch(error){console.error('Browser check failed:',error.stack||error.message,errors);process.exitCode=1;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();}
