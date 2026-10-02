/* Local test adapter. Never loaded by index.html or included in production. */
(() => {
const user=window.__TEST_USER;
class Query {
  constructor(table){this.body={table,user,filters:[],orders:[]};}
  select(columns='*',options={}){Object.assign(this.body,{columns,...options});return this;}
  eq(column,value){this.body.filters.push({column,value,op:'='});return this;}
  neq(column,value){this.body.filters.push({column,value,op:'<>'});return this;}
  gt(column,value){this.body.filters.push({column,value,op:'>'});return this;}
  gte(column,value){this.body.filters.push({column,value,op:'>='});return this;}
  lt(column,value){this.body.filters.push({column,value,op:'<'});return this;}
  lte(column,value){this.body.filters.push({column,value,op:'<='});return this;}
  in(column,value){this.body.filters.push({column,value,op:'in'});return this;}
  is(column,value){this.body.filters.push({column,value,op:'is'});return this;}
  order(column,options={}){this.body.orders.push({column,ascending:options.ascending!==false});return this;}
  range(from,to){this.body.offset=from;this.body.limit=to-from+1;return this;}
  limit(limit){this.body.limit=limit;return this;}
  single(){this.body.single=true;return this;}
  maybeSingle(){this.body.single=true;this.body.optional=true;return this;}
  insert(payload){this.body.action='insert';this.body.payload=payload;return this;}
  update(payload){this.body.action='update';this.body.payload=payload;return this;}
  upsert(payload,options={}){this.body.action='upsert';this.body.payload=payload;this.body.conflict=options.onConflict;return this;}
  delete(){this.body.action='delete';return this;}
  then(resolve,reject){return fetch('/__db',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(this.body)}).then(r=>r.json()).then(resolve,reject);}
}
let signedOut=false,callback=()=>{};
window.supabase={createClient:()=>({
from:table=>new Query(table),rpc:(name,args)=>({then:(resolve,reject)=>fetch('/__db',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user,rpc:name,args})}).then(r=>r.json()).then(resolve,reject)}),
auth:{getSession:async()=>({data:{session:signedOut?null:{user:{id:user},access_token:'local-test-token'}}}),
onAuthStateChange:cb=>{callback=cb;},signOut:async()=>{signedOut=true;callback('SIGNED_OUT',null);return {};},
signInWithPassword:async()=>({data:{session:{user:{id:user},access_token:'local-test-token'}}}),
mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'}}),listFactors:async()=>({data:{totp:[{id:'local-factor',status:'verified'}]}})}},
functions:{invoke:async()=>({data:{ok:true}})},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'#'}})})}
})};
})();
