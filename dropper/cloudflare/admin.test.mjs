import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import worker,{saveSharedSession} from './worker.mjs';
import {origin,makeEnvironment,installUpstream,input,firstId,firstToken,secondToken,desktop,admin} from './test-support.mjs';

test('HERS separates the embedded bot tools from the history and settings',async()=>{
 const {env,sqlite}=makeEnvironment();installUpstream();
 env.HERS_SUPABASE_PUBLISHABLE_KEY='public-test-key';
 const upstream=globalThis.fetch;
 globalThis.fetch=async (url,options)=>{
  if(new URL(url).pathname!=='/auth/v1/user')return upstream(url,options);
  if(options.headers.Authorization!=='Bearer test-hers-admin')return Response.json({}, {status:401});
  return Response.json({id:firstId,app_metadata:{role:'admin'}});
 };
 await admin(env,'PUT','/v1/admin/agencykey',{api_key:input.api_key});
 await admin(env,'PUT','/v1/admin/profiles/'+firstId,input);
 const browser=await chromium.launch({headless:true,executablePath:process.env.RECORDER_TEST_CHROME,channel:process.env.RECORDER_TEST_CHROME?undefined:(process.platform==='win32'?'msedge':'chrome')});
 try{
  const page=await browser.newPage({viewport:{width:420,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(origin+'/**',async route=>{
   const req=route.request();
   const url=new URL(req.url());
   if(url.pathname==='/hers'){
    return route.fulfill({contentType:'text/html',body:`<iframe id="operations" title="Dropper" src="/embed/operations"></iframe>
      <iframe id="bots" title="Bots" src="/embed/bots"></iframe><script>addEventListener('message',event=>{
      if(event.origin===location.origin && event.data?.type==='hers-dropper-session'){
        event.ports[0].postMessage({token:'test-hers-admin'});event.ports[0].close();}
      });</script>`});
   }
   const init={method:req.method(),headers:await req.allHeaders()};
   if(req.postDataBuffer())init.body=req.postDataBuffer();
   url.pathname=url.pathname.replace('/api/admin/dropper/api/', '/v1/hers-admin/');
   const response=await worker.fetch(new Request(url,init),env);
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(origin+'/hers');
  const operations=page.frameLocator('#operations');
  await operations.getByRole('heading',{name:'Resumen diario de Drops'}).waitFor();
  await operations.getByRole('button',{name:'Ajustes',exact:true}).click();
  await operations.getByRole('heading',{name:'Acceso de las apps'}).waitFor();
  assert.equal(await operations.getByRole('button',{name:'Conectar AgencyKey'}).count(),0);
  assert.equal(await operations.getByRole('heading',{name:'AgencyKey para los bots'}).count(),0);
  assert.equal(await operations.getByRole('button',{name:'Añadir bot'}).count(),0);
  assert.equal(await operations.getByRole('heading',{name:'Acceso de administrador'}).count(),0);

  const bots=page.frameLocator('#bots');
  await bots.getByRole('button',{name:'Editar Lilith',exact:true}).waitFor();
  await bots.getByRole('button',{name:'Verificar Mi perfil de Lilith',exact:true}).waitFor();
  assert.equal(await bots.getByRole('button',{name:'Ajustes',exact:true}).count(),0);
  await bots.getByRole('button',{name:'Conectar AgencyKey'}).waitFor();
  await bots.getByRole('heading',{name:'AgencyKey para los bots'}).waitFor();
  assert.equal(await bots.getByRole('button',{name:'Actualizar',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
 }finally{
  await browser.close();sqlite.close();globalThis.fetch=upstream;
 }
});

test('password administrator configures a shared API, selects models and rotates app password',async()=>{
 const {env,sqlite}=makeEnvironment();const upstream=installUpstream();env.ADMIN_SETUP=JSON.stringify({token:'browser-private-setup',expires:Date.now()+3600000});
 const browser=await chromium.launch({headless:true,executablePath:process.env.RECORDER_TEST_CHROME,channel:process.env.RECORDER_TEST_CHROME?undefined:(process.platform==='win32'?'msedge':'chrome')});
 try{
 const page=await browser.newPage({viewport:{width:1120,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/**',async route=>{const req=route.request();const init={method:req.method(),headers:await req.allHeaders()};if(req.postDataBuffer())init.body=req.postDataBuffer();const response=await worker.fetch(new Request(req.url(),init),env);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 await page.goto(origin+'/admin#configurar=browser-private-setup');await page.locator('#login-title').filter({hasText:'Crea tu contraseña'}).waitFor();assert.equal(await page.evaluate(()=>location.hash),'');
 await page.locator('#admin-password').fill('private-browser-password');await page.locator('#admin-confirm').fill('mismatch');await page.locator('#login-button').click();await page.locator('#login-error').filter({hasText:'no coinciden'}).waitFor();
 await page.locator('#admin-confirm').fill('private-browser-password');await page.locator('#login-button').click();await page.locator('#empty').waitFor({state:'visible'});assert.ok(!(await page.evaluate(()=>document.cookie)).includes('__Host-recorder_admin'));
 await page.reload();await page.locator('#app-view').waitFor({state:'visible'});await page.locator('#logout').click();await page.locator('#confirm-accept').click();await page.locator('#login-view').waitFor({state:'visible'});
 await page.locator('#admin-password').fill(env.ACCESS_TOKEN);await page.locator('#login-button').click();await page.locator('#login-error').filter({hasText:'incorrecta'}).waitFor();await page.locator('#admin-password').fill('private-browser-password');await page.locator('#login-button').click();await page.locator('#empty').waitFor({state:'visible'});
 await page.locator('#nav-access').click();await page.locator('#agency-key').fill(input.api_key);await page.locator('#save-api').click();await page.locator('#confirm-accept').click();await page.locator('#api-status').filter({hasText:'2 modelos'}).waitFor();assert.equal(await page.locator('#agency-key').inputValue(),'');
 await page.locator('#nav-profiles').click();await page.locator('#add').click();await page.locator('#creator-id option[value="52"]').waitFor({state:'attached'});await page.locator('#telegram-token').fill(firstToken);await page.locator('#creator-id').selectOption('52');await page.waitForFunction(()=>document.getElementById('creator-name').value==='Lilith');await page.locator('#save').click();await page.getByRole('button',{name:'Editar Lilith',exact:true}).waitFor();assert.equal(sqlite.prepare('SELECT name FROM profiles').get().name,'Lilith');
 await page.locator('#add').click();await page.locator('#creator-id option[value="99"]').waitFor({state:'attached'});await page.locator('#telegram-token').fill(secondToken);await page.locator('#creator-id').selectOption('99');await page.waitForFunction(()=>document.getElementById('creator-name').value==='Lola');await page.locator('#save').click();await page.getByRole('button',{name:'Editar Lola',exact:true}).waitFor();
 assert.equal((await (await desktop(env,'GET','/v1/profiles')).json()).profiles.length,2);
 const drop = {drop_id:'a'.repeat(32),position:1,post_id:'101',creator_id:52,creator_name:'Lilith',
  manual:false,confirmed_at:Date.parse('2026-11-16T04:01:00Z')/1000};
 assert.equal((await desktop(env,'POST','/v1/drop-publications',{posts:[drop,
  {...drop,position:3,post_id:'103',manual:true},
  {...drop,creator_id:99,creator_name:'Lola',post_id:'207'}]})).status,200);
 await page.locator('#nav-drops').click();
 const date = page.locator('#drops-date');
 await date.fill('2026-11-16');
 await page.locator('#drops-body article').filter({hasText:'Lilith'}).getByText('1 Drop · 2 posts · 1 automático · 1 manual').waitFor();
 await page.locator('#drops-body article').filter({hasText:'Lola'}).getByText('1 Drop · 1 post · 1 automático · 0 manuales').waitFor();
 await date.fill('2026-11-15');
 await page.locator('#drops-status').filter({hasText:'No hay publicaciones'}).waitFor();
 await page.locator('#nav-profiles').click();
 await page.getByRole('button',{name:'Editar Lilith',exact:true}).click();await page.locator('#creator-id option[value="52"]').waitFor({state:'attached'});upstream.ofNames[52]='Lilith actualizada';await page.locator('#save').click();await page.getByRole('button',{name:'Editar Lilith actualizada',exact:true}).waitFor();
 await page.getByRole('button',{name:'Eliminar Lola',exact:true}).click();await page.locator('#confirm-accept').click();await page.waitForFunction(()=>document.querySelectorAll('#profiles-body .bot-row').length===1);
 await page.setViewportSize({width:390,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1120,height:900});await mkdir('ui-checks',{recursive:true});await page.screenshot({path:'ui-checks/dropper-panel.png',fullPage:true});
 await page.locator('#nav-access').click();await page.locator('#access-input').fill('nueva-contraseña-elegida');await page.locator('#rotate').click();await page.locator('#confirm-accept').click();await page.locator('#access-status').filter({hasText:'Contraseña cambiada'}).waitFor();assert.equal(await page.locator('#access-input').inputValue(),'');assert.equal((await desktop(env,'GET','/v1/profiles')).status,401);assert.equal((await desktop(env,'GET','/v1/profiles',undefined,'nueva-contraseña-elegida')).status,200);assert.deepEqual(errors,[]);
 }finally{await browser.close();sqlite.close();}
});

test('manual web verification shows its own error, downloads a valid ZIP and recovers without app error state',async()=>{
 const {env,sqlite}=makeEnvironment();installUpstream();
 await admin(env,'PUT','/v1/admin/agencykey',{api_key:input.api_key});
 await admin(env,'PUT','/v1/admin/profiles/'+firstId,input);
 await saveSharedSession(env,{cookies:[{name:'session',domain:'.agencykey.com',value:'private-cookie'}],origins:[]},null);
 const browser=await chromium.launch({headless:true,executablePath:process.env.RECORDER_TEST_CHROME,channel:process.env.RECORDER_TEST_CHROME?undefined:(process.platform==='win32'?'msedge':'chrome')});
 try{
  const page=await browser.newPage({viewport:{width:1120,height:900},acceptDownloads:true});
  const screenshot=(await page.screenshot({type:'jpeg',quality:30})).toString('base64');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let mode='fail';
  await page.route(origin+'/**',async route=>{
   const req=route.request();
   if(mode==='web_offline'&&req.method()==='POST'&&req.url().includes('/recording-session/feed/')){
    await route.abort('failed');return;
   }
   if(req.url().endsWith('/recording-session/check')){
    if(mode==='offline'){
     const row=sqlite.prepare('SELECT value FROM settings WHERE key=?').get('recording_desktop_job');
     const job=JSON.parse(row.value);job.expires=Date.now()-1;
     sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(job),'recording_desktop_job');
    }else{
     const {job}=await (await desktop(env,'POST','/v1/recording-desktop-job')).json();
     if(job)await desktop(env,'PUT','/v1/recording-desktop-job',{id:job.id,claim:job.claim,identity_checked:true,
      ...(mode==='ready'?{status:'ready',observed_username:'model_52'}:{status:'profile_unverified',diagnostic:{
       stage:'verificar Mi perfil',error:'Mi perfil no terminó de cargar después del cambio',
       cookies:['private-cookie'],screenshot:{mime:'image/jpeg',data:screenshot},
       frames:[{frame_index:1,visible:true,url:'https://of-52.agencykey.com/model_52',profile_header:false}]}})});
    }
   }
   const init={method:req.method(),headers:await req.allHeaders()};if(req.postDataBuffer())init.body=req.postDataBuffer();
   const response=await worker.fetch(new Request(req.url(),init),env);
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(origin+'/admin');await page.locator('#admin-password').fill(env.ADMIN_TOKEN);await page.locator('#login-button').click();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).waitFor();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).click();
  await page.locator('#web-report-detail').filter({hasText:'Mi perfil no terminó de cargar después del cambio'}).waitFor();
  assert.equal(await page.locator('#web-report-image').isVisible(),true);
  const downloading=page.waitForEvent('download');await page.locator('#web-report-download').click();const download=await downloading;
  assert.equal(download.suggestedFilename(),'verificacion-web-52.zip');
  const checked=spawnSync(process.platform==='win32'?'python':'python3',['-c',
   'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"files":z.namelist(),"report":json.loads(z.read("diagnostic.json"))}))',await download.path()],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);const exported=JSON.parse(checked.stdout);
  assert.deepEqual(exported.files,['diagnostic.json','chrome.jpg']);assert.equal(exported.report.source,'web_verification');
  assert.ok(!checked.stdout.includes('private-cookie'));
  await page.locator('#web-report-close').click();await page.reload();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).click();
  await page.locator('#web-report-detail').filter({hasText:'Mi perfil no terminó de cargar después del cambio'}).waitFor();
  await page.setViewportSize({width:390,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await mkdir('ui-checks',{recursive:true});await page.screenshot({path:'ui-checks/web-verification-report.png',fullPage:true});
  await page.locator('#web-report-close').click();mode='ready';
  await page.getByRole('button',{name:'Verificar Mi perfil de Lilith',exact:true}).click();
  await page.locator('#profiles-body .muted').filter({hasText:'Mi perfil coincide'}).waitFor();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).click();
  await page.locator('#web-report-detail').filter({hasText:'Mi perfil coincide'}).waitFor();
  assert.equal(await page.locator('#web-report-image').isVisible(),false);
  assert.ok(!(await page.locator('#web-report-detail').textContent()).includes('no terminó de cargar después del cambio'));
  await page.locator('#web-report-close').click();mode='offline';
  await page.getByRole('button',{name:'Verificar Mi perfil de Lilith',exact:true}).click();
  await page.locator('#profiles-body .muted').filter({hasText:'Esperando la app de Windows'}).waitFor();
  await page.getByRole('button',{name:'Verificar Mi perfil de Lilith',exact:true}).click();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).waitFor();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).click();
  await page.locator('#web-report-detail').filter({hasText:'cancelled'}).waitFor();
  assert.equal(await page.locator('#web-report-image').isVisible(),false);
  await page.locator('#web-report-close').click();mode='web_offline';
  await page.getByRole('button',{name:'Verificar Mi perfil de Lilith',exact:true}).click();
  await page.locator('#profiles-body .muted').filter({hasText:'Conexión interrumpida'}).waitFor();
  mode='ready';
  await page.locator('#profiles-body .muted').filter({hasText:'Mi perfil coincide'}).waitFor();
  await page.getByRole('button',{name:'Ver detalle de verificación de Lilith',exact:true}).click();
  await page.locator('#web-report-detail').filter({hasText:'Mi perfil coincide'}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();sqlite.close();}
});
