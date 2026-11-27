import {reportZip} from './web-report.mjs';

const PAGE = String.raw`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Dropper · Administración</title>
<style nonce="__NONCE__">
:root{font:14px/1.5 'Segoe UI',system-ui,sans-serif;color:#eef2fa;background:#10131a;color-scheme:dark;--muted:#a3aec2;--line:#30394a;--panel:#1f2633;--surface:#181d27;--brand:#738bff;--green:#52d9a6;--red:#f68d9d}*{box-sizing:border-box}body{margin:0}button,input,select{font:inherit}button{cursor:pointer;border:1px solid var(--line);background:var(--panel);color:inherit;border-radius:7px;padding:10px 14px;min-height:42px;display:inline-flex;align-items:center;justify-content:center;gap:7px}button:hover{filter:brightness(1.1)}button:disabled{opacity:.5;cursor:default}.primary{background:var(--brand);border-color:var(--brand);color:#10131a}.danger{color:var(--red)}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #90a2ff;outline-offset:3px}input,select{padding:11px;border:1px solid var(--line);border-radius:7px;width:100%;background:var(--panel);color:inherit;min-width:0}input[readonly]{color:var(--green)}[hidden]{display:none!important}h1,h2,h3,p{margin:0}h1{font-size:23px;font-weight:500}h2{font-size:21px;font-weight:500}h3{font-size:17px;font-weight:500}.muted{color:var(--muted);font-size:13px}.brand{font-size:24px;font-weight:500}.top{max-width:1180px;margin:auto;display:flex;align-items:center;justify-content:space-between;padding:24px;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line)}.actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:18px}.shell{max-width:1180px;margin:auto;display:grid;grid-template-columns:190px minmax(0,1fr);min-height:540px}.nav{padding:26px 18px;display:flex;flex-direction:column;gap:8px}.nav button{border-color:transparent;background:transparent;justify-content:flex-start;text-align:left}.nav button[aria-selected=true]{background:var(--panel);border-color:var(--line)}main{padding:28px 24px;background:var(--surface);min-width:0}.heading{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:20px}.heading .actions{margin:0}.model-name{font-size:16px;font-weight:500}.bot-row{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:18px 0;border-bottom:1px solid var(--line)}.row-actions{display:flex;gap:7px}.row-actions button{font-size:13px;padding:8px 12px}.empty{padding:40px 0;color:var(--muted)}.field{display:grid;gap:7px;margin:17px 0;color:var(--muted);font-size:13px}.error{color:var(--red);font-size:13px;white-space:pre-wrap}.error:not(:empty){margin:12px 0}.status{color:var(--green);font-size:13px;min-height:22px;margin-top:12px}.dialog::backdrop{background:#000b}.dialog{border:1px solid var(--line);border-radius:12px;background:var(--surface);color:inherit;width:470px;max-width:calc(100% - 28px);padding:26px;max-height:calc(100% - 32px);overflow:auto}.dialog .actions{justify-content:flex-end}.settings-form{max-width:520px;margin-top:26px}.settings-form+.settings-form{border-top:1px solid var(--line);padding-top:26px}.settings-form p{margin-top:14px;color:var(--muted);font-size:13px}.settings-form .actions{margin:18px 0}.access-note{font-size:12px;color:var(--muted)}.keep{font-size:12px;color:var(--muted)}.login-wrap{padding:24px 16px}.login-form{max-width:410px;margin:45px auto;padding:28px;background:var(--surface);border:1px solid var(--line);border-radius:12px}.login-form p{margin-top:10px}.top-right{display:flex;gap:12px;align-items:center}
@media(max-width:680px){.shell{grid-template-columns:1fr}.nav{flex-direction:row;flex-wrap:wrap;padding:14px}main{padding:20px 16px}.top{padding:18px}.dialog{padding:20px}.bot-row{gap:12px}.top .access-note{width:100%}}
@media(pointer:coarse){input,select{font-size:16px}button{min-height:44px}}
.report-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.report-actions button{font-size:13px;padding:6px 10px}.report-dialog{width:850px}.report-detail{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace;margin:16px 0}.report-image{max-width:100%;height:auto;border:1px solid var(--line)}.row-actions{flex-wrap:wrap}
#drops-date{width:fit-content}#drops-body article{display:block;margin-bottom:12px}
#drops-body h2{margin:0}
[data-embedded]:not([data-embedded=""]){background:#0b0b0a;--brand:#c7a78d;--surface:#171614;--panel:#28231f;--line:#473b32;--muted:#c2b5aa}
[data-embedded]:not([data-embedded=""]) .top,[data-embedded]:not([data-embedded=""]) #login-view,[data-embedded] #embed-error:empty{display:none}
[data-embedded="bots"] .shell,[data-embedded="session"] .shell{display:block;min-height:0}
[data-embedded="bots"] #reload,[data-embedded="bots"] .error{display:none}
[data-embedded="bots"] main{overflow-wrap:anywhere}
[data-embedded="bots"],[data-embedded="session"]{overflow:hidden}
[data-embedded="bots"] #recording-settings,[data-embedded="session"] .nav,
[data-embedded="session"] #profiles-section > :not(#recording-settings){display:none}
[data-embedded="session"] #recording-settings{padding:0;border:0}
[data-embedded="operations"] .shell{display:block;min-height:0}
[data-embedded="operations"] .nav{flex-direction:row;padding:0 0 12px}
#embed-error{padding:0 16px}
</style></head><body data-embedded="__EMBEDDED__">
__STANDALONE_HEADER__
<div class="shell" id="app-view" hidden><nav class="nav" aria-label="Administración"><button id="nav-profiles" aria-selected="true">Bots</button><button id="nav-drops" aria-selected="false">Drops</button><button id="nav-access" aria-selected="false">Ajustes</button></nav><main>
<section id="profiles-section"><div class="heading"><h1>Bots</h1><div class="actions"><button id="reload">Actualizar</button><button class="primary" id="add">Añadir bot</button></div></div><div class="bot-row" id="recording-settings"><div><h3>Sesión compartida de AgencyKey</h3><span class="muted" id="recording-session-status">Consultando sesión…</span></div><button id="connect-recording">Conectar AgencyKey</button></div><div id="profiles-error" class="error" role="alert"></div><div id="profiles-body" aria-label="Bots configurados"></div><div class="empty" id="empty" hidden>No hay bots configurados</div></section>
<section id="drops-section" hidden>
<div class="heading"><div><h1>Resumen diario de Drops</h1><p class="muted">Hora de Caracas</p></div><div class="actions"><button id="drops-refresh">Actualizar</button><button id="drops-today">Hoy</button></div></div>
<label class="field">Fecha<input id="drops-date" type="date"></label>
<p class="muted" id="drops-status" role="status"></p><div id="drops-body"></div>
</section>
<section id="access-section" hidden><h1>Ajustes</h1><form id="agency-form" class="settings-form"><h3>AgencyKey para los bots</h3><label class="field">Clave API<input id="agency-key" type="password" autocomplete="new-password" maxlength="512" placeholder="API para todos los bots"></label><div class="actions"><button class="primary" id="save-api" type="submit">Guardar API y cargar modelos</button></div><div class="error" id="api-error" role="alert"></div><div class="status" id="api-status" aria-live="polite"></div></form>
<form id="access-form" class="settings-form"><h3>Acceso de las apps</h3><label class="field">Nueva contraseña<input id="access-input" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><div class="actions"><button class="primary" id="rotate" type="submit">Cambiar contraseña</button></div><p>Se pedirá la nueva contraseña en la próxima descarga de configuraciones.</p><div class="error" id="access-error" role="alert"></div><div class="status" id="access-status" aria-live="polite"></div></form>
__STANDALONE_PASSWORD_FORM__</section>
<div class="status" id="status" aria-live="polite"></div></main></div>
<p id="embed-error" class="error" role="alert"></p>
<dialog class="dialog" id="profile-dialog"><form id="profile-form"><h2 id="dialog-title">Añadir bot</h2><label class="field">Token de Telegram<input id="telegram-token" type="password" autocomplete="new-password" maxlength="256"></label><span class="keep" id="keep-hint" hidden>Vacío para conservar el token actual</span><label class="field">Modelo<select id="creator-id" required><option value="">Selecciona una modelo</option></select></label><label class="field">Usuarios de Telegram autorizados<input id="telegram-users" placeholder="@usuario1, @usuario2" maxlength="1750"></label><label class="field">Nombre de OnlyFans<input id="creator-name" readonly></label><div class="error" id="form-error" role="alert"></div><div class="actions"><button type="button" id="cancel">Cancelar</button><button type="submit" class="primary" id="save">Guardar</button></div></form></dialog>
<dialog class="dialog" id="confirm-dialog"><h2 id="confirm-title"></h2><p id="confirm-message" class="muted"></p><div class="actions"><button id="confirm-cancel">Cancelar</button><button class="primary" id="confirm-accept">Confirmar</button></div></dialog>
<dialog class="dialog" id="recording-dialog"><h2>Conectar sesión compartida</h2><p id="recording-help" class="muted">Preparando AgencyKey…</p><div class="actions"><button id="recording-cancel">Cancelar</button></div><div class="error" id="recording-error" role="alert"></div></dialog>
<dialog class="dialog report-dialog" id="web-report-dialog"><h2>Verificación manual del perfil</h2><p class="muted">Este resultado corresponde a la comprobación desde la web. Los errores de publicación y grabación se consultan en la app.</p><pre class="report-detail" id="web-report-detail"></pre><img class="report-image" id="web-report-image" alt="Chrome en el momento del fallo de verificación" hidden><div class="actions"><button id="web-report-download">Descargar reporte</button><button id="web-report-close">Cerrar</button></div><div id="web-report-error" class="error" role="alert"></div></dialog>
<script nonce="__NONCE__">
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const embedded=document.body.dataset.embedded;
const reportZip=__REPORT_ZIP__;
let currentWebReport=null;
let dropsRequest=0,followToday=true;
let profiles=[],creators=[],editing=null,saving=false,checking=false,resolveRequest=0;
let confirmResolve=null,recordingTimer=null,recordingBusy=false,recordingGeneration=0,recordingJob=null,feedBusy=false,feedCancel=false,activeFeed=null;
const feedRows=new Map();
let renderPending=false;
function hersSession(){
 return new Promise((resolve,reject)=>{
  const {port1,port2}=new MessageChannel();
  const finish=()=>{clearTimeout(timer);port1.close();};
  const timer=setTimeout(()=>{finish();reject(new Error('No se pudo recuperar la sesión de HERS'));},10000);
  port1.onmessage=({data})=>{finish();data?.token?resolve(data.token):reject(new Error('Vuelve a iniciar sesión en HERS'));};
  parent.postMessage({type:'hers-dropper-session'},location.origin,[port2]);
 });
}
async function api(path,options={}) {
 const headers={'Content-Type':'application/json',...(options.headers||{})};
 if(embedded)headers.Authorization='Bearer '+await hersSession();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 let response,data;
 try {
  response=await fetch((embedded?'/api/admin/dropper/api':'/v1/admin')+path,{...options,signal:controller.signal,credentials:embedded?'omit':'same-origin',cache:'no-store',headers});
  data=await response.json();
 }catch{
  if(response?.status===401){showLogin();throw new Error('Vuelve a iniciar sesión');}
  throw Object.assign(new Error('Conexión interrumpida · esperando para continuar…'),{retryable:true});
 }finally{clearTimeout(timer);}
 if(!response.ok){if(response.status===401&&path!=='/login')showLogin();throw Object.assign(new Error(data.error||'No se pudo completar la acción'),{retryable:response.status===408||response.status===429||response.status>=500});}
 return data;
}
function showLogin(){
 feedCancel=true;
 dropsRequest++;followToday=true;$('drops-date').value='';$('drops-body').replaceChildren();
 currentWebReport=null;$('web-report-image').removeAttribute('src');$('web-report-image').hidden=true;$('web-report-detail').textContent='';$('web-report-dialog').close();
 stopRecordingPoll();$('recording-dialog').close();if(confirmResolve)finishConfirm(false);
 profiles=[];creators=[];feedRows.clear();renderPending=false;resolveRequest++;$('profiles-body').replaceChildren();$('profile-form').reset();$('agency-form').reset();$('access-form').reset();
 if($('profile-dialog').open)$('profile-dialog').close();
 $('app-view').hidden=true;
 if(embedded){$('embed-error').textContent='Vuelve a iniciar sesión en HERS';return;}
 showStandaloneLogin();
}
async function showApp(){
 $('app-view').hidden=false;
 if(!embedded)showStandaloneApp();
 if(embedded){
  $('nav-profiles').hidden=true;
  if(embedded==='bots'){
   $('app-view').querySelector('nav').hidden=true;
   $('agency-form').hidden=true;
   section('profiles');
   await reload();
   return;
  }
  $('agency-form').hidden=true;
  if(embedded==='session'){
   await Promise.all([recordingStatus(), resumeRecordingConnection()]);
   return;
  }
 }
 section(embedded==='operations'?'drops':'profiles');
 await resumeRecordingConnection();
 if(!embedded)await reload();
 await recordingStatus();
 await agencyStatus();
}
async function agencyStatus(){
 $('api-error').textContent='';
 try{const data=await api('/settings');$('api-status').textContent=data.api_configured?'API de Dropper configurada':'API de Dropper sin configurar';}catch(error){$('api-error').textContent=error.message;}
}
__STANDALONE_SCRIPT__
function section(which){
 for(const name of ['profiles','drops','access']){
  $(name+'-section').hidden=name!==which;
  $('nav-'+name).setAttribute('aria-selected',String(name===which));
 }
 $('status').textContent='';
 if(which==='drops')void loadDrops();
}
const dropTime = new Intl.DateTimeFormat('es-VE',{timeZone:'America/Caracas',hour:'2-digit',minute:'2-digit'});
const caracasDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Caracas',dateStyle:'short'});
async function loadDrops(){
 const generation=++dropsRequest;
 const date=followToday?'':$('drops-date').value;
 try{
  const data=await api('/drops'+(date?'?date='+encodeURIComponent(date):''));
  if(generation!==dropsRequest)return;
  $('drops-date').value=data.date;$('drops-date').max=data.today;
  const models=new Map(data.models.map(model=>[model.creator_id,{name:model.creator_name,total:0,lastAt:0}]));
  for(const drop of data.drops){
   const model=models.get(drop.creator_id)||{name:drop.creator_name,total:0,lastAt:0};
   model.total+=drop.automatic+drop.manual;
   model.lastAt=Math.max(model.lastAt,drop.last_at);
   models.set(drop.creator_id,model);
  }
  const cards=document.createDocumentFragment();
  for(const model of models.values()){
   const card=document.createElement('article');card.className='bot-row';
   const heading=document.createElement('h2');heading.textContent=model.name;
   const summary=document.createElement('div');summary.className='muted';
   summary.textContent=(model.lastAt?dropTime.format(new Date(model.lastAt*1000))+' · ':'')+model.total+' / 400';
   card.append(heading,summary);cards.append(card);
  }
  $('drops-body').replaceChildren(cards);
  $('drops-status').textContent=models.size?'':'No hay modelos configuradas';
 }catch(error){
  if(generation===dropsRequest){$('drops-body').replaceChildren();$('drops-status').textContent=error.message;}
 }
}
$('drops-date').addEventListener('change',()=>{followToday=!$('drops-date').value;void loadDrops();});
$('drops-today').addEventListener('click',()=>{followToday=true;void loadDrops();});
$('drops-refresh').addEventListener('click',()=>{void loadDrops();});
setInterval(()=>{
 if(!$('app-view').hidden&&!$('drops-section').hidden&&!document.hidden
   &&(followToday||$('drops-date').value===caracasDay.format(new Date())))void loadDrops();
},45000);
function render(){
 if(feedBusy){renderPending=true;return;}
 feedRows.clear();$('profiles-body').replaceChildren();$('empty').hidden=profiles.length>0;
 for(const profile of profiles){const row=document.createElement('div');row.className='bot-row';const details=document.createElement('div');const name=document.createElement('div');name.className='model-name';name.textContent=profile.creator.name;details.append(name);const user=document.createElement('div');user.className='muted';user.textContent=(profile.creator.username?'@'+profile.creator.username+' · ':'')+(profile.needs_token?'Token pendiente de configurar':'Token configurado');details.append(user);const feed=document.createElement('div');feed.className='muted';feed.textContent=feedLabel(profile.feed);feed.setAttribute('aria-live','polite');details.append(feed);const reportActions=document.createElement('div');reportActions.className='report-actions';reportActions.hidden=!hasWebResult(profile.feed);const detail=document.createElement('button');detail.textContent='Ver detalle';detail.setAttribute('aria-label','Ver detalle de verificación de '+profile.creator.name);detail.addEventListener('click',()=>showWebReport(profile));const download=document.createElement('button');download.textContent='Descargar reporte';download.setAttribute('aria-label','Descargar reporte web de '+profile.creator.name);download.addEventListener('click',()=>showWebReport(profile,true));reportActions.append(detail,download);details.append(reportActions);const actions=document.createElement('div');actions.className='row-actions';const edit=document.createElement('button');edit.textContent='Editar';edit.setAttribute('aria-label','Editar '+profile.creator.name);edit.addEventListener('click',()=>openProfile(profile));const remove=document.createElement('button');remove.textContent='Eliminar';remove.className='danger';remove.setAttribute('aria-label','Eliminar '+profile.creator.name);remove.addEventListener('click',()=>deleteProfile(profile,remove));const verify=document.createElement('button');verify.textContent='Verificar Mi perfil';verify.setAttribute('aria-label','Verificar Mi perfil de '+profile.creator.name);verify.addEventListener('click',()=>verifyFeed(profile,feed,verify));verify.hidden=Boolean(profile.needs_token);actions.append(verify,edit,remove);feedRows.set(profile.id,{profile,status:feed,button:verify,reportActions});row.append(details,actions);$('profiles-body').append(row);}
}
function hasWebResult(result){return result && !['pending','queued','running','finishing'].includes(result.status);}
async function webReport(profile){
 const feed=profile.feed||{};
 if(feed.report_id)return api('/recording-session/feed/'+profile.id+'/diagnostic?job='+encodeURIComponent(feed.report_id));
 return {schema:1,source:'web_verification',profile_id:profile.id,creator_id:profile.creator.external_id,
  expected_username:profile.creator.username,observed_username:feed.observed_username||null,status:feed.status,
  checked_at:feed.checked_at||new Date().toISOString(),stage:'solicitud de verificación desde la web',
  error:feed.error||feedLabel(feed),evidence_available:false,screenshot_omitted:'no_browser_evidence'};
}
function saveWebReport(report){
 const link=document.createElement('a'),objectUrl=URL.createObjectURL(reportZip(report));
 link.href=objectUrl;link.download='verificacion-web-'+report.creator_id+'.zip';document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}
async function showWebReport(profile,download=false){
 $('profiles-error').textContent='';
 try{
  const report=await webReport(profile);currentWebReport=report;
  if(download){saveWebReport(report);return;}
  $('web-report-detail').textContent='Resultado: '+feedLabel(report)+'\nModelo: '+report.creator_id+
   '\nCuenta esperada: @'+(report.expected_username||'sin identificar')+'\nCuenta detectada: '+(report.observed_username?'@'+report.observed_username:'sin identificar')+
   '\nEtapa: '+report.stage+'\nDetalle: '+(report.error||feedLabel(report))+
   (report.status==='web_request_error'?'\nEste reporte contiene el error de conexión observado por el navegador web.':
    !report.evidence_available&&!['ready','no_session'].includes(report.status)?'\nNo hay evidencia de Chrome para esta solicitud. Comprueba que la app actualizada está abierta.':'')+
   '\n\n'+JSON.stringify({...report,screenshot:report.screenshot?'Incluida en el reporte':null},null,2);
  const image=$('web-report-image');image.hidden=!report.screenshot;
  if(report.screenshot?.mime==='image/jpeg')image.src='data:image/jpeg;base64,'+report.screenshot.data;else image.removeAttribute('src');
  $('web-report-error').textContent='';$('web-report-dialog').showModal();
 }catch(error){$('profiles-error').textContent=error.message;}
}
$('web-report-close').addEventListener('click',()=>{$('web-report-dialog').close();currentWebReport=null;$('web-report-image').removeAttribute('src');});
$('web-report-download').addEventListener('click',()=>{if(currentWebReport)saveWebReport(currentWebReport);});
const feedMessages={token_required:'Guarda un token para habilitar este bot',pending:'Mi perfil pendiente de verificar',ready:'Mi perfil coincide con la modelo asignada',no_session:'Sin sesión guardada · Conecta AgencyKey',
 login_required:'AgencyKey pide iniciar sesión · Reconecta',unavailable:'Chrome no tiene acceso a Mi perfil',
 wrong_profile:'Chrome no abrió Mi perfil de la modelo seleccionada',
 profile_not_visible:'Chrome pulsó Mi perfil, pero la vista no terminó de cargar',
 profile_menu_missing:'Chrome abrió la modelo, pero no encontró Mi perfil',
 feed_unverified:'Verificación anterior · Vuelve a verificar Mi perfil',
 profile_unverified:'No se pudo verificar el perfil',
 connection_error:'La app no pudo abrir AgencyKey en tu PC',
 web_request_error:'No se pudo completar la solicitud desde la web',
 desktop_update_required:'Actualiza la app de Windows y vuelve a verificar',
 desktop_offline:'La app de Windows no recibió la solicitud de verificación',expired:'La comprobación caducó',
 cancelled:'Comprobación cancelada'};
function feedLabel(result){
 const time=result?.checked_at?new Date(result.checked_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
 let label=feedMessages[result?.status]||feedMessages.pending;
 if(result?.status==='web_request_error'&&typeof result.error==='string')label=result.error;
 if(result?.status==='wrong_profile'&&result.expected_username&&result.observed_username
    && result.expected_username.toLowerCase()!==result.observed_username.toLowerCase()){
  label='Se esperaba @'+result.expected_username+' y Chrome abrió @'+result.observed_username;
 }
 return label+(time?' · '+time:'');
}
const recoveryWait=()=>new Promise(resolve=>setTimeout(resolve,2500));
async function verificationRequest(path,options,onRetry,alive=()=>!$('app-view').hidden){
 while(alive()){
  try{return await api(path,options);}catch(error){if(!error.retryable)throw error;onRetry(error.message);await recoveryWait();}
 }
 throw new Error('Verificación interrumpida al cerrar la sesión de administración');
}
async function verifyFeed(profile, status, button){
 if(feedBusy){if(activeFeed===profile.id){feedCancel=true;button.disabled=true;status.textContent='Cancelando al recuperar la conexión…';}return;}
 feedBusy=true;feedCancel=false;activeFeed=profile.id;$('reload').disabled=true;
 const buttons=[...feedRows.values()].map(row=>row.button);
 for(const item of buttons)item.disabled=true;
 button.disabled=false;button.textContent='Cancelar verificación';
 status.textContent='Abriendo Mi perfil con la sesión guardada…';
 feedRows.get(profile.id)?.reportActions.setAttribute('hidden','');
 const key='verification:'+profile.id;
 let requestId=sessionStorage.getItem(key);
 if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
 const retry=message=>{status.textContent=feedCancel?'Cancelación pendiente · esperando conexión…':message;};
 try{
  let result=profile.feed?.id ? {id:profile.feed.id,status:profile.feed.status} :
   await verificationRequest('/recording-session/feed/'+profile.id,{method:'POST',body:JSON.stringify({request_id:requestId})},retry);
  const id=result.id;
  while(['queued','running','finishing'].includes(result.status)&&status.isConnected&&!$('app-view').hidden){
   status.textContent=feedCancel?'Cancelando…':result.status==='queued'?'Esperando la app de Windows…':
    result.phase==='retrying'?'Mi perfil sigue cargando · reintento '+(result.attempt||1)+'…':
    result.phase==='saving'?'Guardando el resultado…':'Abriendo Mi perfil de la modelo seleccionada…';
   await recoveryWait();
   result=await verificationRequest('/recording-session/'+(feedCancel?'cancel':'check'),
    {method:'POST',body:JSON.stringify({id})},retry);
  }
  sessionStorage.removeItem(key);
  const current=profiles.find(item=>item.id===profile.id&&item.revision===profile.revision);
  if(current){current.feed=result;renderPending=true;}
  status.textContent=feedLabel(result);
 }catch(error){
  sessionStorage.removeItem(key);
  const current=profiles.find(item=>item.id===profile.id&&item.revision===profile.revision);
  if(current){current.feed={status:'web_request_error',error:error.message};renderPending=true;}
  status.textContent=error.message;
 }
 finally{
  for(const item of buttons)item.disabled=false;
  button.textContent='Verificar Mi perfil';button.disabled=false;$('reload').disabled=false;
  feedBusy=false;activeFeed=null;
  if(renderPending){renderPending=false;render();}
  void verifyPendingFeeds();
 }
}
async function verifyPendingFeeds(){
 if(feedBusy||$('app-view').hidden)return;
 const row=[...feedRows.values()].find(row=>!row.profile.needs_token&&(['pending','queued','running','finishing'].includes(row.profile.feed?.status)
   ||sessionStorage.getItem('verification:'+row.profile.id)));
 if(row)await verifyFeed(row.profile,row.status,row.button);
}
async function reload(){try{$('reload').disabled=true;$('profiles-error').textContent='';profiles=(await api('/profiles')).profiles;render();}catch(error){$('profiles-error').textContent=error.message;}finally{$('reload').disabled=feedBusy;void verifyPendingFeeds();}}
function lockForm(locked){['creator-id','telegram-token','telegram-users','cancel','save'].forEach(id=>$(id).disabled=locked);}
async function openProfile(profile){
 editing=profile||null;$('profile-form').reset();$('telegram-users').value=(profile?.telegram_users||[]).map(name=>'@'+name).join(', ');$('creator-id').replaceChildren(new Option('Selecciona una modelo',''));$('creator-name').value='';$('dialog-title').textContent=profile?'Editar bot':'Añadir bot';$('keep-hint').hidden=!profile||profile.needs_token;$('telegram-token').required=!profile||profile.needs_token;$('form-error').textContent='Cargando modelos…';$('profile-dialog').showModal();lockForm(true);
 try{creators=(await api('/creators')).creators;for(const creator of creators){const option=new Option(creator.name, String(creator.external_id));option.disabled=profiles.some(p=>p.id!==editing?.id&&p.creator.external_id===creator.external_id);$('creator-id').add(option);}if(profile){$('creator-id').value=String(profile.creator.external_id);$('creator-name').value=profile.creator.name;}$('form-error').textContent='';}catch(error){$('form-error').textContent=error.message;}finally{lockForm(false);}
}
async function resolve(){const request=++resolveRequest;const id=$('creator-id').value;$('creator-name').value='';if(!id)return;checking=true;$('save').disabled=true;$('form-error').textContent='Consultando OnlyFans…';try{const data=await api('/resolve',{method:'POST',body:JSON.stringify({creator_id:id})});if(request===resolveRequest){$('creator-name').value=data.creator.name;$('form-error').textContent='';}}catch(error){if(request===resolveRequest)$('form-error').textContent=error.message;}finally{if(request===resolveRequest){checking=false;$('save').disabled=false;}}}
$('creator-id').addEventListener('change',resolve);
$('profile-form').addEventListener('submit',async event=>{event.preventDefault();if(saving||checking)return;saving=true;lockForm(true);$('form-error').textContent='Guardando…';const id=editing?editing.id:crypto.randomUUID();try{await api('/profiles/'+id,{method:'PUT',body:JSON.stringify({creator_id:$('creator-id').value,telegram_token:$('telegram-token').value.trim(),telegram_users:$('telegram-users').value.split(/[\s,]+/).filter(Boolean),revision:editing?editing.revision:0})});$('telegram-token').value='';$('profile-dialog').close();await reload();$('status').textContent='Configuración guardada';}catch(error){$('form-error').textContent=error.message;}finally{saving=false;lockForm(false);}});
function close(){if(!saving&&!checking){resolveRequest++;$('profile-form').reset();$('profile-dialog').close();}}
$('cancel').addEventListener('click',close);$('profile-dialog').addEventListener('cancel',event=>{if(saving||checking)event.preventDefault();else{$('profile-form').reset();resolveRequest++;}});
async function deleteProfile(profile,button){if(!await askConfirm('¿Eliminar este bot?','Se eliminará la configuración de '+profile.creator.name+'. Sus publicaciones se conservarán.','Eliminar bot'))return;button.disabled=true;try{await api('/profiles/'+profile.id,{method:'DELETE',headers:{'If-Match':String(profile.revision)}});await reload();}catch(error){$('profiles-error').textContent=error.message;button.disabled=false;}}
$('agency-form').addEventListener('submit',async event=>{event.preventDefault();if(!await askConfirm('¿Actualizar la API de AgencyKey?','La API se utilizará para todos los bots configurados.','Actualizar API'))return;$('save-api').disabled=true;$('api-error').textContent='';try{const key=$('agency-key').value.trim();if(!key)throw new Error('Introduce la API de AgencyKey');const result=await api('/agencykey',{method:'PUT',body:JSON.stringify({api_key:key})});$('agency-key').value='';creators=result.creators;$('api-status').textContent='API guardada · '+creators.length+' modelos disponibles';}catch(error){$('api-error').textContent=error.message;}finally{$('save-api').disabled=false;}});
$('access-form').addEventListener('submit',async event=>{event.preventDefault();if(!await askConfirm('¿Cambiar la contraseña de las apps?','Se pedirá la nueva contraseña en la próxima descarga de configuraciones.','Cambiar contraseña'))return;$('rotate').disabled=true;$('access-error').textContent='';try{await api('/access',{method:'POST',body:JSON.stringify({code:$('access-input').value})});$('access-input').value='';$('access-status').textContent='Contraseña cambiada';}catch(error){$('access-error').textContent=error.message;}finally{$('rotate').disabled=false;}});
$('nav-profiles').addEventListener('click',()=>section('profiles'));$('nav-drops').addEventListener('click',()=>section('drops'));$('nav-access').addEventListener('click',()=>section('access'));$('add').addEventListener('click',()=>openProfile());$('reload').addEventListener('click',reload);
function finishConfirm(value){const resolve=confirmResolve;confirmResolve=null;$('confirm-dialog').close();if(resolve)resolve(value);}
function askConfirm(title,message,label){if(confirmResolve)return Promise.resolve(false);$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-accept').textContent=label;$('confirm-dialog').showModal();$('confirm-cancel').focus();return new Promise(resolve=>confirmResolve=resolve);}
$('confirm-cancel').addEventListener('click',()=>finishConfirm(false));$('confirm-accept').addEventListener('click',()=>finishConfirm(true));$('confirm-dialog').addEventListener('cancel',event=>{event.preventDefault();finishConfirm(false);});
async function recordingStatus(){try{const data=await api('/recording-session');$('recording-session-status').textContent=data.configured?'Sesión guardada · Mi perfil se verifica automáticamente':'Sin sesión · conecta AgencyKey para grabar videos';$('connect-recording').textContent=data.configured?'Reconectar AgencyKey':'Conectar AgencyKey';}catch(error){$('recording-error').textContent=error.message;}}
function stopRecordingPoll(){recordingGeneration++;clearTimeout(recordingTimer);recordingTimer=null;}
const desktopJobRequest=(action,id)=>api('/recording-session/'+action,{method:'POST',body:JSON.stringify({id})});
const checkDesktopJob=id=>desktopJobRequest('check',id);
async function resumeRecordingConnection(){
 try{
  const job=await api('/recording-session/active');
  if(job.kind!=='connect'||!['queued','running','finishing'].includes(job.status))return;
  stopRecordingPoll();recordingJob=job.id;$('recording-error').textContent='';
  $('recording-help').textContent='Retomando la conexión de AgencyKey…';
  $('recording-dialog').showModal();recordingTimer=setTimeout(()=>checkRecording(recordingGeneration),2500);
 }catch(error){$('recording-session-status').textContent=error.message;}
}
async function checkRecording(generation){
 if(generation!==recordingGeneration||!$('recording-dialog').open)return;
 try{
  const data=await checkDesktopJob(recordingJob);
  if(generation!==recordingGeneration)return;
  if(data.status==='ready'){
   stopRecordingPoll();recordingJob=null;$('recording-dialog').close();await recordingStatus();
   if(embedded!=='operations')await reload();
   $('status').textContent='Sesión compartida guardada desde tu PC';return;
  }
  if(['queued','running','finishing'].includes(data.status)){
   $('recording-help').textContent=data.status==='queued'?'Esperando la app de Windows…':
    data.status==='finishing'?'Guardando la sesión…':'Inicia sesión en la ventana de Chrome que abrió la app. La sesión se guardará al entrar a AgencyKey.';
   recordingTimer=setTimeout(()=>checkRecording(generation),2500);return;
  }
  recordingJob=null;
  $('recording-error').textContent=data.status==='desktop_offline'?'Abre la app de Windows e inténtalo de nuevo':
   data.status==='connection_error'?'La app no pudo abrir AgencyKey en tu PC':'La conexión caducó o se canceló';
 }catch(error){
  if(generation===recordingGeneration){$('recording-error').textContent=error.message;if(error.retryable)recordingTimer=setTimeout(()=>checkRecording(generation),2500);}
 }
}
async function connectRecording(){
 if(recordingBusy)return;recordingBusy=true;stopRecordingPoll();recordingJob=null;
 const generation=recordingGeneration;
 $('recording-error').textContent='';$('recording-help').textContent='Esperando la app de Windows…';
 $('recording-dialog').showModal();$('recording-cancel').disabled=true;
 try{
  const requestId=crypto.randomUUID();
  const data=await verificationRequest('/recording-session/connect',{method:'POST',body:JSON.stringify({request_id:requestId})},message=>{$('recording-help').textContent=message;},()=>generation===recordingGeneration&&$('recording-dialog').open);
  recordingJob=data.id;recordingTimer=setTimeout(()=>checkRecording(generation),2500);
 }catch(error){$('recording-error').textContent=error.message;}
 finally{recordingBusy=false;$('recording-cancel').disabled=false;}
}
$('connect-recording').addEventListener('click',()=>connectRecording());
async function cancelRecording(){
 if(recordingBusy)return;recordingBusy=true;$('recording-cancel').disabled=true;
 try{
  if(recordingJob)await desktopJobRequest('cancel',recordingJob);
  stopRecordingPoll();recordingJob=null;$('recording-dialog').close();
 }catch(error){$('recording-error').textContent=error.message;}
 finally{recordingBusy=false;$('recording-cancel').disabled=false;}
}
$('recording-cancel').addEventListener('click',cancelRecording);$('recording-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelRecording();});
if(embedded){
 if((embedded==='bots'||embedded==='session')&&parent!==window){
  let lastError='';
  const sendErrors=()=>{
   const messages=[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent.trim())
    .filter(message=>message&&!['Cargando modelos…','Consultando OnlyFans…','Guardando…'].includes(message));
   const message=[...new Set(messages)].join(' · ');
   if(message!==lastError){lastError=message;parent.postMessage({type:'hers-dropper-error',message},location.origin);}
  };
  new MutationObserver(sendErrors).observe(document.body,{childList:true,subtree:true,characterData:true});
  const sendSize=()=>{
   const dialogs=[...document.querySelectorAll('dialog[open]')];
   const height=Math.max(document.body.getBoundingClientRect().height,
     ...dialogs.map(dialog=>dialog.scrollHeight+40));
   parent.postMessage({type:'hers-dropper-size',height:Math.ceil(height)+2},location.origin);
  };
  new ResizeObserver(sendSize).observe(document.body);
  new MutationObserver(sendSize).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  window.addEventListener('message',async event=>{
   if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='hers-dropper-refresh')return;
   try{
    if(!$('app-view').hidden)await (embedded==='bots'?reload():recordingStatus());
   }finally{parent.postMessage({type:'hers-dropper-ready',revision:event.data.revision},location.origin);}
  });
 }
 if(parent!==window)api('/session').then(showApp).catch(error=>{$('embed-error').textContent=error.message;})
  .finally(()=>parent.postMessage({type:'hers-dropper-ready'},location.origin));
 else $('embed-error').textContent='Abre esta sección desde el Panel Administración de HERS';
}else startStandalone();
})();
</script></body></html>`;
const STANDALONE_HEADER = `<header class="top"><div><span class="brand">Dropper</span><span class="muted"> / Administración</span></div><div class="top-right"><button id="logout" hidden>Cerrar sesión</button></div></header>
<div id="login-view" class="login-wrap" hidden><form id="login-form" class="login-form"><h1 id="login-title">Entrar a Dropper</h1><p id="login-help" class="muted">Introduce tu contraseña de administrador</p><label class="field">Contraseña<input id="admin-password" type="password" autocomplete="current-password" maxlength="256" required></label><label class="field" id="confirm-field" hidden>Repite la contraseña<input id="admin-confirm" type="password" autocomplete="new-password" maxlength="256"></label><button class="primary" id="login-button" type="submit">Entrar</button><div class="error" id="login-error" role="alert"></div></form></div>`;
const STANDALONE_PASSWORD_FORM = `<form id="admin-password-form" class="settings-form"><h3>Acceso de administrador</h3><label class="field">Contraseña actual<input id="admin-current" type="password" autocomplete="current-password" maxlength="256" required></label><label class="field">Nueva contraseña<input id="admin-next" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><div class="actions"><button class="primary" id="save-admin-password" type="submit">Cambiar mi contraseña</button></div><div class="error" id="admin-password-error" role="alert"></div><div class="status" id="admin-password-status" aria-live="polite"></div></form>`;

