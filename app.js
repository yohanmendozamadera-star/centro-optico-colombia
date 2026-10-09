import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPERADMIN_EMAIL } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentProfile = null;
let currentPermissions = new Set();
let patients = [];
let journeys = [];
let brigades = [];
let appointments = [];
let appointmentContextBrigade = null;
let patientCreatedFromAppointment = false;
let capturedPatientLocation = null;
let callGestures = [];
let callCenterJourneyId = "";
let attendanceBrigade = null;
let brigadeCrmFilter = "por_atender";
let callCenterCrmFilter = "todos";
let appointmentFromBrigadeModule = false;
let consultations = [];
let consultationAppointments = [];
let productCatalogs={materials:[],filters:[],treatments:[],tariffs:[]};
let saleConsultations=[];
let patientSearchTimer=null;

const clean = value => String(value || "").trim();
const toast = message => {
  const node = $("#toast"); node.textContent = message; node.classList.add("show");
  clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => node.classList.remove("show"), 2600);
};
const errorText = error => {
  const text = error?.message || "Ocurrió un error inesperado.";
  if (text.includes("Invalid login")) return "Correo o contraseña incorrectos.";
  if (text.includes("Email not confirmed")) return "Debes confirmar el correo antes de ingresar.";
  if (text.includes("schema cache")) return "La base de datos aún no está preparada. Ejecuta el archivo schema.sql en Supabase.";
  return text;
};
const todayValue = () => localDateValue(new Date());
const dateFilterKey = scope => `centroOptico.${scope}.dateRange`;
const getDateFilter = scope => {
  const fallback={from:todayValue(),to:todayValue()};
  try {
    const saved=JSON.parse(localStorage.getItem(dateFilterKey(scope))||"null");
    return /^\d{4}-\d{2}-\d{2}$/.test(saved?.from)&&/^\d{4}-\d{2}-\d{2}$/.test(saved?.to)?saved:fallback;
  } catch { return fallback; }
};
const saveDateFilter = (scope,from,to) => {
  if(!from||!to||from>to){toast("La fecha inicial no puede ser posterior a la fecha final.");return false;}
  localStorage.setItem(dateFilterKey(scope),JSON.stringify({from,to}));return true;
};
const nextDateValue = value => {const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);};
const withTimeout = (request,ms=20000) => Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(new Error("La conexión tardó demasiado. Revisa la lista antes de intentarlo nuevamente.")),ms))]);

async function boot() {
  const { data } = await supabase.auth.getSession();
  $("#loading").classList.add("hidden");
  if (data.session) await enterApp(data.session.user); else showAuth();
}
function showAuth(message = "") {
  $("#appView").classList.add("hidden"); $("#authView").classList.remove("hidden");
  $("#loginEmail").value = SUPERADMIN_EMAIL; $("#authMessage").textContent = message;
}
async function enterApp(user) {
  $("#authView").classList.add("hidden"); $("#appView").classList.remove("hidden");
  const { data, error } = await supabase.from("perfiles").select("*, roles(nombre)").eq("id", user.id).maybeSingle();
  if (error) {
    currentProfile = { id:user.id, nombre_completo:user.email.split("@")[0], correo:user.email, roles:{nombre:"Sin configurar"} };
    toast(errorText(error));
  } else currentProfile = data;
  await loadCurrentPermissions();
  const name = currentProfile?.nombre_completo || user.email;
  $("#userName").textContent = name;
  $("#userRole").textContent = currentProfile?.roles?.nombre || "Usuario";
  $("#userInitials").textContent = name.split(" ").slice(0,2).map(x => x[0]).join("").toUpperCase();
  setupHelpAssistant();
  await renderDashboard();
}

$("#loginForm").onsubmit = async event => {
  event.preventDefault(); $("#authMessage").textContent = "Validando acceso…";
  const { data, error } = await supabase.auth.signInWithPassword({ email:clean($("#loginEmail").value), password:$("#loginPassword").value });
  if (error) return $("#authMessage").textContent = errorText(error);
  await enterApp(data.user);
};
$("#firstAccountBtn").onclick = async () => {
  const email = clean($("#loginEmail").value), password = $("#loginPassword").value;
  if (!email || password.length < 8) return $("#authMessage").textContent = "Escribe el correo y una contraseña de mínimo 8 caracteres.";
  $("#authMessage").textContent = "Creando la primera cuenta…";
  const { data, error } = await supabase.auth.signUp({ email, password, options:{ data:{ nombre_completo:"Yohan Mendoza" } } });
  if (error) return $("#authMessage").textContent = errorText(error);
  $("#authMessage").textContent = data.session ? "Cuenta creada correctamente." : "Cuenta creada. Revisa el correo para confirmar el acceso.";
  if (data.session) await enterApp(data.user);
};
$("#resetBtn").onclick = async () => {
  const email = clean($("#loginEmail").value);
  if (!email) return $("#authMessage").textContent = "Escribe primero tu correo.";
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo:location.href });
  $("#authMessage").textContent = error ? errorText(error) : "Enviamos las instrucciones al correo.";
};
$("#togglePassword").onclick = () => {
  const input = $("#loginPassword"); input.type = input.type === "password" ? "text" : "password";
  $("#togglePassword").textContent = input.type === "password" ? "Mostrar" : "Ocultar";
};
$("#logoutBtn").onclick = async () => { await supabase.auth.signOut(); showAuth("Sesión cerrada correctamente."); };
$("#menuBtn").onclick = () => { $("#sidebar").classList.toggle("open"); $("#backdrop").classList.toggle("show"); };
$("#backdrop").onclick = closeMenu;
function closeMenu(){ $("#sidebar").classList.remove("open"); $("#backdrop").classList.remove("show"); }

$$(".nav[data-view]").forEach(button => button.onclick = async () => {
  $$(".nav").forEach(x => x.classList.remove("active")); button.classList.add("active"); closeMenu();
  const view = button.dataset.view;
  if (view === "dashboard") renderDashboard();
  if (view === "patients") await renderPatients();
  if (view === "journeys") await renderJourneys();
  if (view === "brigades") await renderBrigades();
  if (view === "appointments") await renderAppointments();
  if (view === "callcenter") await renderCallCenter();
  if (view === "consultations") await renderConsultations();
  if (view === "products") await renderProducts();
  if (view === "sales") await renderSales();
  if (view === "payments") await renderPayments();
  if (view === "reports") await renderReports();
  if (view === "users") await renderUsers();
  if (view === "profile") renderProfile();
});

