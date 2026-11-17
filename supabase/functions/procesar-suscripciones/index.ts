import { createClient } from "npm:@supabase/supabase-js@2.76.1";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const env=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Falta configurar ${name}`);return value;};
const money=(value:number)=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(value);
const date=(value:string)=>new Intl.DateTimeFormat("es-CO",{dateStyle:"long",timeZone:"America/Bogota"}).format(new Date(`${value}T12:00:00-05:00`));
const escape=(value:unknown)=>String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]||c));

async function ensureBoldLink(admin:any,charge:any,config:any){
  if(charge.bold_link)return charge;
  const testMode=config.ambiente!=="produccion",identityKey=env(testMode?"BOLD_IDENTITY_KEY_TEST":"BOLD_IDENTITY_KEY");
  const expiry=new Date(`${charge.fecha_vencimiento}T23:59:59-05:00`);expiry.setDate(expiry.getDate()+Number(config.dias_gracia||10));
  const response=await fetch("https://integrations.api.bold.co/online/link/v1",{method:"POST",headers:{Authorization:`x-api-key ${identityKey}`,"Content-Type":"application/json"},body:JSON.stringify({
    amount_type:"CLOSE",amount:{currency:"COP",total_amount:Number(charge.valor),tip_amount:0},reference:String(charge.referencia).replace(/[^A-Za-z0-9_-]/g,"-").slice(0,60),description:String(charge.concepto).slice(0,100),expiration_date:expiry.getTime()*1e6,callback_url:Deno.env.get("APP_URL")||"https://centroopticodecolombia.com/",payer_email:charge.correo_cliente,
  })});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const detail=Array.isArray(payload?.errors)?payload.errors.map((x:any)=>x?.message||x?.description||JSON.stringify(x)).filter(Boolean).join(" · "):payload?.errors?JSON.stringify(payload.errors):payload?.message||JSON.stringify(payload);
    throw new Error(`Bold respondió ${response.status}${detail?`: ${String(detail).slice(0,600)}`:""}`);
  }
  const paymentLink=payload?.payload?.payment_link,url=payload?.payload?.url;if(!paymentLink||!url)throw new Error("Bold no devolvió un enlace de pago válido");
  const {error}=await admin.from("cobros_suscripcion").update({bold_link:url,bold_referencia:paymentLink,bold_entorno:testMode?"pruebas":"produccion",updated_at:new Date().toISOString()}).eq("id",charge.id);if(error)throw error;
  return {...charge,bold_link:url,bold_referencia:paymentLink,bold_entorno:testMode?"pruebas":"produccion"};
}

async function sendEmail(notification:any,charge:any){
  const apiKey=env("RESEND_API_KEY"),fromEmail=env("RESEND_FROM_EMAIL"),fromName=env("RESEND_FROM_NAME"),replyTo=env("RESEND_REPLY_TO");
  const isGenerated=notification.tipo==="cobro_generado",isRestricted=notification.tipo==="restriccion";
  const subject=isGenerated?`Nuevo cobro de suscripción ${charge.referencia}`:isRestricted?"Acceso restringido por pago pendiente":`Recordatorio de pago ${charge.referencia}`;
  const heading=isGenerated?"Se generó su cobro mensual":isRestricted?"El pago continúa pendiente":"Recordatorio de pago pendiente";
  const message=isGenerated
    ?`Ya está disponible el detalle correspondiente al periodo del ${date(charge.periodo_desde)} al ${date(charge.periodo_hasta)}.`
    :isRestricted
      ?"Finalizó el periodo de gracia de 10 días. Los módulos de agendamiento y ventas permanecerán restringidos hasta confirmar el pago."
      :`Aún no se registra el pago con vencimiento del ${date(charge.fecha_vencimiento)}.`;
  const button=charge.bold_link?`<p style="margin:28px 0"><a href="${escape(charge.bold_link)}" style="background:#8f1598;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Pagar con Bold</a></p>`:"";
  const html=`<!doctype html><html><body style="margin:0;background:#f5f2f7;font-family:Arial,sans-serif;color:#21172a"><div style="max-width:620px;margin:32px auto;background:#fff;border-radius:18px;overflow:hidden"><div style="background:#430b45;color:#fff;padding:24px 30px"><strong>Centro Óptico de Colombia Group</strong></div><div style="padding:30px"><h1 style="font-size:24px">${heading}</h1><p>${message}</p><div style="background:#faf7fb;border:1px solid #eadfec;border-radius:12px;padding:18px"><p><b>Concepto:</b> ${escape(charge.concepto)}</p><p><b>Valor:</b> ${money(Number(charge.valor))}</p><p><b>Referencia:</b> ${escape(charge.referencia)}</p></div>${button}<p style="font-size:13px;color:#6d6272">Si ya realizó el pago, puede ignorar este mensaje.</p></div></div></body></html>`;
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json","Idempotency-Key":`suscripcion/${notification.id}`},body:JSON.stringify({from:`${fromName} <${fromEmail}>`,to:[charge.correo_cliente],reply_to:replyTo,subject,html})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload?.message||`Resend respondió ${response.status}`);
  return payload?.id;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try{
    const supplied=req.headers.get("x-cron-secret"),cronSecret=Deno.env.get("SUBSCRIPTION_CRON_SECRET");
    if(!cronSecret||supplied!==cronSecret)return json({error:"Solicitud no autorizada"},401);
    const admin=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false}});
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const [{data:rows,error},{data:config,error:configError}]=await Promise.all([
      admin.from("notificaciones_suscripcion").select("*,cobros_suscripcion(*)").in("estado",["programada","error"]).lte("fecha_programada",today).order("fecha_programada"),
      admin.from("configuracion_suscripcion").select("*").eq("id",true).single(),
    ]);
    if(error)throw error;
    if(configError||!config)throw new Error("La configuración de suscripción está incompleta");
    const results=[];
    for(const notification of rows||[]){
      let charge=(notification as any).cobros_suscripcion;
      if(!charge||charge.estado==="pagado"||charge.estado==="anulado"){
        await admin.from("notificaciones_suscripcion").update({estado:"omitida",updated_at:new Date().toISOString()}).eq("id",notification.id);
        results.push({id:notification.id,estado:"omitida"});continue;
      }
      try{
        charge=await ensureBoldLink(admin,charge,config);
        const emailId=await sendEmail(notification,charge);
        await admin.from("notificaciones_suscripcion").update({estado:"enviada",enviada_at:new Date().toISOString(),intentos:Number(notification.intentos||0)+1,ultimo_error:null,updated_at:new Date().toISOString()}).eq("id",notification.id);
        if(notification.tipo==="restriccion")await admin.from("configuracion_suscripcion").update({estado:"restringida",updated_at:new Date().toISOString()}).eq("id",true);
        results.push({id:notification.id,estado:"enviada",email_id:emailId});
      }catch(sendError){
        const message=sendError instanceof Error?sendError.message:"No se pudo enviar el correo";
        await admin.from("notificaciones_suscripcion").update({estado:"error",intentos:Number(notification.intentos||0)+1,ultimo_error:message,updated_at:new Date().toISOString()}).eq("id",notification.id);
        results.push({id:notification.id,estado:"error",error:message});
      }
    }
    return json({ok:true,fecha:today,procesadas:results.length,resultados:results});
  }catch(error){return json({error:error instanceof Error?error.message:"Error inesperado"},500);}
});