const STANDALONE_SCRIPT = `let setupToken=new URLSearchParams(location.hash.slice(1)).get('configurar')||'';
if(location.hash)history.replaceState(null,'',location.pathname);
function showStandaloneLogin(){
 $('admin-password-form').reset();$('admin-password').value='';$('admin-confirm').value='';
 $('logout').hidden=true;$('login-view').hidden=false;
 const setup=Boolean(setupToken);
 $('login-title').textContent=setup?'Crea tu contraseña':'Entrar a Dropper';
 $('login-help').textContent=setup?'Esta contraseña privada será solo para administrar la web':'Introduce tu contraseña de administrador';
 $('confirm-field').hidden=!setup;$('admin-confirm').required=setup;
 $('admin-password').minLength=setup?12:1;
 $('admin-password').autocomplete=setup?'new-password':'current-password';
 $('login-button').textContent=setup?'Crear contraseña y entrar':'Entrar';
}
function showStandaloneApp(){
 $('login-view').hidden=true;$('logout').hidden=false;
 $('admin-password').value='';$('admin-confirm').value='';
}
function startStandalone(){
 if(setupToken)showLogin();else api('/session').then(showApp).catch(showLogin);
}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();$('login-error').textContent='';if(setupToken&&$('admin-password').value!==$('admin-confirm').value){$('login-error').textContent='Las contraseñas no coinciden';return;}$('login-button').disabled=true;try{await api(setupToken?'/setup':'/login',{method:'POST',body:JSON.stringify({password:$('admin-password').value,...(setupToken?{token:setupToken}:{})})});setupToken='';await showApp();}catch(error){$('login-error').textContent=error.message;}finally{$('login-button').disabled=false;}});
$('logout').addEventListener('click',async()=>{if(!await askConfirm('¿Cerrar sesión?','Tendrás que entrar de nuevo para administrar tus bots.','Cerrar sesión'))return;try{await api('/logout',{method:'POST',body:'{}'});showLogin();}catch(error){$('profiles-error').textContent=error.message;}});
$('admin-password-form').addEventListener('submit',async event=>{event.preventDefault();if(!await askConfirm('¿Cambiar tu contraseña?','Las demás sesiones de administración tendrán que iniciar sesión de nuevo.','Cambiar contraseña'))return;$('save-admin-password').disabled=true;$('admin-password-error').textContent='';try{await api('/password',{method:'PUT',body:JSON.stringify({current_password:$('admin-current').value,password:$('admin-next').value})});$('admin-password-form').reset();$('admin-password-status').textContent='Contraseña de administrador cambiada';}catch(error){$('admin-password-error').textContent=error.message;}finally{$('save-admin-password').disabled=false;}});
`;

export function adminPage(nonce, embedded = ''){
 return PAGE.replaceAll('__NONCE__',nonce).replace('__EMBEDDED__',embedded)
  .replace('__STANDALONE_HEADER__',() => embedded ? '' : STANDALONE_HEADER)
  .replace('__STANDALONE_PASSWORD_FORM__',() => embedded ? '' : STANDALONE_PASSWORD_FORM)
  .replace('__STANDALONE_SCRIPT__',() => embedded ? '' : STANDALONE_SCRIPT)
  .replace('__REPORT_ZIP__',reportZip.toString());
}