async function renderDashboard() {
  $("#pageName").textContent = "Panel principal";
  $("#content").innerHTML = `
    <div class="page-hero"><div><h1>Hola, ${escapeHTML((currentProfile?.nombre_completo || "Yohan").split(" ")[0])}</h1><p>Resumen operativo y financiero en tiempo real.</p></div><button class="primary" id="dashboardReports">Ver reportes →</button></div>
    <div class="stats" id="dashboardStats"><article class="stat"><span>Cargando indicadores</span><strong>…</strong></article></div>
    <div class="analytics-grid"><article class="card"><div class="card-head"><div><h2>Estado de citas</h2><p>Distribución general</p></div></div><div id="dashboardAppointmentBars" class="metric-bars"></div></article><article class="card"><div class="card-head"><div><h2>Recaudo por canal</h2><p>Movimientos activos</p></div></div><div id="dashboardChannelBars" class="metric-bars"></div></article></div>`;
  $("#dashboardReports").onclick=()=>navigateTo("reports");
  const [p,a,j,m,v]=await Promise.all([supabase.from("pacientes").select("id",{count:"exact",head:true}).eq("activo",true),supabase.from("agendamientos").select("estado,saldo_pendiente"),supabase.from("jornadas").select("id",{count:"exact",head:true}).in("estado",["abierta","inactiva"]),supabase.from("movimientos_financieros").select("tipo,valor,canal,estado"),supabase.from("ventas").select("total,saldo,estado")]);
  const error=p.error||a.error||j.error||m.error||v.error;if(error){$("#dashboardStats").innerHTML=`<div class="notice">${escapeHTML(errorText(error))}</div>`;return;}
  const active=(m.data||[]).filter(x=>x.estado==="activo"),income=netMovements(active),pending=(a.data||[]).reduce((n,x)=>n+Number(x.saldo_pendiente||0),0)+(v.data||[]).filter(x=>x.estado!=="anulada").reduce((n,x)=>n+Number(x.saldo||0),0);
  $("#dashboardStats").innerHTML=`<article class="stat"><span>Pacientes activos</span><strong>${p.count||0}</strong></article><article class="stat"><span>Jornadas operativas</span><strong>${j.count||0}</strong></article><article class="stat"><span>Recaudo neto</span><strong>${cop(income)}</strong></article><article class="stat"><span>Cartera pendiente</span><strong>${cop(pending)}</strong></article>`;
  paintMetricBars("#dashboardAppointmentBars",countBy(a.data||[],"estado"),a.data?.length||0);
  const channels=sumBy(active,"canal","valor");paintMetricBars("#dashboardChannelBars",channels,Math.max(...Object.values(channels),0));
}
async function renderPatients() {
  const dateRange=getDateFilter("patients");
  $("#pageName").textContent = "Pacientes";
  $("#content").innerHTML = `<div class="page-hero"><div><h1>Consultar paciente</h1><p>La información permanece oculta hasta realizar una búsqueda.</p></div>${hasPermission("pacientes.crear")?'<button class="primary" id="newPatient">＋ Nuevo paciente</button>':""}</div>
    <article class="card"><div class="card-head"><div><h2>Consulta privada</h2><p>Selecciona un criterio y escribe el dato que deseas consultar</p></div></div>
    <form class="patient-query" id="patientQueryForm"><label>Fecha inicio<input type="date" id="patientDateFrom" value="${dateRange.from}" required></label><label>Fecha fin<input type="date" id="patientDateTo" value="${dateRange.to}" required></label><label>Consultar por<select id="patientSearchType"><option value="identificacion">Identificación</option><option value="celular">Celular</option><option value="nombre">Nombre y apellido</option></select></label><label class="query-value">Dato a consultar<input id="patientSearch" autocomplete="off" placeholder="Escribe la identificación completa…" required></label><button class="primary" type="submit">Consultar</button><button class="secondary" id="clearPatientSearch" type="button">Limpiar</button></form>
    <div class="privacy-note">🔒 No se muestra ningún directorio general. Los resultados aparecen únicamente después de consultar.</div>
    <div class="table-wrap"><table><thead><tr><th>Paciente</th><th>Identificación</th><th>Celular</th><th>Registro</th><th>Acciones</th></tr></thead><tbody id="patientRows"><tr><td colspan="5" class="empty"><b>Realiza una consulta</b>Busca por identificación, celular o nombre y apellido.</td></tr></tbody></table></div></article>
    <section id="patientHistory" class="hidden"></section>`;
  if($("#newPatient"))$("#newPatient").onclick = () => openPatient();
  $("#patientQueryForm").onsubmit=async event=>{event.preventDefault();await loadPatients();};
  ["#patientDateFrom","#patientDateTo"].forEach(selector=>$(selector).onchange=async()=>{const from=$("#patientDateFrom").value,to=$("#patientDateTo").value;if(saveDateFilter("patients",from,to)&&clean($("#patientSearch").value))await loadPatients();});
  $("#patientSearchType").onchange=()=>{const type=$("#patientSearchType").value;$("#patientSearch").value="";$("#patientSearch").placeholder=type==="identificacion"?"Escribe la identificación completa…":type==="celular"?"Escribe el celular…":"Escribe nombre y apellido…";clearPatientResults();};
  $("#clearPatientSearch").onclick=()=>{$("#patientSearch").value="";clearPatientResults();};
}
async function loadPatients() {
  const type=$("#patientSearchType")?.value||"identificacion",value=clean($("#patientSearch")?.value),from=$("#patientDateFrom")?.value,to=$("#patientDateTo")?.value;
  if(!saveDateFilter("patients",from,to))return;
  if(value.length<(type==="nombre"?3:4))return toast(type==="nombre"?"Escribe al menos 3 letras.":"Escribe al menos 4 números.");
  $("#patientRows").innerHTML=`<tr><td colspan="5" class="empty">Consultando…</td></tr>`;
  const { data, error } = await supabase.rpc("buscar_pacientes_rango",{p_tipo:type,p_valor:value,p_desde:from,p_hasta:to});
  if (error) { $("#patientRows").innerHTML = `<tr><td colspan="5" class="empty"><b>No fue posible realizar la consulta</b>${escapeHTML(errorText(error))}</td></tr>`; return; }
  patients = data || []; paintPatients(patients);
}
function clearPatientResults(){patients=[];$("#patientRows").innerHTML=`<tr><td colspan="5" class="empty"><b>Realiza una consulta</b>Busca por identificación, celular o nombre y apellido.</td></tr>`;$("#patientHistory").classList.add("hidden");$("#patientHistory").innerHTML="";}
function filterPatientRows(){loadPatients();}
function paintPatients(list) {
  if (!list.length) return $("#patientRows").innerHTML=`<tr><td colspan="5" class="empty"><b>No encontramos coincidencias</b>Revisa el dato o registra un paciente nuevo.</td></tr>`;
  $("#patientRows").innerHTML=list.map(p=>`<tr><td><strong>${escapeHTML(p.nombre_completo)}</strong>${p.identificacion_provisional?'<small class="warning-text">Identificación provisional pendiente de corregir</small>':`<small>${escapeHTML(p.correo||"Sin correo")}</small>`}</td><td>${escapeHTML(p.tipo_identificacion)} ${escapeHTML(p.numero_identificacion)}</td><td>${escapeHTML(p.celular_principal||"Sin celular")}</td><td>${formatDate(p.created_at)}</td><td><div class="inline-actions"><button class="primary history-patient" data-id="${p.id}">Ver historial</button>${hasPermission("pacientes.editar")?`<button class="secondary edit-patient" data-id="${p.id}">Editar</button>`:""}</div></td></tr>`).join("");
  $$(".edit-patient").forEach(btn=>btn.onclick=()=>openPatient(patients.find(p=>p.id===btn.dataset.id)));
  $$(".history-patient").forEach(btn=>btn.onclick=()=>loadPatientHistory(patients.find(p=>p.id===btn.dataset.id)));
}
async function loadPatientHistory(patient){
  const panel=$("#patientHistory");panel.classList.remove("hidden");panel.innerHTML=`<article class="card"><div class="empty">Cargando historial de ${escapeHTML(patient.nombre_completo)}…</div></article>`;
  const [a,c,v,b]=await Promise.all([supabase.from("agendamientos").select("id,numero_volante,valor_consulta,abono,saldo_pendiente,estado,created_at,jornadas(nombre,fecha_brigada,lugar)").eq("paciente_id",patient.id).order("created_at",{ascending:false}),supabase.from("consultas_optometricas").select("id,optometra,diagnostico,tipo_lente_recomendado,proximo_control,created_at").eq("paciente_id",patient.id).order("created_at",{ascending:false}),supabase.from("ventas").select("id,numero_venta,total,abono,saldo,estado,fecha_entrega,created_at").eq("paciente_id",patient.id).order("created_at",{ascending:false}),supabase.from("bitacora").select("id,accion,informacion_anterior,informacion_nueva,created_at,perfiles(nombre_completo)").eq("tabla","pacientes").eq("registro_id",patient.id).order("created_at",{ascending:false})]);
  const visible=result=>result.error?[]:(result.data||[]),appointments=visible(a),consults=visible(c),sales=visible(v),audit=visible(b);
  panel.innerHTML=`<article class="card patient-history-card"><div class="card-head"><div><h2>${escapeHTML(patient.nombre_completo)}</h2><p>${escapeHTML(patient.tipo_identificacion)} ${escapeHTML(patient.numero_identificacion)} · ${escapeHTML(patient.celular_principal||"Sin celular")}</p></div><button class="secondary" id="closePatientHistory">Cerrar historial</button></div><div class="history-summary"><span><b>${appointments.length}</b>Citas</span><span><b>${consults.length}</b>Consultas</span><span><b>${sales.length}</b>Ventas</span><span><b>${audit.length}</b>Cambios auditados</span></div>${historyGroup("Historial de citas",appointments.map(x=>`<div><strong>${escapeHTML(x.jornadas?.nombre||"Jornada")}</strong><span>${x.jornadas?.fecha_brigada?shortDate(x.jornadas.fecha_brigada):formatDate(x.created_at)} · ${appointmentState(x.estado)} · Abono ${cop(x.abono)}</span></div>`))}${historyGroup("Consultas optométricas",consults.map(x=>`<div><strong>${formatDate(x.created_at)} · ${escapeHTML(x.optometra)}</strong><span>${escapeHTML(x.diagnostico||"Sin diagnóstico")} · ${escapeHTML(x.tipo_lente_recomendado||"Sin lente recomendado")}</span></div>`))}${historyGroup("Ventas",sales.map(x=>`<div><strong>${escapeHTML(x.numero_venta)} · ${cop(x.total)}</strong><span>${capitalize(x.estado)} · Abono ${cop(x.abono)} · Saldo ${cop(x.saldo)}</span></div>`))}${hasPermission("bitacora.ver")?historyGroup("Auditoría de datos",audit.map(x=>`<div><strong>${formatDate(x.created_at)} · ${escapeHTML(x.perfiles?.nombre_completo||"Usuario")}</strong><span>${patientAuditSummary(x)}</span></div>`)):""}</article>`;
  $("#closePatientHistory").onclick=()=>{panel.classList.add("hidden");panel.innerHTML="";};panel.scrollIntoView({behavior:"smooth",block:"start"});
}
function historyGroup(title,items){return `<section class="history-group"><h3>${title}</h3>${items.length?items.join(""):'<p class="history-empty">Sin registros.</p>'}</section>`;}
function patientAuditSummary(entry){if(entry.accion==="insert")return "Paciente creado";const before=entry.informacion_anterior||{},after=entry.informacion_nueva||{};const labels={numero_identificacion:"identificación",nombre_completo:"nombre",celular_principal:"celular principal",celular_alternativo:"celular alternativo",correo:"correo",fecha_nacimiento:"fecha de nacimiento",genero:"género"};const changes=Object.keys(labels).filter(k=>String(before[k]??"")!==String(after[k]??"")).map(k=>`${labels[k]}: “${before[k]??"vacío"}” → “${after[k]??"vacío"}”`);return changes.length?escapeHTML(changes.join(" · ")):"Registro actualizado";}
function openPatient(patient=null) {
  $("#patientForm").reset(); $("#patientId").value=patient?.id||""; $("#patientModalTitle").textContent=patient?"Editar paciente":"Nuevo paciente"; $("#duplicateAlert").classList.add("hidden");
  capturedPatientLocation=patient?{ubicacion_registro:patient.ubicacion_registro,latitud_registro:patient.latitud_registro,longitud_registro:patient.longitud_registro,precision_ubicacion_metros:patient.precision_ubicacion_metros}:null;
  if(patient){ $("#documentType").value=patient.tipo_identificacion;$("#documentNumber").value=patient.numero_identificacion;$("#fullName").value=patient.nombre_completo;$("#phone").value=patient.celular_principal;$("#alternatePhone").value=patient.celular_alternativo||"";$("#gender").value=patient.genero||"";$("#birthDate").value=patient.fecha_nacimiento||"";$("#notes").value=patient.observaciones||"";$("#patientLocationStatus").textContent=patient.ubicacion_registro?`Ubicación guardada: ${patient.ubicacion_registro}`:"Este paciente no tiene ubicación registrada.";}
  else{$("#patientLocationStatus").textContent="Solicitando autorización para obtener la ubicación aproximada…";capturePatientLocation();}
  $("#patientModal").classList.remove("hidden");
}
$("#retryLocation").onclick=capturePatientLocation;
function capturePatientLocation(){
  const status=$("#patientLocationStatus");
  if(!navigator.geolocation){status.textContent="Este dispositivo no permite obtener la ubicación.";return;}
  status.textContent="Esperando autorización de ubicación…";
  navigator.geolocation.getCurrentPosition(async position=>{
    const {latitude,longitude,accuracy}=position.coords;let label=`Latitud ${latitude.toFixed(5)}, longitud ${longitude.toFixed(5)}`;
    try{
      const response=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`,{headers:{"Accept-Language":"es"}});
      if(response.ok){const result=await response.json(),a=result.address||{},place=a.village||a.town||a.city||a.municipality||a.county;label=[place,a.state,a.country].filter(Boolean).join(", ")||result.display_name||label;}
    }catch{}
    capturedPatientLocation={ubicacion_registro:label,latitud_registro:latitude,longitud_registro:longitude,precision_ubicacion_metros:accuracy};status.textContent=`Ubicación obtenida: ${label}`;
  },error=>{capturedPatientLocation=null;status.textContent=error.code===1?"No autorizaste la ubicación. Puedes continuar sin ella.":"No fue posible obtener la ubicación. Puedes intentar nuevamente.";},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
}
$$("[data-close]").forEach(btn=>btn.onclick=()=>{ $("#patientModal").classList.add("hidden"); if(patientCreatedFromAppointment){patientCreatedFromAppointment=false;$("#appointmentModal").classList.remove("hidden");} });
$("#patientForm").onsubmit=async event=>{
  event.preventDefault(); const id=$("#patientId").value;
  const record={tipo_identificacion:$("#documentType").value,numero_identificacion:clean($("#documentNumber").value),nombre_completo:clean($("#fullName").value),celular_principal:clean($("#phone").value),celular_alternativo:clean($("#alternatePhone").value)||null,genero:$("#gender").value||null,fecha_nacimiento:$("#birthDate").value||null,observaciones:clean($("#notes").value)||null,...(capturedPatientLocation||{})};
  const {data:duplicates,error:duplicateError}=await supabase.rpc("buscar_duplicado_paciente",{p_paciente_id:id||null,p_identificacion:record.numero_identificacion,p_celular:record.celular_principal});
  if(duplicateError)return toast(errorText(duplicateError));const duplicate=duplicates?.[0];
  if(duplicate){const alert=$("#duplicateAlert");alert.textContent=`Posible duplicado: ${duplicate.nombre_completo}, ${duplicate.numero_identificacion}, ${duplicate.celular_principal}. Revisa antes de continuar.`;alert.classList.remove("hidden");return;}
  let savedPatient=null,error=null;
  if(id){const result=await supabase.from("pacientes").update(record).eq("id",id).select().single();savedPatient=result.data;error=result.error;}
  else{const result=await supabase.from("pacientes").insert(record).select().single();savedPatient=result.data;error=result.error;}
  if(error)return toast(errorText(error));
  $("#patientModal").classList.add("hidden");toast(id?"Paciente actualizado.":"Paciente registrado.");
  if(patientCreatedFromAppointment&&savedPatient){patientCreatedFromAppointment=false;patients.push(savedPatient);selectAppointmentPatient(savedPatient);$("#appointmentModal").classList.remove("hidden");}
  if($("#patientRows")&&clean($("#patientSearch")?.value))await loadPatients();
};

async function renderJourneys() {
  $("#pageName").textContent="Jornadas";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Jornadas visuales</h1><p>Programa, consulta y controla las jornadas de la óptica.</p></div><button class="primary" id="newJourney">＋ Crear jornada</button></div>
    <div class="stats"><article class="stat"><span>Jornadas abiertas</span><strong id="openJourneys">—</strong></article><article class="stat"><span>Jornadas cerradas</span><strong id="closedJourneys">—</strong></article><article class="stat"><span>Próxima jornada</span><strong id="nextJourney">—</strong></article><article class="stat"><span>Municipios</span><strong id="journeyCities">—</strong></article></div>
    <article class="card"><div class="card-head"><div><h2>Listado de jornadas</h2><p>Información guardada en Supabase</p></div></div>
    <div class="tools"><input class="search" id="journeySearch" placeholder="Buscar por nombre o municipio…"><select id="journeyStatusFilter"><option value="">Todos los estados</option><option value="abierta">Abiertas para agenda</option><option value="inactiva">Inactivas para agenda</option><option value="cerrada">Cerradas</option></select><button class="secondary" id="refreshJourneys">Actualizar</button></div>
    <div class="table-wrap"><table><thead><tr><th>Jornada</th><th>Ubicación</th><th>Fecha</th><th>Consulta</th><th>Lugar</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="journeyRows"><tr><td colspan="7" class="empty">Cargando jornadas…</td></tr></tbody></table></div></article>`;
  $("#newJourney").onclick=()=>openJourney();
  $("#refreshJourneys").onclick=loadJourneys;
  $("#journeySearch").oninput=filterJourneyRows;
  $("#journeyStatusFilter").onchange=filterJourneyRows;
  await loadJourneys();
}
async function loadJourneys() {
  const {data,error}=await supabase.from("jornadas").select("*").eq("activo",true).eq("eliminado",false).order("fecha_brigada",{ascending:false});
  if(error){$("#journeyRows").innerHTML=`<tr><td colspan="7" class="empty"><b>No fue posible cargar jornadas</b>${escapeHTML(errorText(error))}</td></tr>`;return;}
  journeys=data||[]; updateJourneyStats(); paintJourneys(journeys);
}
function updateJourneyStats(){
  const open=journeys.filter(x=>x.estado==="abierta"),closed=journeys.filter(x=>x.estado==="cerrada");
  const upcoming=[...open].filter(x=>new Date(x.fecha_brigada+"T12:00:00")>=new Date().setHours(0,0,0,0)).sort((a,b)=>a.fecha_brigada.localeCompare(b.fecha_brigada))[0];
  $("#openJourneys").textContent=open.length;$("#closedJourneys").textContent=closed.length;$("#nextJourney").textContent=upcoming?shortDate(upcoming.fecha_brigada):"Sin fecha";$("#journeyCities").textContent=new Set(journeys.map(x=>x.municipio)).size;
}
function filterJourneyRows(){
  const q=clean($("#journeySearch")?.value).toLowerCase(),status=$("#journeyStatusFilter")?.value||"";
  paintJourneys(journeys.filter(j=>(!q||[j.nombre,j.municipio,j.departamento,j.lugar].some(v=>String(v||"").toLowerCase().includes(q)))&&(!status||j.estado===status)));
}
function paintJourneys(list){
  if(!list.length)return $("#journeyRows").innerHTML=`<tr><td colspan="7" class="empty"><b>No encontramos jornadas</b>Crea una nueva jornada o cambia los filtros.</td></tr>`;
  $("#journeyRows").innerHTML=list.map(j=>`<tr><td><strong>${escapeHTML(j.nombre)}</strong><small>Creada ${formatDate(j.created_at)}</small></td><td>${escapeHTML(j.municipio)}, ${escapeHTML(j.departamento)}</td><td>${shortDate(j.fecha_brigada)}</td><td>${cop(j.valor_consulta)}</td><td>${escapeHTML(j.lugar)}</td><td><span class="badge ${j.estado!=="abierta"?"closed":""}">${j.estado==="inactiva"?"Inactiva para agenda":capitalize(j.estado)}</span></td><td><button class="secondary edit-journey" data-id="${j.id}">Editar</button> <button class="secondary toggle-journey" data-id="${j.id}">${j.estado==="abierta"?"Inactivar":j.estado==="inactiva"?"Activar":"Reabrir"}</button></td></tr>`).join("");
  $$(".edit-journey").forEach(b=>b.onclick=()=>openJourney(journeys.find(j=>j.id===b.dataset.id)));
  $$(".toggle-journey").forEach(b=>b.onclick=()=>toggleJourney(b.dataset.id));
}
function openJourney(journey=null){
  $("#journeyForm").reset();$("#journeyId").value=journey?.id||"";$("#journeyModalTitle").textContent=journey?"Editar jornada":"Nueva jornada";
  $("#journeyDepartment").value=journey?.departamento||"Córdoba";$("#journeyName").value=journey?.nombre||"";$("#journeyCity").value=journey?.municipio||"";$("#journeyDate").value=journey?.fecha_brigada||"";$("#journeyPrice").value=journey?.valor_consulta||70000;$("#journeyStart").value=journey?.hora_inicial?.slice(0,5)||"";$("#journeyEnd").value=journey?.hora_final?.slice(0,5)||"";$("#journeyPlace").value=journey?.lugar||"";$("#journeyAddress").value=journey?.direccion||"";$("#journeyStatus").value=journey?.estado||"abierta";$("#journeyNotes").value=journey?.observaciones||"";
  $("#journeyModal").classList.remove("hidden");
}
$$("[data-close-journey]").forEach(b=>b.onclick=()=>$("#journeyModal").classList.add("hidden"));
$("#journeyForm").onsubmit=async event=>{
  event.preventDefault();const id=$("#journeyId").value;
  const record={nombre:clean($("#journeyName").value),departamento:clean($("#journeyDepartment").value),municipio:clean($("#journeyCity").value),fecha_brigada:$("#journeyDate").value,valor_consulta:Number($("#journeyPrice").value),hora_inicial:$("#journeyStart").value||null,hora_final:$("#journeyEnd").value||null,lugar:clean($("#journeyPlace").value),direccion:clean($("#journeyAddress").value)||null,estado:$("#journeyStatus").value,observaciones:clean($("#journeyNotes").value)||null};
  const query=id?supabase.from("jornadas").update(record).eq("id",id):supabase.from("jornadas").insert(record);
  const {error}=await query;if(error)return toast(errorText(error));$("#journeyModal").classList.add("hidden");toast(id?"Jornada actualizada.":"Jornada creada.");if($("#journeyRows"))await loadJourneys();
};
async function toggleJourney(id){
  const journey=journeys.find(j=>j.id===id),next=journey.estado==="abierta"?"inactiva":"abierta";
  if(!confirm(`¿Deseas ${next==="inactiva"?"inactivar para nuevos agendamientos":"activar"} la jornada ${journey.nombre}?`))return;
  const {error}=await supabase.from("jornadas").update({estado:next}).eq("id",id);if(error)return toast(errorText(error));toast(`Jornada ${next}.`);await loadJourneys();
}

async function renderBrigades(){
  $("#pageName").textContent="Brigadas";
  const today=localDateValue(new Date());
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Brigada de hoy</h1><p>Buscando las jornadas programadas para ${shortDate(today)}.</p></div></div><div class="card"><div class="empty">Cargando pacientes del día…</div></div>`;
  const [{data:jData,error:jError},{data:bData,error:bError}]=await Promise.all([supabase.from("jornadas").select("id,nombre,fecha_brigada,estado,municipio,lugar,direccion").eq("activo",true).eq("eliminado",false).in("estado",["abierta","inactiva"]).order("fecha_brigada"),supabase.from("brigadas").select("*, jornadas(nombre,municipio,estado)").eq("activo",true).eq("eliminado",false).eq("fecha",today)]);
  if(jError||bError){$("#content").innerHTML=`<div class="empty"><b>No fue posible abrir la brigada</b>${escapeHTML(errorText(jError||bError))}</div>`;return;}
  const availableJourneys=jData||[];journeys=availableJourneys.filter(j=>j.fecha_brigada===today);brigades=bData||[];
  if(!journeys.length){const schedule=availableJourneys.length?`<div class="patient-crm-grid" style="padding:20px">${availableJourneys.map(j=>`<article class="patient-crm-card"><h3>${escapeHTML(j.nombre)}</h3><p>Fecha programada: <strong>${shortDate(j.fecha_brigada)}</strong></p><p>${escapeHTML(j.municipio)} · ${j.estado==="inactiva"?"Inactiva para agenda":"Abierta"}</p></article>`).join("")}</div>`:"";$("#content").innerHTML=`<div class="page-hero"><div><h1>Brigada de hoy</h1><p>Fecha del dispositivo: ${shortDate(today)}</p></div></div><article class="card"><div class="empty"><b>No hay jornadas con fecha de brigada para hoy</b>Estar abierta o registrar un paciente hoy no cambia la fecha programada de la brigada.</div>${schedule}</article>`;return;}
  if(journeys.length===1){const brigade=await ensureOperationalBrigade(journeys[0]);if(brigade)await manageBrigadePatients(brigade);return;}
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Brigadas de hoy</h1><p>Selecciona la jornada que vas a atender.</p></div></div><div class="patient-crm-grid">${journeys.map(j=>`<article class="patient-crm-card"><h3>${escapeHTML(j.nombre)}</h3><p>${escapeHTML(j.municipio)} · ${shortDate(j.fecha_brigada)}</p><p>${escapeHTML(j.lugar)}</p><button class="primary open-today-journey" data-id="${j.id}">Ver pacientes</button></article>`).join("")}</div>`;
  $$(".open-today-journey").forEach(button=>button.onclick=async()=>{const journey=journeys.find(j=>j.id===button.dataset.id),brigade=await ensureOperationalBrigade(journey);if(brigade)await manageBrigadePatients(brigade);});
}
async function ensureOperationalBrigade(journey){
  const existing=brigades.find(b=>b.jornada_id===journey.id);if(existing)return existing;
  const {data,error}=await supabase.from("brigadas").insert({jornada_id:journey.id,nombre:`Atención ${journey.nombre}`,fecha:journey.fecha_brigada,lugar:journey.lugar||`Punto de atención ${journey.municipio}`,direccion:journey.direccion||null,estado:"programada",capacidad_maxima:null}).select("*, jornadas(nombre,municipio,estado)").single();
  if(error){toast(errorText(error));return null;}brigades.push(data);return data;
}
async function chooseBrigadeForAppointment(){
  if(!journeys.length)return toast("Primero debes crear una jornada abierta o inactiva.");
  openAppointment(null,null,null,true);
}
async function loadBrigades(){
  const [{data:jData,error:jError},{data:bData,error:bError}]=await Promise.all([supabase.from("jornadas").select("id,nombre,fecha_brigada,estado,municipio,lugar,direccion").eq("activo",true).eq("eliminado",false).in("estado",["abierta","inactiva"]).order("fecha_brigada"),supabase.from("brigadas").select("*, jornadas(nombre,municipio,estado)").eq("activo",true).eq("eliminado",false).order("fecha",{ascending:false})]);
  if(jError||bError){$("#brigadeRows").innerHTML=`<tr><td colspan="7" class="empty"><b>No fue posible cargar brigadas</b>${escapeHTML(errorText(jError||bError))}</td></tr>`;return;}
  journeys=jData||[];brigades=bData||[];
  const journeyIds=journeys.map(j=>j.id);let agendaData=[];
  if(journeyIds.length){const agendaResult=await supabase.from("agendamientos").select("estado").in("jornada_id",journeyIds).eq("activo",true);if(!agendaResult.error)agendaData=agendaResult.data||[];}
  $("#pendingBrigadePatients").textContent=agendaData.filter(a=>["registrada","confirmada"].includes(a.estado)).length;$("#completedBrigadePatients").textContent=agendaData.filter(a=>a.estado==="cumplida").length;$("#cancelledBrigadePatients").textContent=agendaData.filter(a=>["cancelada","incumplida"].includes(a.estado)).length;
  paintBrigades(brigades);
}
function filterBrigadeRows(){const q=clean($("#brigadeSearch")?.value).toLowerCase(),status=$("#brigadeStatusFilter")?.value||"";paintBrigades(brigades.filter(b=>(!q||[b.nombre,b.lugar,b.jornadas?.nombre,b.jornadas?.municipio].some(v=>String(v||"").toLowerCase().includes(q)))&&(!status||b.estado===status)));}
function paintBrigades(list){
  if(!list.length)return $("#brigadeRows").innerHTML=`<tr><td colspan="7" class="empty"><b>No encontramos brigadas</b>Crea una brigada asociada a una jornada.</td></tr>`;
  $("#brigadeRows").innerHTML=list.map(b=>`<tr><td><strong>${escapeHTML(b.nombre)}</strong><small>${escapeHTML(b.jornadas?.municipio||"")}</small></td><td>${escapeHTML(b.jornadas?.nombre||"—")}</td><td>${shortDate(b.fecha)}<small>${escapeHTML((b.hora_inicial||"").slice(0,5))}${b.hora_final?" – "+b.hora_final.slice(0,5):""}</small></td><td>${escapeHTML(b.lugar)}</td><td>${b.capacidad_maxima||"Sin límite"}</td><td><span class="badge">${capitalize(b.estado.replace("_"," "))}</span></td><td><div class="inline-actions"><button class="primary manage-brigade" data-id="${b.id}">Pacientes</button><button class="secondary edit-brigade" data-id="${b.id}">Editar</button></div></td></tr>`).join("");
  $$(".edit-brigade").forEach(btn=>btn.onclick=()=>openBrigade(brigades.find(b=>b.id===btn.dataset.id)));
  $$(".manage-brigade").forEach(btn=>btn.onclick=()=>manageBrigadePatients(brigades.find(b=>b.id===btn.dataset.id)));
}
async function openBrigade(brigade=null){
  if(!journeys.length){const {data}=await supabase.from("jornadas").select("id,nombre,fecha_brigada").eq("activo",true).eq("eliminado",false).order("fecha_brigada");journeys=data||[];}
  if(!journeys.length)return toast("Primero debes crear una jornada.");
  $("#brigadeForm").reset();$("#brigadeId").value=brigade?.id||"";$("#brigadeModalTitle").textContent=brigade?"Editar brigada":"Nueva brigada";$("#brigadeJourney").innerHTML=journeys.map(j=>`<option value="${j.id}">${escapeHTML(j.nombre)} · ${shortDate(j.fecha_brigada)}</option>`).join("");
  $("#brigadeJourney").value=brigade?.jornada_id||journeys[0].id;$("#brigadeName").value=brigade?.nombre||"";$("#brigadeDate").value=brigade?.fecha||journeys.find(j=>j.id===$("#brigadeJourney").value)?.fecha_brigada||"";$("#brigadeStatus").value=brigade?.estado||"programada";$("#brigadeStart").value=brigade?.hora_inicial?.slice(0,5)||"";$("#brigadeEnd").value=brigade?.hora_final?.slice(0,5)||"";$("#brigadeCapacity").value=brigade?.capacidad_maxima||50;$("#brigadePlace").value=brigade?.lugar||"";$("#brigadeAddress").value=brigade?.direccion||"";$("#brigadeNotes").value=brigade?.observaciones||"";
  $("#brigadeJourney").onchange=()=>{const selected=journeys.find(j=>j.id===$("#brigadeJourney").value);if(selected&&!brigade)$("#brigadeDate").value=selected.fecha_brigada;};
  $("#brigadeModal").classList.remove("hidden");
}
$$("[data-close-brigade]").forEach(b=>b.onclick=()=>$("#brigadeModal").classList.add("hidden"));
$("#brigadeForm").onsubmit=async event=>{
  event.preventDefault();const id=$("#brigadeId").value;
  const record={jornada_id:$("#brigadeJourney").value,nombre:clean($("#brigadeName").value),fecha:$("#brigadeDate").value,estado:$("#brigadeStatus").value,hora_inicial:$("#brigadeStart").value||null,hora_final:$("#brigadeEnd").value||null,capacidad_maxima:Number($("#brigadeCapacity").value)||null,lugar:clean($("#brigadePlace").value),direccion:clean($("#brigadeAddress").value)||null,observaciones:clean($("#brigadeNotes").value)||null};
  const query=id?supabase.from("brigadas").update(record).eq("id",id):supabase.from("brigadas").insert(record);const {error}=await query;if(error)return toast(errorText(error));$("#brigadeModal").classList.add("hidden");toast(id?"Brigada actualizada.":"Brigada creada.");if($("#brigadeRows"))await loadBrigades();
};
async function manageBrigadePatients(brigade){
  $("#pageName").textContent="Pacientes de brigada";
  brigadeCrmFilter="por_atender";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>${escapeHTML(brigade.jornadas?.nombre||brigade.nombre)}</h1><p>${escapeHTML(brigade.jornadas?.municipio||"")} · ${shortDate(brigade.fecha)}</p></div><div class="inline-actions">${journeys.length>1?'<button class="secondary" id="backToBrigades">← Cambiar jornada</button>':""}<button class="primary" id="addFromBrigade">＋ Agendar paciente</button></div></div>
    <div class="brigade-context">Toca una bandeja para filtrar. En “Por atender” aparecen juntas las citas registradas y confirmadas. Toca un paciente para registrar el saldo y marcar la cita cumplida.</div>
    <div class="stats" id="brigadeStatusStats"></div>
    <div class="stats" id="brigadeFinanceStats"></div>
    <div class="tools" style="padding:0 0 16px"><input class="search" id="brigadePatientSearch" placeholder="Buscar paciente, cédula, celular o volante…"></div>
    <div id="brigadePatientCards" class="patient-crm-grid"><div class="crm-empty">Cargando pacientes…</div></div>`;
  if($("#backToBrigades"))$("#backToBrigades").onclick=renderBrigades;$("#addFromBrigade").onclick=()=>openAppointment(null,brigade.jornada_id,brigade.id);
  const [agendaResult,movementResult]=await Promise.all([supabase.from("agendamientos").select("*, pacientes(id,nombre_completo,numero_identificacion,celular_principal), jornadas(id,nombre,fecha_brigada,municipio)").eq("jornada_id",brigade.jornada_id).eq("activo",true).order("created_at"),supabase.from("movimientos_financieros").select("tipo,valor,canal,brigada_id").eq("jornada_id",brigade.jornada_id).eq("estado","activo")]);
  if(agendaResult.error||movementResult.error){$("#brigadePatientRows").innerHTML=`<tr><td colspan="6" class="empty">${escapeHTML(errorText(agendaResult.error||movementResult.error))}</td></tr>`;return;}
  appointments=agendaResult.data||[];const movements=movementResult.data||[],agendaRevenue=movements.filter(m=>m.tipo==="abono_agendamiento").reduce((n,m)=>n+Number(m.valor),0),brigadeRevenue=movements.filter(m=>m.tipo==="pago_brigada"&&m.brigada_id===brigade.id).reduce((n,m)=>n+Number(m.valor),0);
  appointments=appointments.filter(a=>!a.brigada_id||a.brigada_id===brigade.id);
  $("#brigadeFinanceStats").innerHTML=`<article class="stat"><span>Recaudo en agendamiento</span><strong>${cop(agendaRevenue)}</strong></article><article class="stat"><span>Recaudo en brigada</span><strong>${cop(brigadeRevenue)}</strong></article><article class="stat"><span>Recaudo total</span><strong>${cop(agendaRevenue+brigadeRevenue)}</strong></article><article class="stat"><span>Pacientes del día</span><strong>${appointments.length}</strong></article>`;
  const paint=()=>{
    const counts={por_atender:appointments.filter(a=>["registrada","confirmada"].includes(a.estado)).length,cumplida:appointments.filter(a=>a.estado==="cumplida").length,canceladas:appointments.filter(a=>["cancelada","incumplida"].includes(a.estado)).length};
    $("#brigadeStatusStats").innerHTML=[["por_atender","Registradas y confirmadas"],["cumplida","Cumplidas"],["canceladas","Canceladas / incumplidas"]].map(([key,label])=>`<button class="stat filter-stat ${brigadeCrmFilter===key?"active":""}" data-filter="${key}"><span>${label}</span><strong>${counts[key]}</strong></button>`).join("");
    $$(".filter-stat[data-filter]").forEach(b=>b.onclick=()=>{brigadeCrmFilter=b.dataset.filter;paint();});
    const q=clean($("#brigadePatientSearch").value).toLowerCase(),matchesState=a=>brigadeCrmFilter==="por_atender"?["registrada","confirmada"].includes(a.estado):brigadeCrmFilter==="canceladas"?["cancelada","incumplida"].includes(a.estado):a.estado===brigadeCrmFilter;
    const list=appointments.filter(a=>matchesState(a)&&(!q||[a.pacientes?.nombre_completo,a.pacientes?.numero_identificacion,a.pacientes?.celular_principal,a.numero_volante].some(v=>String(v||"").toLowerCase().includes(q))));
    $("#brigadePatientCards").innerHTML=list.length?list.map(a=>`<article class="patient-crm-card"><h3>${escapeHTML(a.pacientes?.nombre_completo||"—")}</h3><p>${escapeHTML(a.pacientes?.numero_identificacion||"")} · ${escapeHTML(a.pacientes?.celular_principal||"")}</p><p>Volante ${escapeHTML(a.numero_volante)} · <span class="badge state-${a.estado}">${appointmentState(a.estado)}</span></p><p>Valor ${cop(a.valor_consulta)} · Abono ${cop(a.abono)} · Saldo ${cop(a.saldo_pendiente)}</p>${["registrada","confirmada"].includes(a.estado)?`<button class="primary attend-patient" data-id="${a.id}">Atender paciente</button><div class="inline-actions"><button class="secondary miss-patient" data-id="${a.id}">No asistió</button><button class="secondary move-patient" data-id="${a.id}">Cambiar jornada</button></div>`:""}</article>`).join(""):`<div class="crm-empty">No hay pacientes en esta bandeja.</div>`;
    $$(".attend-patient").forEach(b=>b.onclick=async()=>{const a=appointments.find(x=>x.id===b.dataset.id);if(!a.brigada_id){const {error}=await supabase.from("agendamientos").update({brigada_id:brigade.id}).eq("id",a.id);if(error)return toast(errorText(error));a.brigada_id=brigade.id;}openAttendance(a,brigade);});
    $$(".move-patient").forEach(b=>b.onclick=()=>openAppointment(appointments.find(a=>a.id===b.dataset.id)));
    $$(".miss-patient").forEach(b=>b.onclick=async()=>{const a=appointments.find(x=>x.id===b.dataset.id);if(!a.brigada_id){const update=await supabase.from("agendamientos").update({brigada_id:brigade.id}).eq("id",a.id);if(update.error)return toast(errorText(update.error));}if(!confirm(`¿Marcar como incumplida la cita de ${a.pacientes.nombre_completo}?`))return;const {error}=await supabase.rpc("marcar_cita_incumplida",{p_agendamiento:a.id,p_brigada:brigade.id,p_observaciones:"Paciente no asistió"});if(error)return toast(errorText(error));toast("Cita marcada como incumplida.");await manageBrigadePatients(brigade);});
  };
  $("#brigadePatientSearch").oninput=paint;paint();
}
function openAttendance(appointment,brigade){
  attendanceBrigade=brigade;$("#attendanceForm").reset();$("#attendanceAppointmentId").value=appointment.id;$("#attendancePatientName").textContent=`${appointment.pacientes.nombre_completo} · ${appointment.numero_volante}`;$("#attendancePrice").value=cop(appointment.valor_consulta);$("#attendancePreviousPayment").value=cop(appointment.abono);$("#attendancePending").value=cop(appointment.saldo_pendiente);$("#attendancePayment").value=Number(appointment.saldo_pendiente);$("#attendancePayment").max=Number(appointment.saldo_pendiente);$("#attendanceModal").classList.remove("hidden");
}
$$("[data-close-attendance]").forEach(b=>b.onclick=()=>$("#attendanceModal").classList.add("hidden"));
$("#attendanceForm").onsubmit=async event=>{
  event.preventDefault();const appointmentId=$("#attendanceAppointmentId").value,payment=Number($("#attendancePayment").value||0);
  const appointment=appointments.find(a=>a.id===appointmentId);if(payment!==Number(appointment.saldo_pendiente))return toast("Para marcar cumplida debes completar exactamente el saldo pendiente.");
  const {error}=await supabase.rpc("completar_cita_brigada",{p_agendamiento:appointmentId,p_brigada:attendanceBrigade.id,p_pago:payment,p_metodo:$("#attendanceMethod").value,p_observaciones:clean($("#attendanceNotes").value)||null});
  if(error)return toast(errorText(error));$("#attendanceModal").classList.add("hidden");toast("Pago registrado y cita cumplida.");await manageBrigadePatients(attendanceBrigade);
};

async function renderAppointments(){
  const dateRange=getDateFilter("appointments");
  $("#pageName").textContent="Agenda";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Agenda</h1><p>Agendamientos, confirmación y seguimiento de pacientes.</p></div><button class="primary" id="newAppointment">＋ Agendar paciente</button></div>
    <div class="stats"><article class="stat"><span>Citas registradas</span><strong id="registeredAppointments">—</strong></article><article class="stat"><span>Confirmadas</span><strong id="confirmedAppointments">—</strong></article><article class="stat"><span>Saldo pendiente</span><strong id="pendingBalance">—</strong></article><article class="stat"><span>Abonos recibidos</span><strong id="receivedPayments">—</strong></article></div>
    <article class="card"><div class="card-head"><div><h2>Agendamientos</h2><p>Busca por paciente, identificación, celular o volante</p></div></div>
    <div class="tools"><label class="date-filter">Registradas desde<input type="date" id="appointmentDateFrom" value="${dateRange.from}"></label><label class="date-filter">Registradas hasta<input type="date" id="appointmentDateTo" value="${dateRange.to}"></label><input class="search" id="appointmentSearch" placeholder="Buscar en la agenda…"><select id="appointmentStatusFilter"><option value="">Todos los estados</option><option value="registrada">Registradas</option><option value="confirmada">Confirmadas</option><option value="reprogramada">Reprogramadas</option><option value="cancelada">Canceladas</option></select><select id="appointmentJourneyFilter"><option value="">Todas las jornadas</option></select><button class="secondary" id="refreshAppointments">Actualizar</button></div>
    <div class="table-wrap"><table><thead><tr><th>Paciente</th><th>Jornada</th><th>Volante</th><th>Valor</th><th>Abono</th><th>Saldo</th><th>Estado</th><th>Contacto</th><th>Acciones</th></tr></thead><tbody id="appointmentRows"><tr><td colspan="9" class="empty">Cargando agenda…</td></tr></tbody></table></div></article>`;
  $("#newAppointment").onclick=()=>openAppointment();
  $("#refreshAppointments").onclick=loadAppointments;$("#appointmentSearch").oninput=filterAppointmentRows;$("#appointmentStatusFilter").onchange=filterAppointmentRows;$("#appointmentJourneyFilter").onchange=filterAppointmentRows;
  ["#appointmentDateFrom","#appointmentDateTo"].forEach(selector=>$(selector).onchange=loadAppointments);
  await loadAppointments();
}
async function loadAppointments(){
  const from=$("#appointmentDateFrom")?.value,to=$("#appointmentDateTo")?.value;
  if(!saveDateFilter("appointments",from,to))return;
  $("#appointmentRows").innerHTML=`<tr><td colspan="9" class="empty">Cargando agenda…</td></tr>`;
  const {data,error}=await supabase.from("agendamientos").select("*, pacientes(id,nombre_completo,numero_identificacion,celular_principal), jornadas(id,nombre,fecha_brigada,municipio), brigadas(id,nombre)").eq("activo",true).gte("created_at",`${from}T00:00:00-05:00`).lt("created_at",`${nextDateValue(to)}T00:00:00-05:00`).order("created_at",{ascending:false}).limit(1000);
  if(error){$("#appointmentRows").innerHTML=`<tr><td colspan="9" class="empty"><b>No fue posible cargar la agenda</b>${escapeHTML(errorText(error))}</td></tr>`;return;}
  appointments=data||[];updateAppointmentStats();fillAppointmentJourneyFilter();paintAppointments(appointments);
}
function updateAppointmentStats(){
  $("#registeredAppointments").textContent=appointments.filter(a=>a.estado==="registrada").length;$("#confirmedAppointments").textContent=appointments.filter(a=>a.estado==="confirmada").length;$("#pendingBalance").textContent=cop(appointments.reduce((n,a)=>n+Number(a.saldo_pendiente||0),0));$("#receivedPayments").textContent=cop(appointments.reduce((n,a)=>n+Number(a.abono||0),0));
}
function fillAppointmentJourneyFilter(){const select=$("#appointmentJourneyFilter"),current=select.value,items=[...new Map(appointments.map(a=>[a.jornada_id,a.jornadas])).entries()];select.innerHTML=`<option value="">Todas las jornadas</option>${items.map(([id,j])=>`<option value="${id}">${escapeHTML(j?.nombre||"Jornada")}</option>`).join("")}`;select.value=current;}
function filterAppointmentRows(){const q=clean($("#appointmentSearch")?.value).toLowerCase(),status=$("#appointmentStatusFilter")?.value||"",journey=$("#appointmentJourneyFilter")?.value||"";paintAppointments(appointments.filter(a=>(!q||[a.pacientes?.nombre_completo,a.pacientes?.numero_identificacion,a.pacientes?.celular_principal,a.numero_volante].some(v=>String(v||"").toLowerCase().includes(q)))&&(!status||a.estado===status)&&(!journey||a.jornada_id===journey)));}
function paintAppointments(list){
  if(!list.length)return $("#appointmentRows").innerHTML=`<tr><td colspan="9" class="empty"><b>No encontramos citas</b>Crea un agendamiento o cambia los filtros.</td></tr>`;
  $("#appointmentRows").innerHTML=list.map(a=>`<tr><td><strong>${escapeHTML(a.pacientes?.nombre_completo||"—")}</strong><small>${escapeHTML(a.pacientes?.numero_identificacion||"")}</small></td><td><strong>${escapeHTML(a.jornadas?.nombre||"—")}</strong><small>${a.jornadas?.fecha_brigada?shortDate(a.jornadas.fecha_brigada):""}</small></td><td>${escapeHTML(a.numero_volante)}</td><td>${cop(a.valor_consulta)}</td><td>${cop(a.abono)}</td><td>${cop(a.saldo_pendiente)}</td><td><span class="badge state-${a.estado}">${appointmentState(a.estado)}</span></td><td><button class="secondary call-patient" data-phone="${escapeHTML(a.pacientes?.celular_principal||"")}">Llamar</button> <button class="secondary whatsapp-patient" data-id="${a.id}">WhatsApp</button></td><td><button class="secondary edit-appointment" data-id="${a.id}">Editar</button>${a.estado==="registrada"?` <button class="secondary confirm-appointment" data-id="${a.id}">Confirmar</button>`:""}</td></tr>`).join("");
  $$(".edit-appointment").forEach(b=>b.onclick=()=>openAppointment(appointments.find(a=>a.id===b.dataset.id)));
  $$(".confirm-appointment").forEach(b=>b.onclick=()=>changeAppointmentState(b.dataset.id,"confirmada"));
  $$(".call-patient").forEach(b=>b.onclick=()=>{if(b.dataset.phone)location.href=`tel:${phoneDigits(b.dataset.phone)}`;});
  $$(".whatsapp-patient").forEach(b=>b.onclick=()=>openWhatsApp(appointments.find(a=>a.id===b.dataset.id)));
}
async function loadAppointmentCatalogs(includeInactive=false){
  const journeyQuery=supabase.from("jornadas").select("id,nombre,fecha_brigada,municipio,valor_consulta,estado").eq("activo",true).eq("eliminado",false);
  const [j,b]=await Promise.all([includeInactive?journeyQuery.in("estado",["abierta","inactiva"]).order("fecha_brigada"):journeyQuery.eq("estado","abierta").order("fecha_brigada"),supabase.from("brigadas").select("id,jornada_id,nombre,fecha").eq("activo",true).eq("eliminado",false).in("estado",["programada","en_ejecucion"]).order("fecha")]);
  if(j.error||b.error)throw(j.error||b.error);patients=[];journeys=j.data||[];brigades=b.data||[];
}
async function openAppointment(appointment=null,forcedJourneyId=null,forcedBrigadeId=null,fromBrigadeModule=false){
  appointmentFromBrigadeModule=fromBrigadeModule;
  try{await loadAppointmentCatalogs(Boolean(forcedJourneyId)||fromBrigadeModule);}catch(error){return toast(errorText(error));}
  if(!journeys.length)return toast("No hay jornadas abiertas.");
  $("#appointmentForm").reset();$("#appointmentId").value=appointment?.id||"";$("#appointmentModalTitle").textContent=appointment?"Editar agendamiento":"Nuevo agendamiento";
  const requiresJourneyChoice=!appointment&&!forcedJourneyId&&journeys.length>1;
  $("#appointmentJourney").innerHTML=`${requiresJourneyChoice?'<option value="">Selecciona la jornada correcta…</option>':""}${journeys.map(j=>`<option value="${j.id}">${escapeHTML(j.nombre)} · ${escapeHTML(j.municipio)} · ${shortDate(j.fecha_brigada)}</option>`).join("")}`;
  $("#appointmentPatient").value="";$("#appointmentPatientSearch").value="";$("#selectedPatient").textContent="Ningún paciente seleccionado";$("#patientSearchResults").classList.add("hidden");$("#patientNotFound").classList.add("hidden");
  if(appointment?.paciente_id){const {data:selected}=await supabase.from("pacientes").select("id,nombre_completo,numero_identificacion,celular_principal").eq("id",appointment.paciente_id).maybeSingle();if(selected){patients=[selected];selectAppointmentPatient(selected);}}
  $("#appointmentJourney").value=forcedJourneyId||appointment?.jornada_id||(journeys.length===1?journeys[0].id:"");appointmentContextBrigade=forcedBrigadeId||appointment?.brigada_id||null;
  $("#appointmentFlyer").value=appointment?.numero_volante||"";$("#appointmentPayment").value=appointment?.abono||0;$("#appointmentNotes").value=appointment?.observaciones||"";recalculateAppointment();
  $("#appointmentJourney").onchange=()=>{if(appointmentContextBrigade){const context=brigades.find(b=>b.id===appointmentContextBrigade);if(context?.jornada_id!==$("#appointmentJourney").value)appointmentContextBrigade=null;}recalculateAppointment();};$("#appointmentPayment").oninput=recalculateAppointment;
  $("#appointmentPatientSearch").oninput=searchAppointmentPatients;
  $("#createPatientFromAppointment").onclick=()=>{const query=clean($("#appointmentPatientSearch").value);patientCreatedFromAppointment=true;$("#appointmentModal").classList.add("hidden");openPatient();if(/^\d+$/.test(query))$("#documentNumber").value=query;else $("#fullName").value=query;};
  $("#appointmentModal").classList.remove("hidden");
}
async function searchAppointmentPatients(){
  const q=clean($("#appointmentPatientSearch").value).toLowerCase(),results=$("#patientSearchResults"),notFound=$("#patientNotFound");
  $("#appointmentPatient").value="";$("#selectedPatient").textContent="Ningún paciente seleccionado";
  if(q.length<3){results.classList.add("hidden");notFound.classList.add("hidden");return;}
  clearTimeout(patientSearchTimer);patientSearchTimer=setTimeout(async()=>{const numeric=/^\d+$/.test(q),responses=await Promise.all((numeric?["identificacion","celular"]:["nombre"]).map(type=>supabase.rpc("buscar_pacientes",{p_tipo:type,p_valor:q})));const error=responses.find(x=>x.error)?.error;if(error)return toast(errorText(error));const matches=[...new Map(responses.flatMap(x=>x.data||[]).map(p=>[p.id,p])).values()].slice(0,8);patients=matches;
  if(!matches.length){results.classList.add("hidden");notFound.classList.remove("hidden");return;}
  notFound.classList.add("hidden");results.innerHTML=matches.map(p=>`<button type="button" class="search-result" data-id="${p.id}"><strong>${escapeHTML(p.nombre_completo)}</strong><small>${escapeHTML(p.numero_identificacion)} · ${escapeHTML(p.celular_principal)}</small></button>`).join("");results.classList.remove("hidden");
  $$(".search-result").forEach(b=>b.onclick=()=>selectAppointmentPatient(patients.find(p=>p.id===b.dataset.id)));
  },300);
}
function selectAppointmentPatient(patient){$("#appointmentPatient").value=patient.id;$("#appointmentPatientSearch").value=patient.nombre_completo;$("#selectedPatient").textContent=`Seleccionado: ${patient.nombre_completo} · ${patient.numero_identificacion} · ${patient.celular_principal}`;$("#patientSearchResults").classList.add("hidden");$("#patientNotFound").classList.add("hidden");}
function recalculateAppointment(){const journey=journeys.find(j=>j.id===$("#appointmentJourney").value),price=Number(journey?.valor_consulta||0),payment=Number($("#appointmentPayment").value||0);$("#appointmentPrice").value=cop(price);$("#appointmentBalance").value=cop(Math.max(price-payment,0));}
$$("[data-close-appointment]").forEach(b=>b.onclick=()=>$("#appointmentModal").classList.add("hidden"));
$("#appointmentForm").onsubmit=async event=>{
  event.preventDefault();const id=$("#appointmentId").value,journey=journeys.find(j=>j.id===$("#appointmentJourney").value);
  if(!journey)return toast("Debes seleccionar la jornada correcta antes de guardar.");
  const price=Number(journey.valor_consulta),credit=0,payment=Number($("#appointmentPayment").value||0);
  if(!$("#appointmentPatient").value)return toast("Busca y selecciona un paciente, o registra uno nuevo.");
  if(credit+payment>price)return toast("El abono y el saldo aplicado superan el valor de la consulta.");
  const previous=id?appointments.find(a=>a.id===id):null;
  if(appointmentFromBrigadeModule&&!appointmentContextBrigade){const operationalBrigade=await ensureOperationalBrigade(journey);if(!operationalBrigade)return;appointmentContextBrigade=operationalBrigade.id;}
  const record={paciente_id:$("#appointmentPatient").value,jornada_id:journey.id,brigada_id:appointmentContextBrigade,numero_volante:clean($("#appointmentFlyer").value),valor_consulta:price,saldo_favor_aplicado:credit,abono:payment,estado:previous?.estado||"registrada",observaciones:clean($("#appointmentNotes").value)||null};
  if(!id){const {error}=await supabase.rpc("registrar_agendamiento",{p_paciente:record.paciente_id,p_jornada:record.jornada_id,p_brigada:record.brigada_id,p_volante:record.numero_volante,p_valor:record.valor_consulta,p_saldo_favor:record.saldo_favor_aplicado,p_abono:record.abono,p_estado:record.estado,p_observaciones:record.observaciones});if(error)return toast(errorText(error));}
  else{if(payment<Number(previous.abono))return toast("No se puede reducir un abono. Debe registrarse una anulación.");const {error}=await supabase.from("agendamientos").update(record).eq("id",id);if(error)return toast(errorText(error));const difference=payment-Number(previous.abono);if(difference>0){const {error:movementError}=await supabase.from("movimientos_financieros").insert({paciente_id:record.paciente_id,jornada_id:record.jornada_id,brigada_id:record.brigada_id,agendamiento_id:id,tipo:"abono_agendamiento",valor:difference});if(movementError)return toast(errorText(movementError));}}
  $("#appointmentModal").classList.add("hidden");toast(id?"Agendamiento actualizado.":"Paciente agendado.");if($("#appointmentRows"))await loadAppointments();
};
async function changeAppointmentState(id,state){const {error}=await supabase.from("agendamientos").update({estado:state}).eq("id",id);if(error)return toast(errorText(error));toast("Cita confirmada.");await loadAppointments();}
function openWhatsApp(a){const phone=phoneDigits(a.pacientes?.celular_principal||"");if(!phone)return toast("El paciente no tiene celular.");const colombia=phone.length===10?"57"+phone:phone,msg=`Hola, ${a.pacientes.nombre_completo}. Te recordamos tu cita para ${a.jornadas.nombre}, programada para el ${shortDate(a.jornadas.fecha_brigada)}. Por favor confirma tu asistencia.`;window.open(`https://wa.me/${colombia}?text=${encodeURIComponent(msg)}`,"_blank","noopener");}
const phoneDigits=value=>String(value||"").replace(/\D/g,"");
const appointmentState=value=>({registrada:"Registrada",confirmada:"Confirmada",cumplida:"Cumplida",incumplida:"Incumplida",cancelada:"Cancelada",reprogramada:"Reprogramada"}[value]||capitalize(value));

async function renderCallCenter(){
  $("#pageName").textContent="Call Center CRM";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Call Center CRM</h1><p>Confirma y da seguimiento a los pacientes de cada jornada.</p></div></div>
    <div class="crm-toolbar"><label>Jornada de trabajo</label><select id="crmJourney"><option value="">Selecciona una jornada…</option></select><button class="secondary" id="refreshCrm">Actualizar</button></div>
    <div id="crmSummary" class="stats hidden"></div><div id="crmBoard" class="crm-board"><div class="empty" style="grid-column:1/-1"><b>Selecciona una jornada</b>El CRM mostrará únicamente sus pacientes.</div></div>`;
  const {data,error}=await supabase.from("jornadas").select("id,nombre,fecha_brigada,municipio,estado").eq("activo",true).eq("eliminado",false).in("estado",["abierta","inactiva"]).order("fecha_brigada",{ascending:false});
  if(error)return toast(errorText(error));journeys=data||[];
  $("#crmJourney").innerHTML=`<option value="">Selecciona una jornada…</option>${journeys.map(j=>`<option value="${j.id}">${escapeHTML(j.nombre)} · ${escapeHTML(j.municipio)} · ${shortDate(j.fecha_brigada)}</option>`).join("")}`;
  if(callCenterJourneyId&&journeys.some(j=>j.id===callCenterJourneyId)){$("#crmJourney").value=callCenterJourneyId;await loadCallCenter();}
  $("#crmJourney").onchange=async()=>{callCenterJourneyId=$("#crmJourney").value;if(callCenterJourneyId)await loadCallCenter();else{$("#crmSummary").classList.add("hidden");$("#crmBoard").innerHTML=`<div class="empty" style="grid-column:1/-1"><b>Selecciona una jornada</b>El CRM mostrará únicamente sus pacientes.</div>`;}};
  $("#refreshCrm").onclick=loadCallCenter;
}
async function loadCallCenter(){
  if(!callCenterJourneyId)return;
  $("#crmBoard").innerHTML=`<div class="empty" style="grid-column:1/-1">Cargando pacientes…</div>`;
  const [a,g]=await Promise.all([supabase.from("agendamientos").select("*, pacientes(id,nombre_completo,numero_identificacion,celular_principal), jornadas(id,nombre,fecha_brigada,lugar)").eq("jornada_id",callCenterJourneyId).eq("activo",true).neq("estado","cumplida").order("created_at"),supabase.from("gestiones_call_center").select("*, perfiles:usuario_id(nombre_completo)").order("created_at",{ascending:false})]);
  if(a.error||g.error){$("#crmBoard").innerHTML=`<div class="empty" style="grid-column:1/-1">${escapeHTML(errorText(a.error||g.error))}</div>`;return;}
  appointments=a.data||[];callGestures=(g.data||[]).filter(x=>appointments.some(a=>a.id===x.agendamiento_id));paintCallCenter();
}
function latestCallGesture(id){return callGestures.find(g=>g.agendamiento_id===id);}
function crmBucket(a){const latest=latestCallGesture(a.id);if(a.estado==="cancelada"||latest?.resultado==="cancelado")return"cancelados";if(a.estado==="confirmada")return"confirmados";if(latest?.resultado==="no_contesta"||latest?.resultado==="numero_equivocado")return"sin_respuesta";return"registrados";}
function paintCallCenter(){
  const groups={registrados:[],confirmados:[],sin_respuesta:[],cancelados:[]};appointments.forEach(a=>groups[crmBucket(a)].push(a));
  $("#crmSummary").classList.remove("hidden");$("#crmSummary").innerHTML=`<button class="stat filter-stat ${callCenterCrmFilter==="todos"?"active":""}" data-crm-filter="todos"><span>Todos</span><strong>${appointments.length}</strong></button><button class="stat filter-stat ${callCenterCrmFilter==="registrados"?"active":""}" data-crm-filter="registrados"><span>Registrados</span><strong>${groups.registrados.length}</strong></button><button class="stat filter-stat ${callCenterCrmFilter==="confirmados"?"active":""}" data-crm-filter="confirmados"><span>Confirmados</span><strong>${groups.confirmados.length}</strong></button><button class="stat filter-stat ${callCenterCrmFilter==="sin_respuesta"?"active":""}" data-crm-filter="sin_respuesta"><span>Sin respuesta</span><strong>${groups.sin_respuesta.length}</strong></button><button class="stat filter-stat ${callCenterCrmFilter==="cancelados"?"active":""}" data-crm-filter="cancelados"><span>Cancelados</span><strong>${groups.cancelados.length}</strong></button>`;
  const names={registrados:"Registrados",confirmados:"Confirmados",sin_respuesta:"Sin respuesta",cancelados:"Cancelados"};
  const visibleGroups=callCenterCrmFilter==="todos"?Object.entries(groups):[[callCenterCrmFilter,groups[callCenterCrmFilter]]];
  $("#crmBoard").style.gridTemplateColumns=callCenterCrmFilter==="todos"?"repeat(4,minmax(260px,1fr))":"minmax(280px,520px)";
  $("#crmBoard").innerHTML=visibleGroups.map(([key,list])=>`<section class="crm-column"><header><h3>${names[key]}</h3><span>${list.length}</span></header>${list.map(a=>crmCard(a)).join("")||'<div class="empty">Sin pacientes</div>'}</section>`).join("");
  $$("[data-crm-filter]").forEach(b=>b.onclick=()=>{callCenterCrmFilter=b.dataset.crmFilter;paintCallCenter();});
  $$(".crm-manage").forEach(b=>b.onclick=()=>openCallManagement(appointments.find(a=>a.id===b.dataset.id)));
  $$(".crm-call").forEach(b=>b.onclick=()=>{const a=appointments.find(x=>x.id===b.dataset.id);location.href=`tel:${phoneDigits(a.pacientes?.celular_principal)}`;});
  $$(".crm-whatsapp").forEach(b=>b.onclick=()=>openWhatsApp(appointments.find(a=>a.id===b.dataset.id)));
}
function crmCard(a){const latest=latestCallGesture(a.id),attempts=callGestures.filter(g=>g.agendamiento_id===a.id).length;return `<article class="crm-card"><h4>${escapeHTML(a.pacientes?.nombre_completo||"—")}</h4><p>${escapeHTML(a.pacientes?.numero_identificacion||"")} · ${escapeHTML(a.pacientes?.celular_principal||"")}</p><p>Volante ${escapeHTML(a.numero_volante)} · Saldo ${cop(a.saldo_pendiente)}</p><p>${latest?`Última gestión: ${callResultName(latest.resultado)} por ${escapeHTML(latest.perfiles?.nombre_completo||"Usuario")}`:"Sin gestión"} · ${attempts} intento(s)</p><div class="inline-actions"><button class="primary crm-manage" data-id="${a.id}">Gestionar</button><button class="secondary crm-call" data-id="${a.id}">Llamar</button><button class="secondary crm-whatsapp" data-id="${a.id}">WhatsApp</button></div></article>`;}
function openCallManagement(a){$("#callForm").reset();$("#callAppointmentId").value=a.id;$("#callPatientName").textContent=`${a.pacientes.nombre_completo} · ${a.pacientes.celular_principal}`;$("#callModal").classList.remove("hidden");}
$$("[data-close-call]").forEach(b=>b.onclick=()=>$("#callModal").classList.add("hidden"));
$("#callForm").onsubmit=async event=>{
  event.preventDefault();const appointmentId=$("#callAppointmentId").value,result=$("#callResult").value,record={agendamiento_id:appointmentId,resultado:result,observaciones:clean($("#callNotes").value)||null,proximo_contacto:$("#nextCallDate").value?new Date($("#nextCallDate").value).toISOString():null};
  const {error}=await supabase.from("gestiones_call_center").insert(record);if(error)return toast(errorText(error));
  if(result==="confirmado"){const update=await supabase.from("agendamientos").update({estado:"confirmada"}).eq("id",appointmentId);if(update.error)return toast(errorText(update.error));}
  if(result==="cancelado"){const update=await supabase.from("agendamientos").update({estado:"cancelada"}).eq("id",appointmentId);if(update.error)return toast(errorText(update.error));}
  $("#callModal").classList.add("hidden");toast("Gestión registrada.");await loadCallCenter();
};
const callResultName=value=>({contactado:"Contactado",confirmado:"Confirmado",no_contesta:"No contesta",numero_equivocado:"Número equivocado",cancelado:"Cancelado",reprogramar:"Reprogramar",whatsapp:"WhatsApp enviado"}[value]||value);

async function renderConsultations(){
  $("#pageName").textContent="Consultas optométricas";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Consultas optométricas</h1><p>Historia clínica de pacientes con cita cumplida.</p></div></div><div class="stats" id="consultationStats"></div><div class="grid"><article class="card"><div class="card-head"><div><h2>Pendientes de consulta</h2><p>Pacientes atendidos en brigada</p></div></div><div id="pendingConsultations" class="clinical-history" style="padding:0 20px 20px"><div class="empty">Cargando…</div></div></article><article class="card"><div class="card-head"><div><h2>Historial clínico</h2><p>Consultas registradas</p></div></div><div id="consultationHistory" class="clinical-history" style="padding:0 20px 20px"><div class="empty">Cargando…</div></div></article></div>`;
  const [a,c,d]=await Promise.all([supabase.from("agendamientos").select("*, pacientes(id,nombre_completo,numero_identificacion,celular_principal), jornadas(id,nombre,fecha_brigada), brigadas(id,nombre)").eq("estado","cumplida").eq("activo",true).order("updated_at",{ascending:false}),supabase.from("consultas_optometricas").select("*, pacientes(id,nombre_completo,numero_identificacion), jornadas(id,nombre), documentos_consulta(id,nombre_archivo,ruta_archivo)").order("created_at",{ascending:false}),supabase.from("documentos_consulta").select("id",{count:"exact"})]);
  if(a.error||c.error||d.error){const message=escapeHTML(errorText(a.error||c.error||d.error));$("#pendingConsultations").innerHTML=`<div class="empty">${message}</div>`;$("#consultationHistory").innerHTML="";return;}
  consultationAppointments=a.data||[];consultations=c.data||[];const completedIds=new Set(consultations.map(x=>x.agendamiento_id)),pending=consultationAppointments.filter(x=>!completedIds.has(x.id));
  $("#consultationStats").innerHTML=`<article class="stat"><span>Pendientes</span><strong>${pending.length}</strong></article><article class="stat"><span>Consultas registradas</span><strong>${consultations.length}</strong></article><article class="stat"><span>Documentos clínicos</span><strong>${d.count||0}</strong></article><article class="stat"><span>Próximos controles</span><strong>${consultations.filter(x=>x.proximo_control&&x.proximo_control>=localDateValue(new Date())).length}</strong></article>`;
  $("#pendingConsultations").innerHTML=pending.length?pending.map(a=>`<article class="clinical-record"><h3>${escapeHTML(a.pacientes.nombre_completo)}</h3><p>${escapeHTML(a.pacientes.numero_identificacion)} · ${escapeHTML(a.jornadas.nombre)}</p><button class="primary start-consultation" data-id="${a.id}">Registrar consulta</button></article>`).join(""):`<div class="empty"><b>No hay consultas pendientes</b>Las citas cumplidas aparecerán aquí.</div>`;
  $("#consultationHistory").innerHTML=consultations.length?consultations.map(c=>`<article class="clinical-record"><h3>${escapeHTML(c.pacientes.nombre_completo)}</h3><p>${formatDate(c.created_at)} · ${escapeHTML(c.optometra)}</p><p><strong>${escapeHTML(c.diagnostico)}</strong></p><div class="inline-actions"><button class="secondary view-consultation" data-id="${c.id}">Ver detalle</button>${(c.documentos_consulta||[]).map(doc=>`<button class="secondary clinical-document" data-path="${escapeHTML(doc.ruta_archivo)}">Ver orden</button>`).join("")}</div></article>`).join(""):`<div class="empty">Sin consultas registradas.</div>`;
  $$(".start-consultation").forEach(b=>b.onclick=()=>openConsultation(consultationAppointments.find(a=>a.id===b.dataset.id)));
  $$(".view-consultation").forEach(b=>b.onclick=()=>showConsultationDetail(consultations.find(c=>c.id===b.dataset.id)));
  $$(".clinical-document").forEach(b=>b.onclick=async()=>{const {data,error}=await supabase.storage.from("documentos-clinicos").createSignedUrl(b.dataset.path,60);if(error)return toast(errorText(error));window.open(data.signedUrl,"_blank","noopener");});
}
async function openConsultation(appointment){$("#consultationForm").reset();$("#consultationAppointmentId").value=appointment.id;$("#consultationPatientName").textContent=`${appointment.pacientes.nombre_completo} · ${appointment.jornadas.nombre}`;$("#optometrist").value=currentProfile?.nombre_completo||"";const {data}=await supabase.from("materiales").select("nombre").eq("activo",true).order("nombre");$("#lensOptions").innerHTML=(data||[]).map(x=>`<option value="${escapeHTML(x.nombre)}"></option>`).join("");$("#consultationModal").classList.remove("hidden");}
$$("[data-close-consultation]").forEach(b=>b.onclick=()=>$("#consultationModal").classList.add("hidden"));
$("#consultationForm").onsubmit=async event=>{
  event.preventDefault();const appointment=consultationAppointments.find(a=>a.id===$("#consultationAppointmentId").value),record={agendamiento_id:appointment.id,paciente_id:appointment.paciente_id,jornada_id:appointment.jornada_id,brigada_id:appointment.brigada_id,optometra:clean($("#optometrist").value),diagnostico:clean($("#diagnosis").value),formula_od:{esfera:clean($("#odSphere").value),cilindro:clean($("#odCylinder").value),eje:$("#odAxis").value||null,adicion:clean($("#odAddition").value)},formula_oi:{esfera:clean($("#oiSphere").value),cilindro:clean($("#oiCylinder").value),eje:$("#oiAxis").value||null,adicion:clean($("#oiAddition").value)},distancia_pupilar:clean($("#pupillaryDistance").value)||null,tipo_lente_recomendado:clean($("#recommendedLens").value)||null,recomendaciones:clean($("#recommendations").value)||null,observaciones:clean($("#clinicalNotes").value)||null,proximo_control:$("#nextControl").value||null};
  const {data:consultation,error}=await supabase.from("consultas_optometricas").insert(record).select().single();if(error)return toast(errorText(error));const file=$("#medicalDocument").files[0];
  if(file){const {data:{user}}=await supabase.auth.getUser(),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_"),path=`${user.id}/${appointment.paciente_id}/${consultation.id}-${safeName}`,upload=await supabase.storage.from("documentos-clinicos").upload(path,file,{contentType:file.type,upsert:false});if(upload.error)return toast(`Consulta guardada, pero el documento falló: ${errorText(upload.error)}`);const documentSave=await supabase.from("documentos_consulta").insert({consulta_id:consultation.id,paciente_id:appointment.paciente_id,ruta_archivo:path,nombre_archivo:file.name,tipo_archivo:file.type,tamano_bytes:file.size});if(documentSave.error)return toast(`Consulta guardada, pero faltó registrar el documento: ${errorText(documentSave.error)}`);}
  $("#consultationModal").classList.add("hidden");toast("Consulta clínica guardada.");await renderConsultations();
};
function showConsultationDetail(c){const od=c.formula_od||{},oi=c.formula_oi||{};$("#content").innerHTML=`<div class="page-hero"><div><h1>${escapeHTML(c.pacientes.nombre_completo)}</h1><p>Consulta del ${formatDate(c.created_at)}</p></div><button class="secondary" id="backConsultations">← Volver</button></div><article class="card profile-card"><img class="profile-logo" src="./logo.png" alt=""><div class="profile-data"><div><span>Optómetra</span><strong>${escapeHTML(c.optometra)}</strong></div><div><span>Diagnóstico</span><strong>${escapeHTML(c.diagnostico)}</strong></div><div><span>Ojo derecho</span><strong>Esf ${escapeHTML(od.esfera||"—")} · Cil ${escapeHTML(od.cilindro||"—")} · Eje ${escapeHTML(od.eje||"—")}</strong></div><div><span>Ojo izquierdo</span><strong>Esf ${escapeHTML(oi.esfera||"—")} · Cil ${escapeHTML(oi.cilindro||"—")} · Eje ${escapeHTML(oi.eje||"—")}</strong></div><div><span>Distancia pupilar</span><strong>${escapeHTML(c.distancia_pupilar||"—")}</strong></div><div><span>Lente recomendado</span><strong>${escapeHTML(c.tipo_lente_recomendado||"—")}</strong></div><div><span>Recomendaciones</span><strong>${escapeHTML(c.recomendaciones||"—")}</strong></div><div><span>Próximo control</span><strong>${c.proximo_control?shortDate(c.proximo_control):"Sin definir"}</strong></div></div></article>`;$("#backConsultations").onclick=renderConsultations;}

async function loadProductCatalogs(){const [m,f,t,r]=await Promise.all([supabase.from("materiales").select("*").eq("activo",true).order("nombre"),supabase.from("filtros").select("*").eq("activo",true).order("nombre"),supabase.from("tratamientos").select("*").eq("activo",true).order("nombre"),supabase.from("tarifas_productos").select("*, materiales(nombre), filtros(nombre), tratamientos(nombre)").eq("activo",true).order("vigente_desde",{ascending:false})]);if(m.error||f.error||t.error||r.error)throw(m.error||f.error||t.error||r.error);productCatalogs={materials:m.data||[],filters:f.data||[],treatments:t.data||[],tariffs:r.data||[]};}
async function renderProducts(){$("#pageName").textContent="Productos y precios";$("#content").innerHTML=`<div class="page-hero"><div><h1>Productos y precios</h1><p>Catálogos y combinaciones vigentes.</p></div><div class="inline-actions"><button class="secondary add-catalog" data-type="materiales">＋ Material</button><button class="secondary add-catalog" data-type="filtros">＋ Filtro</button><button class="secondary add-catalog" data-type="tratamientos">＋ Tratamiento</button><button class="primary" id="newTariff">＋ Nueva tarifa</button></div></div><div id="productArea" class="empty">Cargando…</div>`;try{await loadProductCatalogs();}catch(error){return $("#productArea").innerHTML=errorText(error);}$("#productArea").className="";$("#productArea").innerHTML=`<div class="stats"><article class="stat"><span>Materiales</span><strong>${productCatalogs.materials.length}</strong></article><article class="stat"><span>Filtros</span><strong>${productCatalogs.filters.length}</strong></article><article class="stat"><span>Tratamientos</span><strong>${productCatalogs.treatments.length}</strong></article><article class="stat"><span>Tarifas activas</span><strong>${productCatalogs.tariffs.length}</strong></article></div><article class="card"><div class="card-head"><div><h2>Tarifas configuradas</h2></div></div><div class="table-wrap"><table><thead><tr><th>Material</th><th>Filtro</th><th>Tratamiento</th><th>Precio</th><th>Vigente desde</th></tr></thead><tbody>${productCatalogs.tariffs.map(x=>`<tr><td>${escapeHTML(x.materiales.nombre)}</td><td>${escapeHTML(x.filtros.nombre)}</td><td>${escapeHTML(x.tratamientos.nombre)}</td><td>${cop(x.precio)}</td><td>${shortDate(x.vigente_desde)}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">Configura la primera tarifa.</td></tr>'}</tbody></table></div></article>`;$$('.add-catalog').forEach(b=>b.onclick=()=>openCatalog(b.dataset.type));$("#newTariff").onclick=openTariff;}
function openCatalog(type){$("#catalogForm").reset();$("#catalogType").value=type;$("#catalogTitle").textContent=`Nuevo ${type==="materiales"?"material":type==="filtros"?"filtro":"tratamiento"}`;$("#catalogModal").classList.remove("hidden");}
$$("[data-close-catalog]").forEach(b=>b.onclick=()=>$("#catalogModal").classList.add("hidden"));$("#catalogForm").onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from($("#catalogType").value).insert({nombre:clean($("#catalogName").value),descripcion:clean($("#catalogDescription").value)||null});if(error)return toast(errorText(error));$("#catalogModal").classList.add("hidden");toast("Catálogo actualizado.");await renderProducts();};
function options(list){return list.map(x=>`<option value="${x.id}">${escapeHTML(x.nombre)}</option>`).join("");}function openTariff(){if(!productCatalogs.materials.length||!productCatalogs.filters.length||!productCatalogs.treatments.length)return toast("Primero crea materiales, filtros y tratamientos.");$("#tariffForm").reset();$("#tariffMaterial").innerHTML=options(productCatalogs.materials);$("#tariffFilter").innerHTML=options(productCatalogs.filters);$("#tariffTreatment").innerHTML=options(productCatalogs.treatments);$("#tariffStart").value=localDateValue(new Date());$("#tariffModal").classList.remove("hidden");}
$$("[data-close-tariff]").forEach(b=>b.onclick=()=>$("#tariffModal").classList.add("hidden"));$("#tariffForm").onsubmit=async e=>{e.preventDefault();const {error}=await supabase.from("tarifas_productos").insert({material_id:$("#tariffMaterial").value,filtro_id:$("#tariffFilter").value,tratamiento_id:$("#tariffTreatment").value,precio:Number($("#tariffPrice").value),vigente_desde:$("#tariffStart").value});if(error)return toast(errorText(error));$("#tariffModal").classList.add("hidden");toast("Tarifa creada.");await renderProducts();};

async function renderSales(){$("#pageName").textContent="Ventas";$("#content").innerHTML=`<div class="page-hero"><div><h1>Ventas</h1><p>Ventas relacionadas con consultas optométricas.</p></div><button class="primary" id="newSale">＋ Registrar venta</button></div><div id="salesArea" class="empty">Cargando…</div>`;const [s,c]=await Promise.all([supabase.from("ventas").select("*, pacientes(nombre_completo), ventas_detalle(*,materiales(nombre),filtros(nombre),tratamientos(nombre))").order("created_at",{ascending:false}),supabase.from("consultas_optometricas").select("id,paciente_id,pacientes(nombre_completo,numero_identificacion),jornadas(nombre)").order("created_at",{ascending:false})]);if(s.error||c.error)return $("#salesArea").textContent=errorText(s.error||c.error);saleConsultations=c.data||[];const sales=s.data||[];$("#salesArea").className="";$("#salesArea").innerHTML=`<div class="stats"><article class="stat"><span>Ventas</span><strong>${sales.length}</strong></article><article class="stat"><span>Total vendido</span><strong>${cop(sales.reduce((n,x)=>n+Number(x.total),0))}</strong></article><article class="stat"><span>Abonos</span><strong>${cop(sales.reduce((n,x)=>n+Number(x.abono),0))}</strong></article><article class="stat"><span>Saldo pendiente</span><strong>${cop(sales.reduce((n,x)=>n+Number(x.saldo),0))}</strong></article></div><article class="card"><div class="table-wrap"><table><thead><tr><th>Venta</th><th>Paciente</th><th>Total</th><th>Abono</th><th>Saldo</th><th>Estado</th></tr></thead><tbody>${sales.map(x=>`<tr><td>${escapeHTML(x.numero_venta)}</td><td>${escapeHTML(x.pacientes.nombre_completo)}</td><td>${cop(x.total)}</td><td>${cop(x.abono)}</td><td>${cop(x.saldo)}</td><td><span class="badge">${capitalize(x.estado)}</span></td></tr>`).join("")||'<tr><td colspan="6" class="empty">No hay ventas registradas.</td></tr>'}</tbody></table></div></article>`;$("#newSale").onclick=openSale;}
async function openSale(){try{await loadProductCatalogs();}catch(error){return toast(errorText(error));}if(!saleConsultations.length)return toast("Primero registra una consulta optométrica.");if(!productCatalogs.tariffs.length)return toast("Primero configura una tarifa.");$("#saleForm").reset();$("#saleConsultation").innerHTML=saleConsultations.map(c=>`<option value="${c.id}">${escapeHTML(c.pacientes.nombre_completo)} · ${escapeHTML(c.jornadas.nombre)}</option>`).join("");$("#saleMaterial").innerHTML=options(productCatalogs.materials);$("#saleFilter").innerHTML=options(productCatalogs.filters);$("#saleTreatment").innerHTML=options(productCatalogs.treatments);[$("#saleMaterial"),$("#saleFilter"),$("#saleTreatment"),$("#saleQuantity"),$("#saleDiscount"),$("#salePayment")].forEach(x=>x.oninput=calculateSale);calculateSale();$("#saleModal").classList.remove("hidden");}
function selectedTariff(){return productCatalogs.tariffs.find(x=>x.material_id===$("#saleMaterial").value&&x.filtro_id===$("#saleFilter").value&&x.tratamiento_id===$("#saleTreatment").value&&x.vigente_desde<=localDateValue(new Date()));}function calculateSale(){const tariff=selectedTariff(),price=Number(tariff?.precio||0),qty=Number($("#saleQuantity").value||1),discount=Number($("#saleDiscount").value||0),payment=Number($("#salePayment").value||0),total=Math.max(price*qty-discount,0);$("#salePrice").value=tariff?cop(price):"Sin tarifa configurada";$("#saleSummary").value=`Total ${cop(total)} · Saldo ${cop(Math.max(total-payment,0))}`;}
$$("[data-close-sale]").forEach(b=>b.onclick=()=>$("#saleModal").classList.add("hidden"));$("#saleForm").onsubmit=async e=>{e.preventDefault();if(!selectedTariff())return toast("Esta combinación no tiene un precio configurado.");const {error}=await supabase.rpc("registrar_venta",{p_consulta:$("#saleConsultation").value,p_material:$("#saleMaterial").value,p_filtro:$("#saleFilter").value,p_tratamiento:$("#saleTreatment").value,p_cantidad:Number($("#saleQuantity").value),p_descuento:Number($("#saleDiscount").value||0),p_abono:Number($("#salePayment").value||0),p_metodo:$("#saleMethod").value,p_entrega:$("#saleDelivery").value||null,p_observaciones:clean($("#saleNotes").value)||null});if(error)return toast(errorText(error));$("#saleModal").classList.add("hidden");toast("Venta registrada.");await renderSales();};
let paymentRows=[],paymentSales=[],reportData={appointments:[],movements:[],sales:[]};
async function renderPayments(){
  $("#pageName").textContent="Recaudos";$("#content").innerHTML=`<div class="page-hero"><div><h1>Recaudos</h1><p>Control del dinero recibido y de los saldos por cobrar.</p></div><button class="secondary" id="refreshPayments">Actualizar</button></div><div class="stats" id="paymentStats"><article class="stat"><span>Cargando</span><strong>…</strong></article></div><article class="card payment-card"><div class="card-head"><div><h2>Movimientos financieros</h2><p>Agendamiento, brigada y ventas en una sola bandeja</p></div><button class="secondary" id="exportPayments">Exportar CSV</button></div><div class="report-filters"><label>Desde<input id="paymentFrom" type="date"></label><label>Hasta<input id="paymentTo" type="date"></label><label>Jornada<select id="paymentJourney"><option value="">Todas</option></select></label><label>Canal<select id="paymentChannel"><option value="">Todos</option><option value="agendamiento">Agendamiento</option><option value="brigada">Brigada</option><option value="administracion">Administración</option></select></label><label>Medio de pago<select id="paymentMethod"><option value="">Todos</option><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></label><label>Usuario<select id="paymentUser"><option value="">Todos</option></select></label></div><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Paciente</th><th>Jornada</th><th>Concepto</th><th>Canal</th><th>Medio</th><th>Recibido por</th><th>Valor</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="paymentRows"></tbody></table></div></article><article class="card payment-card"><div class="card-head"><div><h2>Cartera de ventas</h2><p>Ventas con saldo pendiente</p></div></div><div id="salesDebt" class="debt-grid"></div></article>`;
  $("#refreshPayments").onclick=renderPayments;$("#exportPayments").onclick=()=>exportPaymentCsv(filteredPayments());await loadPayments();
}
async function loadPayments(){const [m,s]=await Promise.all([supabase.from("movimientos_financieros").select("*, pacientes(nombre_completo,numero_identificacion), jornadas(nombre), perfiles:recibido_por(nombre_completo)").order("created_at",{ascending:false}).limit(2000),supabase.from("ventas").select("id,numero_venta,total,abono,saldo,estado,pacientes(nombre_completo,numero_identificacion),jornadas(nombre)").gt("saldo",0).neq("estado","anulada").order("created_at",{ascending:false})]);if(m.error||s.error){$("#paymentRows").innerHTML=`<tr><td colspan="10" class="empty">${escapeHTML(errorText(m.error||s.error))}</td></tr>`;return;}paymentRows=m.data||[];paymentSales=s.data||[];fillSelect("#paymentJourney",paymentRows.map(x=>[x.jornada_id,x.jornadas?.nombre]));fillSelect("#paymentUser",paymentRows.map(x=>[x.recibido_por,x.perfiles?.nombre_completo]));["#paymentFrom","#paymentTo","#paymentJourney","#paymentChannel","#paymentMethod","#paymentUser"].forEach(id=>$(id).onchange=paintPayments);paintPayments();paintSalesDebt();}
function fillSelect(selector,rows){const el=$(selector),first=el.options[0].outerHTML,current=el.value,unique=[...new Map(rows.filter(x=>x[0]).map(x=>[x[0],x[1]||"Sin nombre"])).entries()];el.innerHTML=first+unique.map(([id,name])=>`<option value="${id}">${escapeHTML(name)}</option>`).join("");el.value=current;}
function filteredPayments(){const from=$("#paymentFrom")?.value,to=$("#paymentTo")?.value,j=$("#paymentJourney")?.value,c=$("#paymentChannel")?.value,method=$("#paymentMethod")?.value,u=$("#paymentUser")?.value;return paymentRows.filter(x=>(!from||x.created_at.slice(0,10)>=from)&&(!to||x.created_at.slice(0,10)<=to)&&(!j||x.jornada_id===j)&&(!c||x.canal===c)&&(!method||x.metodo_pago===method)&&(!u||x.recibido_por===u));}
function paintPayments(){const list=filteredPayments(),active=list.filter(x=>x.estado==="activo"),types={abono_agendamiento:"Abono en agenda",pago_brigada:"Pago en brigada",pago_venta:"Pago de venta",anulacion:"Anulación",devolucion:"Devolución",ajuste:"Ajuste"};$("#paymentStats").innerHTML=`<article class="stat"><span>Recaudo neto filtrado</span><strong>${cop(netMovements(active))}</strong></article><article class="stat"><span>En agendamiento</span><strong>${cop(active.filter(x=>x.canal==="agendamiento").reduce((n,x)=>n+Number(x.valor),0))}</strong></article><article class="stat"><span>En brigada</span><strong>${cop(active.filter(x=>x.canal==="brigada").reduce((n,x)=>n+Number(x.valor),0))}</strong></article><article class="stat"><span>Cartera de ventas</span><strong>${cop(paymentSales.reduce((n,x)=>n+Number(x.saldo),0))}</strong></article>`;$("#paymentRows").innerHTML=list.map(x=>`<tr><td>${formatDate(x.created_at)}</td><td><strong>${escapeHTML(x.pacientes?.nombre_completo||"—")}</strong><small>${escapeHTML(x.pacientes?.numero_identificacion||"")}</small></td><td>${escapeHTML(x.jornadas?.nombre||"—")}</td><td>${escapeHTML(types[x.tipo]||capitalize(x.tipo))}</td><td>${capitalize(x.canal)}</td><td>${capitalize(x.metodo_pago)}</td><td>${escapeHTML(x.perfiles?.nombre_completo||"—")}</td><td class="money ${["anulacion","devolucion"].includes(x.tipo)?"negative":""}">${["anulacion","devolucion"].includes(x.tipo)?"−":""}${cop(x.valor)}</td><td><span class="badge ${x.estado==="anulado"?"closed":""}">${capitalize(x.estado)}</span></td><td>${x.estado==="activo"&&!['anulacion','devolucion'].includes(x.tipo)?`<button class="secondary void-payment" data-id="${x.id}">Anular</button>`:"—"}</td></tr>`).join("")||'<tr><td colspan="10" class="empty">No hay movimientos con estos filtros.</td></tr>';$$(".void-payment").forEach(b=>b.onclick=()=>voidPayment(b.dataset.id));}
function paintSalesDebt(){$("#salesDebt").innerHTML=paymentSales.map(v=>`<article class="debt-card"><div><strong>${escapeHTML(v.pacientes?.nombre_completo||"—")}</strong><span>${escapeHTML(v.numero_venta)} · ${escapeHTML(v.jornadas?.nombre||"")}</span></div><div><small>Saldo pendiente</small><b>${cop(v.saldo)}</b></div><button class="primary collect-sale" data-id="${v.id}" data-balance="${v.saldo}">Registrar pago</button></article>`).join("")||'<div class="empty"><b>Cartera al día</b>No hay ventas con saldo pendiente.</div>';$$(".collect-sale").forEach(b=>b.onclick=()=>collectSale(b.dataset.id,Number(b.dataset.balance)));}
async function collectSale(id,balance){const raw=prompt(`Valor recibido (máximo ${cop(balance)}):`,String(balance));if(raw===null)return;const value=Number(String(raw).replace(/[^0-9.-]/g,""));if(!value||value>balance)return toast("Escribe un valor válido que no supere el saldo.");const method=prompt("Medio de pago: efectivo, transferencia, tarjeta u otro","efectivo");if(method===null)return;const notes=prompt("Observación opcional","");const {error}=await supabase.rpc("registrar_pago_venta",{p_venta:id,p_valor:value,p_metodo:clean(method).toLowerCase(),p_observaciones:clean(notes)||null});if(error)return toast(errorText(error));toast("Pago registrado correctamente.");await loadPayments();}
async function voidPayment(id){const reason=prompt("Indica el motivo de la anulación (obligatorio):","");if(reason===null)return;if(clean(reason).length<5)return toast("El motivo debe tener al menos 5 caracteres.");if(!confirm("Se conservará el movimiento original como anulado. ¿Continuar?"))return;const {error}=await supabase.rpc("anular_movimiento",{p_movimiento:id,p_motivo:clean(reason)});if(error)return toast(errorText(error));toast("Movimiento anulado con trazabilidad.");await loadPayments();}

async function renderReports(){$("#pageName").textContent="Reportes";$("#content").innerHTML=`<div class="page-hero"><div><h1>Reportes</h1><p>Resultados por jornada, municipio y promotor.</p></div><button class="primary" id="exportReport">Exportar CSV</button></div><article class="card"><div class="report-filters"><label>Desde<input id="reportFrom" type="date"></label><label>Hasta<input id="reportTo" type="date"></label><label>Jornada<select id="reportJourney"><option value="">Todas</option></select></label><label>Municipio<select id="reportCity"><option value="">Todos</option></select></label><label>Promotor<select id="reportPromoter"><option value="">Todos</option></select></label><button class="secondary" id="applyReport">Aplicar filtros</button></div></article><div class="stats" id="reportStats"></div><div class="analytics-grid"><article class="card"><div class="card-head"><div><h2>Conversión de pacientes</h2><p>Confirmación, asistencia y venta</p></div></div><div id="conversionBars" class="metric-bars"></div></article><article class="card"><div class="card-head"><div><h2>Recaudo por jornada</h2><p>Ingresos netos</p></div></div><div id="journeyRevenueBars" class="metric-bars"></div></article></div><article class="card payment-card"><div class="card-head"><div><h2>Desempeño detallado</h2><p>Una fila por jornada</p></div></div><div class="table-wrap"><table><thead><tr><th>Jornada</th><th>Municipio</th><th>Agendadas</th><th>Confirmadas</th><th>Cumplidas</th><th>Canceladas/incumplidas</th><th>Ventas</th><th>Recaudo</th></tr></thead><tbody id="reportRows"></tbody></table></div></article>`;$("#applyReport").onclick=paintReports;$("#exportReport").onclick=exportReportCsv;await loadReports();}
async function loadReports(){const [a,m,v]=await Promise.all([supabase.from("agendamientos").select("id,estado,created_at,creado_por,jornada_id,jornadas(nombre,municipio,fecha_brigada),perfiles:creado_por(nombre_completo)"),supabase.from("movimientos_financieros").select("jornada_id,tipo,valor,estado,created_at"),supabase.from("ventas").select("jornada_id,total,estado,created_at")]);if(a.error||m.error||v.error)return toast(errorText(a.error||m.error||v.error));reportData={appointments:a.data||[],movements:m.data||[],sales:v.data||[]};fillSelect("#reportJourney",reportData.appointments.map(x=>[x.jornada_id,x.jornadas?.nombre]));fillSelect("#reportPromoter",reportData.appointments.map(x=>[x.creado_por,x.perfiles?.nombre_completo]));fillSelect("#reportCity",reportData.appointments.map(x=>[x.jornadas?.municipio,x.jornadas?.municipio]));paintReports();}
function reportAppointments(){const from=$("#reportFrom").value,to=$("#reportTo").value,j=$("#reportJourney").value,city=$("#reportCity").value,p=$("#reportPromoter").value;return reportData.appointments.filter(x=>(!from||x.created_at.slice(0,10)>=from)&&(!to||x.created_at.slice(0,10)<=to)&&(!j||x.jornada_id===j)&&(!city||x.jornadas?.municipio===city)&&(!p||x.creado_por===p));}
function paintReports(){const list=reportAppointments(),ids=new Set(list.map(x=>x.jornada_id)),from=$("#reportFrom").value,to=$("#reportTo").value,moves=reportData.movements.filter(x=>ids.has(x.jornada_id)&&x.estado==="activo"&&(!from||x.created_at.slice(0,10)>=from)&&(!to||x.created_at.slice(0,10)<=to)),sales=reportData.sales.filter(x=>ids.has(x.jornada_id)&&x.estado!=="anulada"&&(!from||x.created_at.slice(0,10)>=from)&&(!to||x.created_at.slice(0,10)<=to)),fulfilled=list.filter(x=>x.estado==="cumplida").length,confirmed=list.filter(x=>["confirmada","cumplida"].includes(x.estado)).length;$("#reportStats").innerHTML=`<article class="stat"><span>Agendamientos</span><strong>${list.length}</strong></article><article class="stat"><span>Confirmación</span><strong>${percent(confirmed,list.length)}</strong></article><article class="stat"><span>Asistencia</span><strong>${percent(fulfilled,list.length)}</strong></article><article class="stat"><span>Conversión a venta</span><strong>${percent(sales.length,fulfilled)}</strong></article>`;paintMetricBars("#conversionBars",{Registradas:list.filter(x=>x.estado==="registrada").length,Confirmadas:confirmed,Cumplidas:fulfilled,Ventas:sales.length},list.length);const revenue={};moves.forEach(x=>{const name=list.find(a=>a.jornada_id===x.jornada_id)?.jornadas?.nombre||"Sin jornada";revenue[name]=(revenue[name]||0)+(["anulacion","devolucion"].includes(x.tipo)?-1:1)*Number(x.valor);});paintMetricBars("#journeyRevenueBars",revenue,Math.max(...Object.values(revenue),0));const grouped=[...new Map(list.map(x=>[x.jornada_id,x.jornadas])).entries()];$("#reportRows").innerHTML=grouped.map(([id,j])=>{const rows=list.filter(x=>x.jornada_id===id),rv=netMovements(moves.filter(x=>x.jornada_id===id));return `<tr><td><strong>${escapeHTML(j?.nombre||"—")}</strong><small>${j?.fecha_brigada?shortDate(j.fecha_brigada):""}</small></td><td>${escapeHTML(j?.municipio||"—")}</td><td>${rows.length}</td><td>${rows.filter(x=>["confirmada","cumplida"].includes(x.estado)).length}</td><td>${rows.filter(x=>x.estado==="cumplida").length}</td><td>${rows.filter(x=>["cancelada","incumplida"].includes(x.estado)).length}</td><td>${sales.filter(x=>x.jornada_id===id).length}</td><td>${cop(rv)}</td></tr>`;}).join("")||'<tr><td colspan="8" class="empty">No hay datos con estos filtros.</td></tr>';}
function navigateTo(view){document.querySelector(`.nav[data-view="${view}"]`)?.click();}function countBy(rows,key){return rows.reduce((o,x)=>(o[capitalize(x[key]||"Sin dato")]=(o[capitalize(x[key]||"Sin dato")]||0)+1,o),{});}function sumBy(rows,key,value){return rows.reduce((o,x)=>(o[capitalize(x[key]||"Sin dato")]=(o[capitalize(x[key]||"Sin dato")]||0)+Number(x[value]||0),o),{});}function netMovements(rows){return rows.reduce((n,x)=>n+(x.tipo==="anulacion"?0:x.tipo==="devolucion"?-1:1)*Number(x.valor||0),0);}function percent(n,d){return `${d?Math.round(n/d*100):0}%`;}
function paintMetricBars(selector,data,max){const node=$(selector);if(!node)return;const entries=Object.entries(data);node.innerHTML=entries.map(([name,value])=>`<div class="metric-row"><div><span>${escapeHTML(name)}</span><strong>${Number(value).toLocaleString("es-CO")}</strong></div><i><b style="width:${max?Math.max(Number(value)/max*100,2):0}%"></b></i></div>`).join("")||'<div class="empty">Aún no hay datos.</div>';}
function csvDownload(name,headers,rows){const quote=v=>`"${String(v??"").replace(/"/g,'""')}"`,content="\ufeff"+[headers,...rows].map(r=>r.map(quote).join(";")).join("\r\n"),url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}function exportPaymentCsv(list){csvDownload(`recaudos-${localDateValue(new Date())}.csv`,["Fecha","Paciente","Identificación","Jornada","Tipo","Canal","Medio","Usuario","Valor","Estado"],list.map(x=>[x.created_at,x.pacientes?.nombre_completo,x.pacientes?.numero_identificacion,x.jornadas?.nombre,x.tipo,x.canal,x.metodo_pago,x.perfiles?.nombre_completo,x.valor,x.estado]));}function exportReportCsv(){const list=reportAppointments();csvDownload(`reporte-jornadas-${localDateValue(new Date())}.csv`,["Jornada","Municipio","Fecha","Promotor","Estado cita","Fecha registro"],list.map(x=>[x.jornadas?.nombre,x.jornadas?.municipio,x.jornadas?.fecha_brigada,x.perfiles?.nombre_completo,x.estado,x.created_at]));}

async function loadCurrentPermissions(){const [rp,up]=await Promise.all([supabase.from("roles_permisos").select("permisos(codigo)").eq("rol_id",currentProfile?.rol_id||"00000000-0000-0000-0000-000000000000"),supabase.from("usuarios_permisos").select("permitido,permisos(codigo)").eq("usuario_id",currentProfile?.id||"00000000-0000-0000-0000-000000000000")]);currentPermissions=new Set((rp.data||[]).map(x=>x.permisos?.codigo).filter(Boolean));(up.data||[]).forEach(x=>{const code=x.permisos?.codigo;if(code)x.permitido?currentPermissions.add(code):currentPermissions.delete(code);});applyNavigationPermissions();}
function hasPermission(code){return currentProfile?.roles?.nombre==="Superadministrador"||currentPermissions.has(code);}function applyNavigationPermissions(){$$(".nav[data-permission]").forEach(node=>{const allowed=node.dataset.permission.split("|").some(hasPermission);node.classList.toggle("permission-hidden",!allowed);node.disabled=!allowed;});const label=$(".nav-label");if(label){const adminVisible=$$(".nav-label~.nav[data-permission]").some(n=>!n.classList.contains("permission-hidden"));label.classList.toggle("permission-hidden",!adminVisible);}}

let adminRoles=[],adminPermissions=[],adminRolePermissions=[],adminUsers=[];
async function renderUsers(){
  $("#pageName").textContent="Usuarios y permisos";$("#content").innerHTML=`<div class="page-hero"><div><h1>Usuarios y permisos</h1><p>Asigna roles y decide qué módulos puede utilizar cada uno.</p></div><div class="inline-actions"><button class="primary" id="newUser">＋ Nuevo usuario</button><button class="secondary" id="newRole">＋ Crear rol</button></div></div><div class="access-tabs"><button class="active" data-access-tab="users">Usuarios</button><button data-access-tab="roles">Roles y módulos</button></div><section id="accessUsers"><article class="card"><div class="card-head"><div><h2>Equipo de trabajo</h2><p>Crea cuentas, asigna roles y controla su estado.</p></div></div><div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Contacto</th><th>Rol asignado</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="adminUserRows"><tr><td colspan="5" class="empty">Cargando…</td></tr></tbody></table></div></article></section><section id="accessRoles" class="hidden"><div class="role-admin-grid"><aside class="card"><div class="card-head"><div><h2>Roles</h2><p>Selecciona uno para configurarlo</p></div></div><div id="roleList" class="role-list"></div></aside><article class="card"><div class="card-head"><div><h2 id="rolePermissionTitle">Módulos del rol</h2><p>Marca las acciones permitidas. El menú se adaptará automáticamente.</p></div><button class="primary" id="saveRolePermissions">Guardar permisos</button></div><div id="permissionGroups" class="permission-groups"><div class="empty">Selecciona un rol.</div></div></article></div></section>`;
  if(!hasPermission("permisos.administrar"))$("#newRole").classList.add("hidden");if(!hasPermission("usuarios.administrar"))$("#newUser").classList.add("hidden");$("#newUser").onclick=openNewUser;$("#newRole").onclick=openNewRole;$$('[data-access-tab]').forEach(b=>b.onclick=()=>{$$('[data-access-tab]').forEach(x=>x.classList.toggle("active",x===b));$("#accessUsers").classList.toggle("hidden",b.dataset.accessTab!=="users");$("#accessRoles").classList.toggle("hidden",b.dataset.accessTab!=="roles");});await loadAccessAdmin();
}
async function loadAccessAdmin(){const [r,p,rp,u]=await Promise.all([supabase.from("roles").select("*").order("nombre"),supabase.from("permisos").select("*").order("modulo").order("accion"),supabase.from("roles_permisos").select("rol_id,permiso_id"),supabase.from("perfiles").select("*,roles(nombre)").order("nombre_completo")]);const error=r.error||p.error||rp.error||u.error;if(error){$("#adminUserRows").innerHTML=`<tr><td colspan="5" class="empty">${escapeHTML(errorText(error))}</td></tr>`;return;}adminRoles=r.data||[];adminPermissions=p.data||[];adminRolePermissions=rp.data||[];adminUsers=u.data||[];paintAdminUsers();paintRoleList();}
function paintAdminUsers(){$("#adminUserRows").innerHTML=adminUsers.map(u=>`<tr><td><strong>${escapeHTML(u.nombre_completo)}</strong><small>${escapeHTML(u.correo)}</small></td><td>${escapeHTML(u.celular||u.identificacion||"—")}</td><td>${escapeHTML(u.roles?.nombre||"Sin rol")}</td><td><span class="badge ${u.estado!=="activo"?"closed":""}">${capitalize(u.estado)}</span></td><td>${hasPermission("usuarios.administrar")?`<button class="secondary edit-access-user" data-id="${u.id}">Editar acceso</button>`:"Solo lectura"}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">No hay usuarios registrados.</td></tr>';$$(".edit-access-user").forEach(b=>b.onclick=()=>openUserAccess(adminUsers.find(u=>u.id===b.dataset.id)));}
function paintRoleList(selectedId=adminRoles[0]?.id){$("#roleList").innerHTML=adminRoles.map(r=>`<button class="role-item ${r.id===selectedId?"active":""}" data-role-id="${r.id}"><span><strong>${escapeHTML(r.nombre)}</strong><small>${escapeHTML(r.descripcion||"Sin descripción")}</small></span><em>${adminRolePermissions.filter(x=>x.rol_id===r.id).length}</em></button>`).join("");$$('.role-item').forEach(b=>b.onclick=()=>{paintRoleList(b.dataset.roleId);paintRolePermissions(b.dataset.roleId);});if(selectedId)paintRolePermissions(selectedId);}
function paintRolePermissions(roleId){const role=adminRoles.find(r=>r.id===roleId),selected=new Set(adminRolePermissions.filter(x=>x.rol_id===roleId).map(x=>x.permiso_id)),groups=[...new Set(adminPermissions.map(p=>p.modulo))];$("#rolePermissionTitle").textContent=`Módulos de ${role?.nombre||"rol"}`;$("#permissionGroups").dataset.roleId=roleId;$("#permissionGroups").innerHTML=groups.map(module=>`<section class="permission-module"><header><label><input type="checkbox" class="module-toggle" data-module="${module}" ${role?.nombre==="Superadministrador"?"disabled":""}> <strong>${moduleName(module)}</strong></label><span>${adminPermissions.filter(p=>p.modulo===module).length} permisos</span></header><div>${adminPermissions.filter(p=>p.modulo===module).map(p=>`<label><input type="checkbox" class="permission-check" data-module="${module}" value="${p.id}" ${selected.has(p.id)?"checked":""} ${role?.nombre==="Superadministrador"?"disabled":""}><span><b>${actionName(p.accion)}</b><small>${escapeHTML(p.descripcion||p.codigo)}</small></span></label>`).join("")}</div></section>`).join("");$$('.module-toggle').forEach(t=>{const checks=$$(`.permission-check[data-module="${t.dataset.module}"]`);t.checked=checks.length>0&&checks.every(c=>c.checked);t.onchange=()=>checks.forEach(c=>c.checked=t.checked);});$("#saveRolePermissions").disabled=role?.nombre==="Superadministrador"||!hasPermission("permisos.administrar");$("#saveRolePermissions").onclick=saveRolePermissions;}
async function saveRolePermissions(){const roleId=$("#permissionGroups").dataset.roleId,ids=$$('.permission-check:checked').map(x=>x.value);const {error}=await supabase.rpc("guardar_permisos_rol",{p_rol:roleId,p_permisos:ids});if(error)return toast(errorText(error));toast("Permisos del rol actualizados.");await loadAccessAdmin();}
function openNewRole(){const name=prompt("Nombre del nuevo rol:","");if(name===null||clean(name).length<3)return;const description=prompt("Descripción del rol:","");supabase.from("roles").insert({nombre:clean(name),descripcion:clean(description)||null}).select().single().then(async({data,error})=>{if(error)return toast(errorText(error));toast("Rol creado. Ahora selecciona sus módulos.");await loadAccessAdmin();paintRoleList(data.id);});}
function randomPassword(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";return Array.from({length:12},()=>chars[Math.floor(Math.random()*chars.length)]).join("");}
function openNewUser(){$("#userForm").reset();$("#newUserRole").innerHTML=adminRoles.filter(r=>r.activo&&r.nombre!=="Superadministrador").map(r=>`<option value="${r.id}">${escapeHTML(r.nombre)}</option>`).join("");$("#newUserPassword").value=randomPassword();$("#userModal").classList.remove("hidden");}
$$('[data-close-user]').forEach(b=>b.onclick=()=>$("#userModal").classList.add("hidden"));$("#generateUserPassword").onclick=()=>$("#newUserPassword").value=randomPassword();
$("#userForm").onsubmit=async event=>{
  event.preventDefault();
  const button=$("#saveNewUser"),email=clean($("#newUserEmail").value).toLowerCase(),password=$("#newUserPassword").value,name=clean($("#newUserName").value),phone=clean($("#newUserPhone").value)||null,role=$("#newUserRole").value,state=$("#newUserState").value;
  button.disabled=true;button.textContent="Creando…";
  try{
    const signupClient=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const {data,error}=await withTimeout(signupClient.auth.signUp({email,password,options:{data:{nombre_completo:name},emailRedirectTo:location.origin+location.pathname}}));
    if(error||!data.user||data.user.identities?.length===0)throw(error||new Error("Ese correo ya está registrado o no pudo crearse."));
    await new Promise(resolve=>setTimeout(resolve,350));
    const profileUpdate=await withTimeout(supabase.from("perfiles").update({nombre_completo:name,celular:phone}).eq("id",data.user.id));
    if(profileUpdate.error)throw profileUpdate.error;
    const access=await withTimeout(supabase.rpc("actualizar_usuario_administracion",{p_usuario:data.user.id,p_rol:role,p_estado:state}));
    if(access.error)throw access.error;
    $("#userModal").classList.add("hidden");toast(data.session?"Usuario creado y listo para ingresar.":"Usuario creado. Debe confirmar el correo antes de ingresar.");await loadAccessAdmin();
  }catch(error){toast(errorText(error));await loadAccessAdmin();}
  finally{button.disabled=false;button.textContent="Crear usuario";}
};
function openUserAccess(user){const options=adminRoles.filter(r=>r.activo).map((r,i)=>`${i+1}. ${r.nombre}`).join("\n"),current=Math.max(adminRoles.findIndex(r=>r.id===user.rol_id),0)+1,choice=prompt(`Selecciona el rol para ${user.nombre_completo}:\n${options}`,String(current));if(choice===null)return;const role=adminRoles[Number(choice)-1];if(!role)return toast("Selecciona un número válido.");const state=prompt("Estado: activo, inactivo o suspendido",user.estado);if(state===null||!["activo","inactivo","suspendido"].includes(clean(state).toLowerCase()))return toast("Estado no válido.");supabase.rpc("actualizar_usuario_administracion",{p_usuario:user.id,p_rol:role.id,p_estado:clean(state).toLowerCase()}).then(async({error})=>{if(error)return toast(errorText(error));toast("Acceso del usuario actualizado.");await loadAccessAdmin();});}
const moduleName=value=>({pacientes:"Pacientes",usuarios:"Usuarios",permisos:"Permisos",bitacora:"Bitácora",jornadas:"Jornadas",brigadas:"Brigadas",agenda:"Agenda",pagos:"Pagos básicos",call_center:"Call Center",asistencia:"Asistencia en brigada",brigada:"Cobros en brigada",consultas:"Consultas",documentos_clinicos:"Documentos clínicos",productos:"Tarifas y productos",ventas:"Ventas",recaudos:"Recaudos",reportes:"Reportes"}[value]||capitalize(value));const actionName=value=>({ver:"Ver módulo",crear:"Crear",editar:"Editar",eliminar:"Eliminar",administrar:"Administrar",registrar:"Registrar",gestionar:"Gestionar",confirmar:"Confirmar",cerrar:"Cerrar",cobrar:"Cobrar",cargar:"Cargar archivos",descuento:"Aplicar descuentos",anular:"Anular",incumplir:"Marcar incumplida"}[value]||capitalize(value));

const helpKnowledge=[
  {title:"Registrar un paciente",keywords:"paciente registrar nuevo crear cedula celular buscar duplicado",answer:"Para registrar un paciente entra en Pacientes y pulsa Nuevo paciente. También puedes buscarlo desde Agenda por nombre o cédula; si no existe, allí mismo aparece la opción para crearlo y continuar con el agendamiento."},
  {title:"Agendar un paciente",keywords:"agenda agendar cita jornada paciente volante abono",answer:"Entra en Agenda y pulsa Nuevo agendamiento. Busca al paciente por nombre o cédula, selecciona la jornada y completa el formulario. Si existe una sola jornada abierta se selecciona automáticamente; si hay varias debes escoger la correcta."},
  {title:"Jornadas abiertas e inactivas",keywords:"jornada abierta inactiva cerrar agendamiento fecha",answer:"Una jornada abierta aparece en Agenda. Una jornada inactiva ya no recibe agendamientos normales, pero continúa visible para Call Center y Brigada. Brigada puede agregar pacientes a una jornada inactiva cuando serán atendidos de inmediato."},
  {title:"Usar Call Center",keywords:"call center llamar confirmar no contesta cancelar crm gestion",answer:"En Call Center selecciona una jornada abierta o inactiva. Gestiona cada paciente y registra el resultado: confirmado, no contesta, cancelado u otro. El sistema guarda quién realizó la gestión y organiza automáticamente las bandejas."},
  {title:"Atender en Brigada",keywords:"brigada atender cumplir cita pago saldo hoy incumplida",answer:"Brigada muestra únicamente los pacientes de la jornada del día. En Por atender aparecen registrados y confirmados. Abre el paciente, registra el pago restante y marca la cita como cumplida. Si no asistió, puedes marcarla incumplida."},
  {title:"Registrar una consulta",keywords:"consulta optometria formula diagnostico lente documento historia clinica",answer:"Consultas muestra las citas que Brigada marcó como cumplidas. Pulsa Registrar consulta, completa la fórmula de ambos ojos, diagnóstico y recomendaciones. También puedes adjuntar la orden o una fotografía clínica."},
  {title:"Configurar tarifas",keywords:"tarifa precio material filtro tratamiento lente venta no tiene tarifa",answer:"En Tarifas y precios crea primero los materiales, filtros y tratamientos. Luego pulsa Nueva tarifa y define el precio para esa combinación. Una venta solo puede registrarse cuando la combinación seleccionada tiene tarifa vigente."},
  {title:"Registrar una venta",keywords:"venta vender lentes descuento abono saldo entrega",answer:"En Ventas pulsa Registrar venta, selecciona la consulta del paciente y la combinación del lente. El precio se obtiene automáticamente de Tarifas. Registra descuento autorizado, abono, medio de pago y fecha de entrega."},
  {title:"Recaudos y cartera",keywords:"recaudo cartera pago dinero anular movimiento saldo pendiente",answer:"Recaudos reúne el dinero recibido en Agenda, Brigada y Ventas. Puedes filtrar por fecha, jornada, canal, medio y usuario. En Cartera de ventas registra pagos pendientes. Las anulaciones exigen motivo y conservan la trazabilidad."},
  {title:"Reportes",keywords:"reporte indicador exportar excel csv conversion asistencia promotor municipio",answer:"En Reportes filtra por fecha, jornada, municipio o promotor. Allí verás confirmación, asistencia, conversión a venta y recaudo. Pulsa Exportar CSV para abrir la información en Excel."},
  {title:"Crear usuarios y roles",keywords:"usuario crear cuenta correo contraseña rol perfil permiso modulo acceso",answer:"En Usuarios y permisos pulsa Nuevo usuario, completa sus datos y asigna un rol. En Roles y módulos puedes crear roles y marcar exactamente qué puede ver o hacer cada uno. Los cambios del menú aparecen cuando el usuario vuelve a iniciar sesión."},
  {title:"Contraseña y correo",keywords:"clave contraseña temporal confirmar correo olvide recuperar ingreso login",answer:"Al crear un usuario se genera una contraseña temporal que debes entregarle. Si la confirmación de correo está activa, primero debe confirmar el mensaje de Supabase. Para cambiar o recuperar la clave debe usar Olvidé mi contraseña."},
  {title:"No aparece un módulo",keywords:"no aparece modulo menu oculto permiso acceso",answer:"Revisa el rol del usuario en Usuarios y permisos. Después entra en Roles y módulos, marca al menos el permiso Ver del módulo y guarda. Pide al usuario cerrar sesión y volver a ingresar para actualizar su menú."},
  {title:"No aparecen pacientes en Brigada",keywords:"no aparece paciente brigada hoy fecha jornada programada",answer:"Brigada solo muestra pacientes registrados o confirmados cuya jornada tiene como fecha el día actual del dispositivo. Revisa la fecha de la jornada, el estado de la cita y que la jornada esté abierta o inactiva."}
];
function setupHelpAssistant(){const allowed=hasPermission("usuarios.administrar")||hasPermission("permisos.administrar");$("#helpLauncher").classList.toggle("hidden",!allowed);$("#helpAssistant").classList.add("hidden");if(!allowed)return;$("#helpMessages").innerHTML=`<div class="help-message bot"><b>Hola, ${escapeHTML((currentProfile?.nombre_completo||"Administrador").split(" ")[0])}</b><p>Puedo ayudarte a usar la aplicación. Selecciona una pregunta o escribe lo que necesitas.</p></div>`;const quick=["¿Cómo agendo un paciente?","¿Cómo funciona Brigada?","¿Cómo creo un usuario?","No aparece un módulo"];$("#helpQuick").innerHTML=quick.map(q=>`<button type="button">${escapeHTML(q)}</button>`).join("");$$('#helpQuick button').forEach(b=>b.onclick=()=>askHelp(b.textContent));$("#helpLauncher").onclick=()=>{$("#helpAssistant").classList.remove("hidden");$("#helpLauncher").classList.add("hidden");setTimeout(()=>$("#helpInput").focus(),50);};$("#closeHelp").onclick=()=>{$("#helpAssistant").classList.add("hidden");$("#helpLauncher").classList.remove("hidden");};$("#helpForm").onsubmit=e=>{e.preventDefault();const q=clean($("#helpInput").value);if(q)askHelp(q);};}
function normalizeHelp(value){return String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(w=>w.length>2);}
function askHelp(question){const words=normalizeHelp(question);$("#helpMessages").insertAdjacentHTML("beforeend",`<div class="help-message user"><p>${escapeHTML(question)}</p></div>`);$("#helpInput").value="";const ranked=helpKnowledge.map(item=>{const hay=new Set(normalizeHelp(item.title+" "+item.keywords));return{item,score:words.reduce((n,w)=>n+(hay.has(w)?3:[...hay].some(h=>h.includes(w)||w.includes(h))?1:0),0)};}).sort((a,b)=>b.score-a.score),best=ranked[0];const answer=best&&best.score>0?`<b>${escapeHTML(best.item.title)}</b><p>${escapeHTML(best.item.answer)}</p>`:`<b>No encontré una respuesta exacta</b><p>Prueba mencionando el módulo: Pacientes, Agenda, Call Center, Brigada, Consultas, Ventas, Recaudos, Reportes o Usuarios.</p>`;setTimeout(()=>{$("#helpMessages").insertAdjacentHTML("beforeend",`<div class="help-message bot">${answer}</div>`);$("#helpMessages").scrollTop=$("#helpMessages").scrollHeight;},180);$("#helpMessages").scrollTop=$("#helpMessages").scrollHeight;}
function renderProfile() {
  $("#pageName").textContent="Mi perfil";
  $("#content").innerHTML=`<div class="page-hero"><div><h1>Mi perfil</h1><p>Información de tu cuenta y nivel de acceso.</p></div></div><article class="card profile-card"><img class="profile-logo" src="./logo.png" alt="Logo"><div class="profile-data"><div><span>Nombre completo</span><strong>${escapeHTML(currentProfile?.nombre_completo||"Yohan Mendoza")}</strong></div><div><span>Correo</span><strong>${escapeHTML(currentProfile?.correo||SUPERADMIN_EMAIL)}</strong></div><div><span>Rol</span><strong>${escapeHTML(currentProfile?.roles?.nombre||"Superadministrador")}</strong></div><div><span>Empresa</span><strong>Centro Óptico de Colombia Group</strong></div></div></article>`;
}
const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const formatDate=value=>new Intl.DateTimeFormat("es-CO",{dateStyle:"medium"}).format(new Date(value));
const shortDate=value=>new Intl.DateTimeFormat("es-CO",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(value+"T12:00:00"));
const localDateValue=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const cop=value=>new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(value||0));
const capitalize=value=>String(value||"").charAt(0).toUpperCase()+String(value||"").slice(1);
supabase.auth.onAuthStateChange((event,session)=>{if(event==="SIGNED_OUT")showAuth();if(event==="PASSWORD_RECOVERY")toast("Ya puedes establecer una contraseña nueva desde Supabase.");});
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));}
boot();
