import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
const raw = await readFile("supabase/functions/school-login/index.ts","utf8");
const source = stripTypeScriptTypes(raw.replace(/^import .*;\r?\n/m,""));
let passed = 0;
async function call({ method="POST", origin="https://school.example", id="0000000004",
  password="GoodPassword", active=true, authId="school-user",
  storedEmail="u-someopaqueid@school.local", badDb=false }={}) {
  let handler, attempts=0;
  const admin = {
    from:table=>{
      assert.equal(table,"profiles");
      const q={select:()=>q,eq:()=>q,maybeSingle:async()=>
        ({data:badDb?null:{id:"school-user",active},error:badDb?{}:null})};
      return q;
    },
    auth:{admin:{getUserById:async()=>({data:{user:{email:storedEmail}},error:null})}},
  };
  const verifier={auth:{signInWithPassword:async args=>{
    attempts++;
    const valid=args.email===storedEmail && args.password==="GoodPassword";
    return {data:{user:valid?{id:authId}:null,session:valid?
      {access_token:"signed.access",refresh_token:"rotating.refresh"}:null},
      error:valid?null:{}};
  }}};
  vm.runInNewContext(source,{
    Deno:{env:{get:name=>({
      SCHOOL_LOGIN_ORIGIN:"https://school.example",
      SUPABASE_URL:"https://project.invalid",
      SUPABASE_ANON_KEY:"publishable",
      SUPABASE_SERVICE_ROLE_KEY:"service"
    })[name]},serve:cb=>handler=cb},
    createClient:(_url,key)=>key==="service"?admin:verifier,
    Request,Response,JSON,String,Number,Object,Promise,Error,
  });
  const headers={...(origin===null?{}:{Origin:origin}),"Content-Type":"application/json"};
  const res=await handler(new Request("https://project.invalid/school-login",{
    method,headers,...(method==="POST"?{body:JSON.stringify({national_id:id,password})}:{})
  }));
  const text=await res.text();
  return {status:res.status,data:text?JSON.parse(text):null,
    cors:res.headers.get("access-control-allow-origin"),attempts};
}
const good=await call();
assert.equal(good.status,200); passed++;
assert.equal(good.cors,"https://school.example"); passed++;
assert.deepEqual(good.data,{access_token:"signed.access",refresh_token:"rotating.refresh"}); passed++;
assert.equal(good.attempts,1); passed++;
for(const scenario of [
  {id:"not10digits"}, {password:"wrong"}, {active:false}, {authId:"other-user"}
]){
  const result=await call(scenario);
  assert.equal(result.status,401); passed++;
  assert.deepEqual(result.data,{error:"invalid_credentials"}); passed++;
}
const failed=await call({badDb:true});
assert.equal(failed.status,503); passed++;
assert.equal(failed.attempts,0); passed++;
for(const origin of [null,"https://other.example","http://school.example"]){
  const result=await call({origin});
  assert.equal(result.status,403); passed++;
  assert.equal(result.attempts,0); passed++;
}
const options=await call({method:"OPTIONS"});
assert.equal(options.status,204); passed++;
const get=await call({method:"GET"});
assert.equal(get.status,405); passed++;
console.log("Opaque-identity school login adapter tests:",passed,"passed (mocked Auth).");
