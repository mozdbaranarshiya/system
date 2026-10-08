import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
// Verified byte-for-byte against the official cdn.sheetjs.com 0.20.3 release
// and git.sheetjs.com/sheetjs/sheetjs tag v0.20.3 (8a7cfd47bde8258c0d91df6a737bf0136699cdf8).
const SHEETJS_SHA256='cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
const SHEETJS_URL='https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/dist/xlsx.full.min.js';
const runFile=promisify(execFile);
export async function loadPinnedSheetJS(){
  const cache=process.env.SHEETJS_TEST_PATH||'test-results/xlsx.full.min.js';let bytes;
  try{bytes=await readFile(cache);}catch(error){
    if(error.code!=='ENOENT')throw error;
    if(process.env.SHEETJS_TEST_PATH)throw new Error('SHEETJS_TEST_PATH must name an existing SheetJS 0.20.3 file.');
    try{
      const response=await fetch(SHEETJS_URL,{signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw new Error('SheetJS download failed: HTTP '+response.status);
      bytes=Buffer.from(await response.arrayBuffer());
    }catch{
      // curl uses the machine's existing HTTPS proxy and system TLS trust.
      // Never disable TLS verification or accept a different release/hash.
      ({stdout:bytes}=await runFile('curl',['--fail','--silent','--show-error','--max-time','30','--proto','=https','--proto-redir','=https','--location',SHEETJS_URL],{encoding:'buffer',maxBuffer:2*1024*1024}));
    }
    assert.equal(createHash('sha256').update(bytes).digest('hex'),SHEETJS_SHA256,'Downloaded SheetJS 0.20.3 failed SHA-256 verification.');
    await mkdir(path.dirname(cache),{recursive:true});await writeFile(cache,bytes);
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'),SHEETJS_SHA256,'Cached SheetJS 0.20.3 failed SHA-256 verification.');
  return bytes.toString('utf8');
}

async function testExport(){
await mkdir('test-results',{recursive:true});
const source=await loadPinnedSheetJS();
const ctx={window:{SystemCore:{state:{},$:()=>{},esc:String}},console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Buffer};vm.createContext(ctx);vm.runInContext(source,ctx);
const XLSX=ctx.XLSX;assert.equal(XLSX.version,'0.20.3');let workbook,filename;XLSX.writeFile=(book,file)=>{workbook=book;filename=file;};ctx.window.SystemCore.ensureSheetJS=async()=>XLSX;
ctx.window.SchoolV7={routes:{}};vm.runInContext(await readFile('js/reports.js','utf8'),ctx);
await ctx.window.SchoolV7.exportRows(['نام','کد ملی','نمره'],[['دانش‌آموز','0012345678',0]],'آزمون');assert.match(filename,/\.xlsx$/);assert.equal(workbook.Workbook.Views[0].RTL,true);
const bytes=XLSX.write(workbook,{bookType:'xlsx',type:'buffer',compression:true});assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
const reopened=XLSX.read(bytes,{type:'buffer'}),sheet=reopened.Sheets['گزارش'];assert.equal(sheet.A1.v,'نام');assert.equal(sheet.B1.v,'کد ملی');assert.equal(sheet.C1.v,'نمره');assert.equal(sheet.A2.v,'دانش‌آموز');assert.equal(sheet.B2.t,'s');assert.equal(sheet.B2.v,'0012345678');assert.equal(sheet.C2.t,'n');assert.equal(sheet.C2.v,0);
const zip=XLSX.CFB.read(bytes,{type:'buffer'}),view=zip.FullPaths.findIndex(p=>p.endsWith('xl/worksheets/sheet1.xml'));assert.match(Buffer.from(zip.FileIndex[view].content).toString(),/rightToLeft="(?:1|true)"/);
await writeFile('test-results/verified-report.xlsx',bytes);console.log('Real XLSX export passed: ZIP workbook, Persian headers, RTL sheet, leading-zero ID, and numeric zero.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await testExport();
