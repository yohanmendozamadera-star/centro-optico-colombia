import { createClient } from "npm:@supabase/supabase-js@2.76.1";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const secret=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Falta configurar el secreto ${name}`);return value;};
const boldBase="https://integrations.api.bold.co";

async function boldRequest(path:string,key:string,init:RequestInit={}){
  const response=await fetch(`${boldBase}${path}`,{...init,headers:{Authorization:`x-api-key ${key}`,"Content-Type":"application/json",...(init.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||(Array.isArray(payload?.errors)&&payload.errors.length)){
    const message=payload?.errors?.map((x:any)=>x?.message||x?.description||String(x)).join(" · ")||payload?.message||`Bold respondió ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try{
    const authorization=req.headers.get("Authorization");
    if(!authorization)return json({error:"Sesión requerida"},401);
    const supabaseUrl=secret("SUPABASE_URL"),anonKey=secret("SUPABASE_ANON_KEY"),serviceKey=secret("SUPABASE_SERVICE_ROLE_KEY");
    const authClient=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const {data:{user},error:userError}=await authClient.auth.getUser();
    if(userError||!user)return json({error:"Sesión inválida"},401);
    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
    const {data:profile}=await admin.from("perfiles").select("roles(nombre)").eq("id",user.id).maybeSingle();
    const role=(profile as any)?.roles?.nombre;
    if(!["Propietario","Superadministrador"].includes(role))return json({error:"Solo el propietario puede gestionar la suscripción"},403);

    const body=await req.json().catch(()=>({})),action=String(body?.accion||""),chargeId=String(body?.cobro_id||"");
    if(!chargeId)return json({error:"Falta identificar el cobro"},400);
    const [{data:charge,error:chargeError},{data:config,error:configError}]=await Promise.all([
      admin.from("cobros_suscripcion").select("*").eq("id",chargeId).single(),
      admin.from("configuracion_suscripcion").select("*").eq("id",true).single(),
    ]);
    if(chargeError||!charge)return json({error:"Cobro no encontrado"},404);
    if(configError||!config)return json({error:"Configuración de suscripción incompleta"},409);
    const testMode=config.ambiente!=="produccion",identityKey=secret(testMode?"BOLD_IDENTITY_KEY_TEST":"BOLD_IDENTITY_KEY");

    if(action==="crear_enlace"){
      if(charge.estado==="pagado")return json({ok:true,estado:"pagado",url:null});
      if(charge.bold_link&&charge.bold_referencia)return json({ok:true,estado:charge.estado,url:charge.bold_link,payment_link:charge.bold_referencia,ambiente:testMode?"pruebas":"produccion"});
      const expiry=new Date(`${charge.fecha_vencimiento}T23:59:59-05:00`);expiry.setDate(expiry.getDate()+Number(config.dias_gracia||10));
      const reference=String(charge.referencia).replace(/[^A-Za-z0-9_-]/g,"-").slice(0,60);
      const payload=await boldRequest("/online/link/v1",identityKey,{method:"POST",body:JSON.stringify({
        amount_type:"CLOSE",
        amount:{currency:"COP",total_amount:Number(charge.valor),tip_amount:0},
        reference,
        description:String(charge.concepto).slice(0,100),
        expiration_date:expiry.getTime()*1e6,
        callback_url:Deno.env.get("APP_URL")||"https://centroopticodecolombia.com/",
        payer_email:charge.correo_cliente,
      })});
      const paymentLink=payload?.payload?.payment_link,url=payload?.payload?.url;
      if(!paymentLink||!url)throw new Error("Bold no devolvió un enlace de pago válido");
      const {error:updateError}=await admin.from("cobros_suscripcion").update({bold_link:url,bold_referencia:paymentLink,bold_entorno:testMode?"pruebas":"produccion",updated_at:new Date().toISOString()}).eq("id",charge.id);
      if(updateError)throw updateError;
      return json({ok:true,estado:charge.estado,url,payment_link:paymentLink,ambiente:testMode?"pruebas":"produccion"});
    }

    if(action==="consultar_estado"){
      if(!charge.bold_referencia)return json({error:"El cobro todavía no tiene enlace de Bold"},409);
      const payload=await boldRequest(`/online/link/v1/${encodeURIComponent(charge.bold_referencia)}`,identityKey);
      const result=payload?.payload||payload,status=String(result?.status||"").toUpperCase();
      const mapped=status==="PAID"?"pagado":status==="EXPIRED"?"vencido":["REJECTED","CANCELLED"].includes(status)?"fallido":charge.estado;
      const update:any={estado:mapped,bold_transaccion:result?.transaction_id||charge.bold_transaccion,metodo_pago:result?.payment_method||charge.metodo_pago,updated_at:new Date().toISOString()};
      if(mapped==="pagado")update.pagado_at=new Date().toISOString();
      const {error:updateError}=await admin.from("cobros_suscripcion").update(update).eq("id",charge.id);if(updateError)throw updateError;
      if(mapped==="pagado"){
        await Promise.all([
          admin.from("configuracion_suscripcion").update({estado:"activa",updated_at:new Date().toISOString()}).eq("id",true),
          admin.from("notificaciones_suscripcion").update({estado:"omitida",updated_at:new Date().toISOString()}).eq("cobro_id",charge.id).eq("estado","programada"),
        ]);
      }
      return json({ok:true,estado:mapped,bold_estado:status,ambiente:testMode?"pruebas":"produccion"});
    }
    return json({error:"Acción no reconocida"},400);
  }catch(error){return json({error:error instanceof Error?error.message:"Error inesperado al conectar con Bold"},500);}
});
