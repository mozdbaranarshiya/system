import {asUser,rpc} from './fixtures.mjs';
export function adapter(db){
const identifier=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw new Error('Invalid test identifier');return '"'+x+'"';};
async function query(body){
return asUser(db,body.user,async()=>{
if(body.rpc)return {data:await rpc(db,body.rpc,body.args),error:null};
const table=identifier(body.table),params=[],param=value=>{params.push(typeof value==='object'&&value!==null?JSON.stringify(value):value);return '$'+params.length;};
const filters=(prefix='t.')=>(body.filters||[]).map(f=>{const col=prefix+identifier(f.column);if(f.op==='in')return f.value.length?col+' in ('+f.value.map(param).join(',')+')':'false';if(f.op==='is'&&f.value===null)return col+' is null';return col+' '+(['=','<>','>','>=','<','<='].includes(f.op)?f.op:'=')+' '+param(f.value);});
if(body.action){
let sql;
if(body.action==='update'){const fields=Object.entries(body.payload).map(([key,value])=>identifier(key)+'='+param(value));const clauses=filters('');sql='update public.'+table+' set '+fields.join(',')+(clauses.length?' where '+clauses.join(' and '):'')+' returning to_jsonb('+table+') row';}
else if(body.action==='delete'){const clauses=filters('');sql='delete from public.'+table+(clauses.length?' where '+clauses.join(' and '):'')+' returning to_jsonb('+table+') row';}
else {const payload=Array.isArray(body.payload)?body.payload:[body.payload],keys=Object.keys(payload[0]);sql='insert into public.'+table+'('+keys.map(identifier).join(',')+') values '+payload.map(row=>'('+keys.map(k=>param(row[k])).join(',')+')').join(',');if(body.action==='upsert')sql+=' on conflict('+body.conflict.split(',').map(identifier).join(',')+') do update set '+keys.map(k=>identifier(k)+'=excluded.'+identifier(k)).join(',');sql+=' returning to_jsonb('+table+') row';}
const r=await db.query(sql,params),rows=r.rows.map(x=>x.row);return {data:body.single?rows[0]||null:rows,error:null};
}
let source='public.'+table+' t',projection='to_jsonb(t)';
if(body.table==='timetable_entries'&&body.columns?.includes('school_periods(')){source+=' left join public.school_periods rel on rel.id=t.period_id';projection+="||jsonb_build_object('school_periods',to_jsonb(rel))";}
if(body.table==='appointments'&&body.columns?.includes('appointment_slots(')){source+=' left join public.appointment_slots rel on rel.id=t.slot_id';projection+="||jsonb_build_object('appointment_slots',to_jsonb(rel))";}
const clauses=filters(),where=clauses.length?' where '+clauses.join(' and '):'',orders=(body.orders||[]).map(o=>'t.'+identifier(o.column)+(o.ascending?' asc':' desc'));
const count=body.count?(await db.query('select count(*)::int n from '+source+where,params)).rows[0].n:undefined;
if(body.head)return {data:null,count,error:null};
const r=await db.query('select '+projection+' row from '+source+where+(orders.length?' order by '+orders.join(','):'')+' limit '+Math.min(body.limit||1000,1000)+' offset '+(body.offset||0),params);
const rows=r.rows.map(x=>x.row);if(body.single&&!body.optional&&rows.length!==1)return {error:{message:'No single row'}};
return {data:body.single?rows[0]||null:rows,count,error:null};
});}

let queue=Promise.resolve();
return body=>{const job=queue.then(()=>query(body));queue=job.catch(()=>{});return job;};
}
