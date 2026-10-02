import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{...headers,"Content-Type":"application/json"}});
function key(modern:string,legacy:string){
  const raw=Deno.env.get(modern);
  if(raw){try{const keys=JSON.parse(raw);return String(keys.default||Object.values(keys)[0]);}catch{/* legacy below */}}
  const value=Deno.env.get(legacy);if(!value)throw new Error("UNAUTHORIZED");return value;
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return response({ok:false,error:"INVALID_DATA"});
  try{
    const url=Deno.env.get("SUPABASE_URL")!;
    const publicKey=key("SUPABASE_PUBLISHABLE_KEYS","SUPABASE_ANON_KEY");
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
    const caller=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
    const admin=createClient(url,key("SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:user,error:authError}=await caller.auth.getUser(token);
    if(authError||!user.user)throw new Error("UNAUTHORIZED");
    const {data:profile,error:profileError}=await admin.from("profiles").select("id,role,active,national_id").eq("id",user.user.id).single();
    if(profileError||!profile?.active)throw new Error("UNAUTHORIZED");
    if(profile.role==="manager"){
      const {data,error}=await caller.auth.mfa.getAuthenticatorAssuranceLevel(token);
      if(error||data?.currentLevel!=="aal2")throw new Error("MFA_REQUIRED");
    }
    const body=await req.json();
    const current=String(body.current_password||""),password=String(body.new_password||"");
    if(password.length<8||password===current||password===profile.national_id||password.length>128)throw new Error("WEAK_PASSWORD");
    const verifier=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:verified,error:verifyError}=await verifier.auth.signInWithPassword({email:user.user.email!,password:current});
    if(verifyError||verified.user?.id!==user.user.id)throw new Error("WRONG_PASSWORD");
    // Revoke the temporary verification session; retain the user's existing session.
    await verifier.auth.signOut({scope:"local"});
    const {error:updateError}=await admin.auth.admin.updateUserById(user.user.id,{password});
    if(updateError)throw new Error("PASSWORD_UPDATE_FAILED");
    const {error:flagError}=await admin.rpc("apply_profile_patch",{p_user:user.user.id,p_actor:user.user.id,p_patch:{must_change_password:false,password_changed_at:new Date().toISOString()}});
    if(flagError)throw new Error("PASSWORD_UPDATE_FAILED");
    return response({ok:true});
  }catch(error){
    const code=error instanceof Error?error.message:"UNAUTHORIZED";
    return response({ok:false,error:["UNAUTHORIZED","MFA_REQUIRED","WEAK_PASSWORD","WRONG_PASSWORD"].includes(code)?code:"PASSWORD_UPDATE_FAILED"});
  }
});
