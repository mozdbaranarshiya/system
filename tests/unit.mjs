import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import vm from 'node:vm';
const context={window:{SystemCore:{state:{},$:()=>{},esc:String,toEnDigits:value=>String(value).replace(/[۰-۹]/g,d=>'0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])}},Intl,Date,Map,Object,clearInterval};
vm.createContext(context);await vm.runInContext(await readFile('js/core.js','utf8'),context);await vm.runInContext(await readFile('js/reports.js','utf8'),context);
const V=context.window.SchoolV7;
for(const [fa,en] of [['۱۴۰۵/۰۷/۱۰','2026-10-02'],['1404/01/01','2025-03-21'],['1403/12/30','2025-03-20']])assert.equal(V.gregorian(fa),en);
assert.throws(()=>V.gregorian('1404/12/30'));assert.throws(()=>V.gregorian('1405/13/01'));
const report=V.reportData({scores:[{subject_id:'math',period:'نوبت اول',lesson_score:16},{subject_id:'math',period:'نوبت دوم',lesson_score:19},{subject_id:'science',period:'نوبت اول',lesson_score:0},{subject_id:'science',period:'نوبت دوم',lesson_score:null}]});
assert.equal(report.first,8);assert.equal(report.second,19);assert.equal(report.annual,17.5);assert.equal(report.rows[1].annual,null);
const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));assert.equal(manifest.dir,'rtl');assert.equal(manifest.lang,'fa');
for(const [file,size] of [['favicon-16x16.png',16],['favicon-32x32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
const bytes=await readFile('assets/icons/'+file);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
const ico=await readFile('assets/icons/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
const html=await readFile('index.html','utf8');for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))await readFile(match[1]);
for(const file of ['app.js','config.js',...(await readdir('js')).map(f=>'js/'+f)])assert.equal(/sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/.test(await readFile(file,'utf8')),false);
console.log('Unit checks passed: Jalali leap days, report averages, icon sizes, manifest paths, and public client configuration.');
