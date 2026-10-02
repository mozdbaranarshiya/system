import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
await mkdir('test-results',{recursive:true});
const cache=process.env.SHEETJS_TEST_PATH||'test-results/xlsx.full.min.js';let source;
try{source=await readFile(cache,'utf8');}catch{
const response=await fetch('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');if(!response.ok)throw new Error('Cannot load the pinned SheetJS test library');source=await response.text();await writeFile(cache,source);}
const ctx={window:{SystemCore:{state:{},$:()=>{},esc:String}},console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Buffer};vm.createContext(ctx);vm.runInContext(source,ctx);
const XLSX=ctx.XLSX;let workbook,filename;XLSX.writeFile=(book,file)=>{workbook=book;filename=file;};ctx.window.SystemCore.ensureSheetJS=async()=>XLSX;
ctx.window.SchoolV7={routes:{}};vm.runInContext(await readFile('js/reports.js','utf8'),ctx);
await ctx.window.SchoolV7.exportRows(['نام','کد ملی','نمره'],[['دانش‌آموز','0012345678',0]],'آزمون');assert.match(filename,/\.xlsx$/);assert.equal(workbook.Workbook.Views[0].RTL,true);
const bytes=XLSX.write(workbook,{bookType:'xlsx',type:'buffer',compression:true});assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
const reopened=XLSX.read(bytes,{type:'buffer'}),sheet=reopened.Sheets['گزارش'];assert.equal(sheet.B2.t,'s');assert.equal(sheet.B2.v,'0012345678');assert.equal(sheet.C2.t,'n');assert.equal(sheet.C2.v,0);
const zip=XLSX.CFB.read(bytes,{type:'buffer'}),view=zip.FullPaths.findIndex(p=>p.endsWith('xl/worksheets/sheet1.xml'));assert.match(Buffer.from(zip.FileIndex[view].content).toString(),/rightToLeft="(?:1|true)"/);
await writeFile('test-results/verified-report.xlsx',bytes);console.log('Real XLSX export passed: ZIP workbook, Persian headers, RTL sheet, leading-zero ID, and numeric zero.');
