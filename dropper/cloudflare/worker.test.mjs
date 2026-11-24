import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {makeEnvironment,installUpstream,request,admin,desktop,firstId,secondId,firstToken,secondToken,input} from './test-support.mjs';
import {saveSharedSession} from './worker.mjs';
import {cleanWebDiagnostic,reportZip} from './web-report.mjs';
let env,db,upstream;
const route='/v1/admin/profiles/'+firstId;
const credentials='/v1/profiles/'+firstId+'/credentials';
beforeEach(async()=>{const state=makeEnvironment();env=state.env;db=state.sqlite;upstream=installUpstream();assert.equal((await admin(env,'PUT','/v1/admin/agencykey',{api_key:input.api_key})).status,200);upstream.calls=[];});
test('serves a public login page but requires a private admin session for data',async()=>{
 const response=await request(env,'GET','/admin');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);const html=await response.text();assert.ok(html.includes('Entrar a Dropper'));assert.ok(!html.includes(env.ADMIN_TOKEN));assert.ok(!html.includes(env.ENCRYPTION_KEY));
 for(const path of ['/v1/admin/session','/v1/admin/profiles']){
  assert.equal((await request(env,'GET',path)).status,401);
  assert.equal((await request(env,'GET',path,undefined,{'Cf-Access-Authenticated-User-Email':'owner@example.test',Authorization:'Bearer '+env.ADMIN_TOKEN},{access:{getIdentity:async()=>({email:'owner@example.test'})}})).status,401);
 }
});
test('HERS uses the same history and bot settings with a verified Supabase administrator',async()=>{
 const key='public-test-key';
 const uid='f857cfaf-b708-4307-a47e-a5d321ce3687';
 const originalFetch=globalThis.fetch;
 env.HERS_SUPABASE_PUBLISHABLE_KEY=key;
 globalThis.fetch=async (url,options)=>{
  if(new URL(url).pathname!=='/auth/v1/user')return originalFetch(url,options);
  assert.equal(new URL(url).hostname,'glpevkghlzzuwkxojpvc.supabase.co');
  assert.equal(options.headers.apikey,key);
  switch(options.headers.Authorization){
   case 'Bearer verified-admin': return Response.json({id:uid,app_metadata:{role:'admin'}});
   case 'Bearer self-reported': return Response.json({id:uid,user_metadata:{role:'admin'},app_metadata:{role:'chatter'}});
   default: return Response.json({}, {status:401});
  }
 };
 const call=(method,path,body,headers={})=>request(env,method,'/v1/hers-admin'+path,body,{Authorization:'Bearer verified-admin',...headers});
 try{
  assert.equal((await request(env,'GET','/v1/hers-admin/profiles')).status,401);
  assert.equal((await call('GET','/profiles',undefined,{Authorization:'Bearer invalid'})).status,401);
  assert.equal((await call('GET','/drops',undefined,{Authorization:'Bearer self-reported'})).status,403);
  assert.equal((await call('PUT','/profiles/'+firstId,input,{Origin:'https://other.test'})).status,403);
  assert.equal((await call('POST','/setup',{})).status,404);
  assert.equal((await call('POST','/logout',{})).status,404);
  assert.equal((await call('PUT','/password',{})).status,404);
  assert.equal((await call('POST','/profiles/'+firstId+'/credentials',{})).status,404);
  assert.equal((await call('PUT','/profiles/'+firstId,input)).status,200);
  assert.deepEqual((await (await call('GET','/active-bots')).json()).profiles, []);
  const activity={profiles:[{id:firstId,revision:1}]};
  assert.equal((await request(env,'POST','/v1/bot-activity',activity)).status,401);
  assert.equal((await desktop(env,'POST','/v1/bot-activity',activity)).status,200);
  assert.equal((await (await call('GET','/active-bots')).json()).profiles[0].id,firstId);
  db.prepare('UPDATE bot_activity SET last_seen = ?').run(Date.now()-91_000);
  assert.deepEqual((await (await call('GET','/active-bots')).json()).profiles, []);
  const desktopProfile=await desktop(env,'POST',credentials);
  assert.equal((await desktopProfile.json()).telegram_token,firstToken);
  const listed=await (await call('GET','/profiles')).text();
  assert.ok(listed.includes('Lilith'));
  assert.ok(!listed.includes(firstToken));
  assert.ok(!listed.includes(input.api_key));
  const day='2026-11-16';
  const post={drop_id:'a'.repeat(32),position:1,post_id:'101',creator_id:52,creator_name:'Lilith',
   manual:false,confirmed_at:Date.parse(day+'T12:00:00Z')/1000};
  assert.equal((await desktop(env,'POST','/v1/drop-publications',{posts:[post]})).status,200);
  assert.equal((await (await call('GET','/drops?date='+day)).json()).drops[0].automatic,1);
  const connect=await call('POST','/recording-session/connect',{request_id:firstId});
  assert.equal(connect.status,202);
  const {job}=await (await desktop(env,'POST','/v1/recording-desktop-job')).json();
  assert.equal(job.id,(await connect.json()).id);
 }finally{globalThis.fetch=originalFetch;}
});
test('only embedded views allow same-origin framing',async()=>{
 for(const view of ['bots','operations']){
  const response=await request(env,'GET','/embed/'+view);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  const html=await response.text();
  assert.ok(html.includes('data-embedded="'+view+'"'));
  assert.ok(!html.includes(env.ADMIN_TOKEN));
 }
 assert.equal((await request(env,'GET','/embed/unknown')).status,401);
});
test('desktop password cannot administer settings or bots',async()=>{
 for(const path of ['/v1/admin/profiles','/v1/admin/resolve','/v1/admin/access','/v1/admin/agencykey'])assert.equal((await desktop(env,'POST',path,{})).status,401);
 assert.equal((await desktop(env,'PUT','/v1/profiles/'+firstId,input)).status,403);
 assert.equal((await request(env,'GET','/v1/profiles')).status,401);
});
test('lists all pages and resolves the actual OnlyFans name instead of the CRM alias',async()=>{
 upstream.pages=2;
 const listed=await admin(env,'GET','/v1/admin/creators');assert.equal((await listed.json()).creators.length,2);
 const resolved=await admin(env,'POST','/v1/admin/resolve',{creator_id:'52'});assert.equal((await resolved.json()).creator.name,'Lilith');
 const saved=await admin(env,'PUT',route,{...input,name:'Untrusted',creator:{name:'Wrong'}});assert.equal(saved.status,200);const data=await saved.json();assert.equal(data.name,'Lilith');assert.equal(data.creator.external_id,52);assert.equal(data.revision,1);
});
test('uses canonical username when AgencyKey cannot proxy users/me',async()=>{
 upstream.meStatus=400;const response=await admin(env,'PUT',route,input);assert.equal(response.status,200);assert.equal((await response.json()).name,'@model_52');
});
test('encrypts one API globally and Telegram tokens per bot',async()=>{
 await admin(env,'PUT',route,input);
 const row=db.prepare('SELECT encrypted_secrets FROM profiles WHERE id=?').get(firstId);assert.ok(!row.encrypted_secrets.includes(firstToken));
 const settings=db.prepare("SELECT value FROM settings WHERE key='agencykey'").get();assert.ok(!settings.value.includes(input.api_key));
 for(const response of [await admin(env,'GET','/v1/admin/profiles'),await desktop(env,'GET','/v1/profiles')]){const text=await response.text();assert.ok(!text.includes('api_key'));assert.ok(!text.includes('telegram_token'));}
 const response=await desktop(env,'POST',credentials);assert.match(response.headers.get('cache-control'),/no-store/);const result=await response.json();assert.equal(result.telegram_token,firstToken);assert.equal(result.api_key,input.api_key);
});
test('global API overrides stale per-bot keys supplied by a client',async()=>{
 const response=await admin(env,'PUT',route,{...input,api_key:'ignored-per-bot-key'});assert.equal(response.status,200);assert.equal((await (await desktop(env,'POST',credentials)).json()).api_key,input.api_key);
 assert.equal((await admin(env,'PUT','/v1/admin/agencykey',{api_key:'wrong-key'})).status,400);
 assert.equal((await (await desktop(env,'POST',credentials)).json()).api_key,input.api_key);
});
test('rejects inaccessible IDs without saving a profile',async()=>{
 for(const creator_id of [88,'05',-2])assert.equal((await admin(env,'PUT',route,{...input,creator_id})).status,400);
 assert.equal(db.prepare('SELECT count(*) AS count FROM profiles').get().count,0);
});
test('one bot per model and one configuration per Telegram bot',async()=>{
 await admin(env,'PUT',route,input);
 assert.equal((await admin(env,'PUT','/v1/admin/profiles/'+secondId,{...input,telegram_token:secondToken})).status,409);
 assert.equal((await admin(env,'PUT','/v1/admin/profiles/'+secondId,{...input,creator_id:99})).status,409);
});
test('keeps token during edits and refreshes the OnlyFans name',async()=>{
 await admin(env,'PUT',route,input);upstream.ofNames[52]='Lilith actualizada';
 const response=await admin(env,'PUT',route,{creator_id:52,revision:1});assert.equal(response.status,200);assert.equal((await response.json()).name,'Lilith actualizada');
 assert.equal((await (await desktop(env,'POST',credentials)).json()).telegram_token,firstToken);
 assert.equal((await admin(env,'PUT',route,{creator_id:52,revision:1})).status,409);
});
test('deletes matching revision and blocks deleted credentials',async()=>{
 await admin(env,'PUT',route,input);
 assert.equal((await admin(env,'DELETE',route,undefined,{'If-Match':'2'})).status,409);
 assert.equal((await admin(env,'DELETE',route,undefined,{'If-Match':'1'})).status,200);
 assert.equal((await desktop(env,'POST',credentials)).status,404);
});
test('rejects bad tokens, large bodies, CSRF and invalid upstream JSON',async()=>{
 assert.equal((await admin(env,'PUT',route,{...input,telegram_token:'invalid'})).status,400);
 assert.equal((await admin(env,'PUT',route,'invalid-json')).status,400);
 assert.equal((await admin(env,'PUT',route,'x'.repeat(16385))).status,413);
 assert.equal((await admin(env,'POST','/v1/admin/access',{code:'new-password'},{Origin:'https://evil.test'})).status,403);
 upstream.invalid=true;const response=await admin(env,'PUT',route,input);assert.equal(response.status,502);assert.ok(!(await response.text()).includes(input.api_key));
});
test('ciphertext is bound to its profile identity',async()=>{
 await admin(env,'PUT',route,input);db.prepare('UPDATE profiles SET id=? WHERE id=?').run(secondId,firstId);
 assert.equal((await desktop(env,'POST','/v1/profiles/'+secondId+'/credentials')).status,500);
});
test('custom password revokes old downloads and stores only salted derived hash',async()=>{
 await admin(env,'PUT',route,input);
 const code='mi-contraseña-nueva';assert.equal((await admin(env,'POST','/v1/admin/access',{code})).status,200);
 const saved=db.prepare("SELECT value FROM settings WHERE key='app_access'").get().value;assert.ok(!saved.includes(code));assert.ok(saved.includes('pbkdf2'));
 assert.equal((await desktop(env,'GET','/v1/profiles')).status,401);assert.equal((await desktop(env,'POST',credentials,undefined,code)).status,200);
 assert.equal((await admin(env,'GET','/v1/admin/profiles')).status,200);
 env.ACCESS_TOKEN='new-cloudflare-secret';assert.equal((await desktop(env,'GET','/v1/profiles')).status,200);assert.equal((await desktop(env,'POST',credentials,undefined,code)).status,401);
});
test('limits failed desktop password attempts',async()=>{
 for(let i=0;i<10;i++)assert.equal((await desktop(env,'GET','/v1/profiles',undefined,'wrong')).status,401);
 assert.equal((await desktop(env,'GET','/v1/profiles',undefined,'wrong')).status,429);
});
test('desktop polling reuses an encrypted password verification across Worker instances until it expires',async t=>{
 const code='desktop-polling-password';
 assert.equal((await admin(env,'POST','/v1/admin/access',{code})).status,200);
 const clock=t.mock.method(Date,'now',()=>1700000000000);
 const pbkdf2=t.mock.method(crypto.subtle,'deriveBits');
 const cached=()=>db.prepare("SELECT value FROM settings WHERE key='app_access_verification'").get();
 const revisions='/v1/profile-revisions';
 const jobs='/v1/recording-desktop-job';
 assert.equal((await desktop(env,'GET',revisions,undefined,'wrong')).status,401);
 assert.equal(cached(),undefined);
 assert.equal((await desktop(env,'GET',revisions,undefined,code)).status,200);
 assert.equal(pbkdf2.mock.callCount(),2);
 const saved=cached().value;
 const {expires,encrypted}=JSON.parse(saved);
 assert.equal(expires,Date.now()+86400000);
 assert.equal(typeof JSON.parse(encrypted).ciphertext,'string');
 assert.ok(!saved.includes(code));
 const freshWorker=(await import('./worker.mjs?desktop-polling')).default;
 const poll=method=>freshWorker.fetch(new Request('https://dropper.test'+(method==='GET'?revisions:jobs),{
   method,headers:{Authorization:'Bearer '+code,'X-Recorder-Protocol':'2'},
 }),env);
 for(let i=0;i<5;i++){
  assert.deepEqual(await (await poll('GET')).json(),{profiles:[]});
  assert.deepEqual(await (await poll('POST')).json(),{job:null});
 }
 for(let i=0;i<9;i++)assert.equal((await desktop(env,'GET',revisions,undefined,'wrong')).status,401);
 assert.equal((await poll('GET')).status,429);
 assert.equal(pbkdf2.mock.callCount(),2);
 assert.equal(cached().value,saved);
 clock.mock.mockImplementation(()=>expires);
 assert.equal((await poll('GET')).status,200);
 assert.equal(pbkdf2.mock.callCount(),3);
 assert.equal(JSON.parse(cached().value).expires,expires+86400000);
});

test('rotating app access or the Worker encryption key invalidates the encrypted verifier',async t=>{
 const old='contraseña anterior 🔐';
 const current='contraseña vigente 🔐';
 const revisions='/v1/profile-revisions';
 const unicode=code=>request(env,'GET',revisions,undefined,{
  Authorization:'Dropper '+Buffer.from(code,'utf8').toString('base64url'),'X-Recorder-Protocol':'2',
 });
 assert.equal((await admin(env,'POST','/v1/admin/access',{code:old})).status,200);
 assert.equal((await unicode(old)).status,200);
 assert.equal((await admin(env,'POST','/v1/admin/access',{code:current})).status,200);
 const pbkdf2=t.mock.method(crypto.subtle,'deriveBits');
 assert.equal((await unicode(old)).status,401);
 assert.equal((await unicode(current)).status,200);
 assert.equal((await unicode(old)).status,401);
 assert.equal((await unicode(current)).status,200);
 assert.equal(pbkdf2.mock.callCount(),2);
 const read=()=>db.prepare("SELECT value FROM settings WHERE key='app_access_verification'").get().value;
 const saved=read();
 const tampered=JSON.parse(saved);
 tampered.expires+=86400000;
 db.prepare("UPDATE settings SET value=? WHERE key='app_access_verification'").run(JSON.stringify(tampered));
 assert.equal((await unicode(current)).status,200);
 assert.equal(pbkdf2.mock.callCount(),3);
 env.ENCRYPTION_KEY=Buffer.alloc(32,30).toString('base64');
 assert.equal((await unicode(current)).status,200);
 assert.equal((await unicode(current)).status,200);
 assert.equal(pbkdf2.mock.callCount(),4);
 assert.notEqual(read(),saved);
});

test('automatically migrates the existing shared API without exposing it',async()=>{
 // Build a legacy encrypted profile using the same AES-GCM envelope.
 db.prepare("DELETE FROM settings WHERE key='agencykey'").run();
 const iv=crypto.getRandomValues(new Uint8Array(12));const raw=Buffer.from(env.ENCRYPTION_KEY,'base64');const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(firstId)},key,new TextEncoder().encode(JSON.stringify({api_key:input.api_key,telegram_token:firstToken})));
 db.prepare('INSERT INTO profiles(id,name,bot_id,creator_id,creator_name,encrypted_secrets,updated_at) VALUES(?,?,?,?,?,?,?)').run(firstId,'Lilith','12345678',52,'Lilith',JSON.stringify({v:1,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')}),'now');
 assert.equal((await admin(env,'GET','/v1/admin/settings')).status,200);assert.ok(db.prepare("SELECT value FROM settings WHERE key='agencykey'").get());
 assert.equal((await (await desktop(env,'POST',credentials)).json()).api_key,input.api_key);
});

test('admin login uses a secure server-side session and logout revokes it',async()=>{
 assert.equal((await request(env,'POST','/v1/admin/login',{password:env.ACCESS_TOKEN})).status,401);
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});assert.equal(login.status,200);
 const raw=login.headers.get('set-cookie');assert.match(raw,/HttpOnly; Secure; SameSite=Strict/);
 const headers={Cookie:raw.split(';')[0]};assert.equal((await request(env,'GET','/v1/admin/session',undefined,headers)).status,200);
 assert.equal((await request(env,'GET','/v1/admin/session',undefined,{Cookie:headers.Cookie+'x'})).status,401);
 assert.equal((await request(env,'POST','/v1/admin/logout',{},headers)).status,200);
 assert.equal((await request(env,'GET','/v1/admin/session',undefined,headers)).status,401);
});
test('private setup link creates the admin password once, with no shared app access',async()=>{
 const token='private-setup-token-for-owner-only';env.ADMIN_SETUP=JSON.stringify({token,expires:Date.now()+3600000});
 assert.equal((await request(env,'POST','/v1/admin/setup',{token:'wrong',password:'private-new-password'})).status,403);
 const response=await request(env,'POST','/v1/admin/setup',{token,password:'private-new-password'});assert.equal(response.status,200);
 assert.equal((await request(env,'POST','/v1/admin/setup',{token,password:'another-private-password'})).status,409);
 assert.equal((await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN})).status,401);
 assert.equal((await request(env,'POST','/v1/admin/login',{password:'private-new-password'})).status,200);
 assert.equal((await desktop(env,'GET','/v1/profiles',undefined,'private-new-password')).status,401);
 const saved=db.prepare("SELECT value FROM settings WHERE key='admin_access'").get().value;assert.ok(!saved.includes('private-new-password'));assert.ok(!saved.includes(token));
});
test('rejects expired setup links and matching admin and app passwords',async()=>{
 const token='private-bootstrap';env.ADMIN_SETUP=JSON.stringify({token,expires:Date.now()-1});
 assert.equal((await request(env,'POST','/v1/admin/setup',{token,password:'private-new-password'})).status,403);
 env.ADMIN_SETUP=JSON.stringify({token,expires:Date.now()+3600000});
 assert.equal((await request(env,'POST','/v1/admin/setup',{token,password:env.ACCESS_TOKEN})).status,400);
 assert.equal((await admin(env,'POST','/v1/admin/access',{code:env.ADMIN_TOKEN})).status,400);
});
test('changing admin password invalidates prior sessions while preserving app access',async()=>{
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 assert.equal((await request(env,'PUT','/v1/admin/password',{current_password:'wrong',password:'another-private-password'},headers)).status,400);
 const changed=await request(env,'PUT','/v1/admin/password',{current_password:env.ADMIN_TOKEN,password:'another-private-password'},headers);assert.equal(changed.status,200);
 assert.equal((await request(env,'GET','/v1/admin/session',undefined,headers)).status,401);
 assert.equal((await request(env,'GET','/v1/admin/session',undefined,{Cookie:changed.headers.get('set-cookie').split(';')[0]})).status,200);
 assert.equal((await desktop(env,'GET','/v1/profiles')).status,200);
});
test('rate limits admin logins and rejects cross-origin login and setup',async()=>{
 assert.equal((await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN},{Origin:'https://evil.test'})).status,403);
 assert.equal((await request(env,'POST','/v1/admin/setup',{},{Origin:'https://evil.test'})).status,403);
 for(let i=0;i<10;i++)assert.equal((await request(env,'POST','/v1/admin/login',{password:'wrong'})).status,401);
 assert.equal((await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN})).status,429);
});

test('Workers runtime connects to AgencyKey without unsupported redirect mode or leaking keys',async()=>{
 const {Miniflare,Response:RuntimeResponse}=await import('miniflare');
 const {build}=await import('esbuild');
 const {readFileSync}=await import('node:fs');
 const {fileURLToPath}=await import('node:url');
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:*','cloudflare:*']});
 let redirect=false;const calls=[];
 const runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-db'},bindings:{ADMIN_TOKEN:env.ADMIN_TOKEN,ACCESS_TOKEN:env.ACCESS_TOKEN,ENCRYPTION_KEY:env.ENCRYPTION_KEY},outboundService:async req=>{
  const url=new URL(req.url);calls.push(url.href);
  assert.equal(url.origin,'https://app.agencykey.com');assert.equal(req.headers.get('x-public-api-key'),input.api_key);
  if(redirect)return new RuntimeResponse(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});
  return new RuntimeResponse(JSON.stringify({data:[{name:'CRM alias',account:{externalId:52,username:'model_52'}}],pagination:{pages:1}}),{headers:{'Content-Type':'application/json'}});
 }});
 try {
  const database=await runtime.getD1Database('DB');
  const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await database.prepare(sql).run();
  const login=await runtime.dispatchFetch('https://dropper.test/v1/admin/login',{method:'POST',headers:{Origin:'https://dropper.test','Content-Type':'application/json'},body:JSON.stringify({password:env.ADMIN_TOKEN})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const save=()=>runtime.dispatchFetch('https://dropper.test/v1/admin/agencykey',{method:'PUT',headers:{Origin:'https://dropper.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({api_key:input.api_key})});
  const result=await save();assert.equal(result.status,200);assert.equal((await result.json()).creators[0].username,'model_52');assert.equal(calls.length,1);
  redirect=true;const rejected=await save();assert.equal(rejected.status,502);assert.match((await rejected.json()).error,/redirección/);assert.equal(calls.length,2);
  const code='runtime-desktop-password';
  const rotated=await runtime.dispatchFetch('https://dropper.test/v1/admin/access',{method:'POST',headers:{Origin:'https://dropper.test','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({code})});
  assert.equal(rotated.status,200);
  const headers={Authorization:'Bearer '+code,'X-Recorder-Protocol':'2'};
  const revisions=await runtime.dispatchFetch('https://dropper.test/v1/profile-revisions',{headers});
  assert.deepEqual(await revisions.json(),{profiles:[]});
  const stored=await database.prepare("SELECT value FROM settings WHERE key='app_access_verification'").first();
  assert.ok(stored?.value);
  for(let i=0;i<5;i++){
   const jobs=await runtime.dispatchFetch('https://dropper.test/v1/recording-desktop-job',{method:'POST',headers});
   assert.deepEqual(await jobs.json(),{job:null});
  }
  assert.deepEqual(await database.prepare("SELECT value FROM settings WHERE key='app_access_verification'").first(),stored);
 }finally{await runtime.dispose();}
});

test('accepts UTF-8 app passwords encoded by the Windows client without breaking Bearer access',async()=>{
 const code='Contraseña 🔐 2026';
 assert.equal((await admin(env,'POST','/v1/admin/access',{code})).status,200);
 const encoded=Buffer.from(code,'utf8').toString('base64url');
 assert.equal((await request(env,'GET','/v1/profiles',undefined,{Authorization:'Dropper '+encoded})).status,200);
 assert.equal((await desktop(env,'GET','/v1/profiles')).status,401);
 assert.equal((await request(env,'GET','/v1/profiles',undefined,{Authorization:'Dropper invalid%%'})).status,401);
});


test('desktop update checks return only authenticated profile revision metadata',async()=>{
 const path='/v1/profile-revisions';
 assert.equal((await request(env,'GET',path)).status,401);
 assert.deepEqual(await (await desktop(env,'GET',path)).json(),{profiles:[]});
 const saved=await (await admin(env,'PUT',route,input)).json();
 const {profiles}=await (await desktop(env,'GET',path)).json();
 assert.deepEqual(profiles,[{id:firstId,revision:saved.revision,updated_at:saved.updated_at}]);
});

test('feed check is private and requires the requested model and a saved session',async()=>{
 const path='/v1/admin/recording-session/feed/'+firstId;
 assert.equal((await desktop(env,'POST',path,{})).status,401);
 assert.equal((await admin(env,'POST',path,{})).status,404);
 assert.equal((await admin(env,'PUT',route,input)).status,200);
 const response=await admin(env,'POST',path,{});
 assert.deepEqual(await response.json(),{status:'no_session'});
});

test('admin queues a local Chrome connection and only the claiming app can complete it',async()=>{
 const root='/v1/admin/recording-session';
 const claim='/v1/recording-desktop-job';
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});
 const cookie={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const queued=await request(env,'POST',root+'/connect',{},cookie);
 assert.equal(queued.status,202);
 const {id}=await queued.json();
 assert.equal((await request(env,'POST',claim)).status,401);
 const {job}=await (await desktop(env,'POST',claim)).json();
 assert.deepEqual(job,{id,kind:'connect',claim:job.claim});
 assert.deepEqual(await (await desktop(env,'POST',claim)).json(),{job:null});
 assert.deepEqual(await (await desktop(env,'PUT',claim,{id,claim:'invalid',status:'ready'})).json(),{active:false});
 assert.equal((await (await request(env,'POST',root+'/check',{id},cookie)).json()).status,'running');
 const state={cookies:[{name:'session',domain:'.agencykey.com',value:'test-only'}],origins:[]};
 assert.equal((await desktop(env,'PUT',claim,{id,claim:job.claim,status:'ready',state})).status,200);
 assert.equal((await (await request(env,'POST',root+'/check',{id},cookie)).json()).status,'ready');
 assert.equal((await (await admin(env,'POST',root+'/check',{id})).json()).status,'expired');
 const result=await (await desktop(env,'GET','/v1/recording-session')).json();
 assert.deepEqual(result.state,state);
 assert.equal((await admin(env,'PUT',route,input)).status,200);
 const feed=await (await request(env,'POST',root+'/feed/'+firstId,{},cookie)).json();
 const next=(await (await desktop(env,'POST',claim)).json()).job;
 assert.equal(next.kind,'feed');
 assert.equal(next.creator_id,52);
 assert.equal(next.creator_username,'model_52');
 assert.equal(next.id,feed.id);
 assert.equal((await (await request(env,'POST',root+'/cancel',{id:feed.id},cookie)).json()).status,'cancelled');
 assert.deepEqual(await (await desktop(env,'PUT',claim,{id:feed.id,claim:next.claim})).json(),{active:false});
});

test('persists profile checks across session refreshes and invalidates them when reconnecting', async()=>{
 const root='/v1/admin/recording-session';
 const claim='/v1/recording-desktop-job';
 const state={cookies:[{name:'session',domain:'.agencykey.com',value:'test-only'}],origins:[]};
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});
 const cookie={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const web=async(method,path,data)=>(await request(env,method,path,data,cookie)).json();
 const profiles='/v1/admin/profiles';
 const status=async()=>(await web('GET',profiles)).profiles[0].feed.status;
 const complete=async(path,result)=>{
   const queued=await web('POST',root+path,{});
   const {job}=await (await desktop(env,'POST',claim)).json();
   assert.equal(job.id,queued.id);
   await desktop(env,'PUT',claim,{id:job.id,claim:job.claim,...result});
   return web('POST',root+'/check',{id:job.id});
 };
 await web('PUT',profiles+'/'+firstId,input);
 assert.equal(await status(),'no_session');
 await complete('/connect',{status:'ready',state});
 assert.equal(await status(),'pending');
 assert.equal((await complete('/feed/'+firstId,{status:'ready'})).status,'desktop_update_required');
 assert.equal((await complete('/feed/'+firstId,{status:'feed_unverified',feed_checked:true})).status,'desktop_update_required');
 assert.equal(await status(),'desktop_update_required');
 assert.equal((await complete('/feed/'+firstId,{status:'ready',profile_checked:true})).status,'desktop_update_required');
 const mismatch=await complete('/feed/'+firstId,{status:'ready',identity_checked:true,observed_username:'otra_modelo'});
 assert.equal(mismatch.status,'wrong_profile');
 assert.equal(mismatch.expected_username,'model_52');
 assert.equal(mismatch.observed_username,'otra_modelo');
 assert.equal(await status(),'wrong_profile');
 assert.equal((await complete('/feed/'+firstId,{status:'ready',identity_checked:true})).status,'profile_unverified');
 assert.equal((await complete('/feed/'+firstId,{status:'ready',identity_checked:true,observed_username:'Model_52'})).status,'ready');
 const session=await (await desktop(env,'GET','/v1/recording-session')).json();
 assert.equal((await desktop(env,'PUT','/v1/recording-session',{state,revision:session.revision})).status,200);
 assert.equal(await status(),'ready');
 await complete('/connect',{status:'ready',state});
 assert.equal(await status(),'pending');
});

async function verification(result) {
 await admin(env,'PUT',route,input);
 await saveSharedSession(env,{cookies:[{name:'session',domain:'.agencykey.com',value:'private-session'}],origins:[]},null);
 const queued=await (await admin(env,'POST','/v1/admin/recording-session/feed/'+firstId,{})).json();
 const {job}=await (await desktop(env,'POST','/v1/recording-desktop-job')).json();
 assert.equal(job.id,queued.id);
 if(result)assert.equal((await desktop(env,'PUT','/v1/recording-desktop-job',
  {id:job.id,claim:job.claim,identity_checked:true,...result})).status,200);
 return job;
}

test('web verification persists a private report without exposing it to desktop or mixing app errors',async()=>{
 const job=await verification({status:'profile_unverified',diagnostic:{stage:'Mi perfil',error:'fallo web',
  cookies:[{value:'private-session'}],state:{token:'must-not-export'},
  opened_url:'https://of-52.agencykey.com/model_52?token=private',
  frames:[{frame_index:1,visible:true,identity:[52,'model_52'],cards:[{id:'123',top:215,height:200}],images:[{post_id:'123',loaded:false}]}]}});
 const endpoint='/v1/admin/recording-session/feed/'+firstId;
 assert.equal((await request(env,'GET',endpoint+'/diagnostic')).status,401);
 assert.equal((await desktop(env,'GET',endpoint+'/diagnostic')).status,401);
 const report=await (await admin(env,'GET',endpoint+'/diagnostic?job='+job.id)).json();
 assert.equal(report.source,'web_verification');assert.equal(report.error,'fallo web');assert.equal(report.creator_id,52);
 assert.equal(report.opened_url,'https://of-52.agencykey.com/model_52');assert.equal(report.frames[0].cards[0].id,'123');
 assert.ok(!JSON.stringify(report).includes('private-session'));assert.ok(!JSON.stringify(report).includes('must-not-export'));
 const stored=db.prepare('SELECT value FROM settings WHERE key=?').get('feed_check:'+firstId).value;
 assert.ok(!stored.includes('fallo web'));assert.ok(stored.includes('sealed_diagnostic'));
 const app=await (await desktop(env,'GET','/v1/profiles')).text();assert.ok(!app.includes('diagnostic'));assert.ok(!app.includes('fallo web'));
 const feed=(await (await admin(env,'GET','/v1/admin/profiles')).json()).profiles[0].feed;
 assert.equal(feed.report_id,job.id);assert.equal(feed.status,'profile_unverified');
 const zip=await admin(env,'GET',endpoint+'/report?job='+job.id);
 assert.equal(zip.status,200);assert.equal(zip.headers.get('content-type'),'application/zip');
 assert.match(zip.headers.get('content-disposition'),/verificacion-web-52.zip/);
 const data=new Uint8Array(await zip.arrayBuffer());assert.equal(new DataView(data.buffer).getUint32(0,true),0x04034b50);
 assert.ok(new TextDecoder().decode(data).includes('fallo web'));
 // Reading unrelated desktop state cannot overwrite the web result.
 await desktop(env,'GET','/v1/profile-revisions');
 assert.equal((await (await admin(env,'GET',endpoint+'/diagnostic')).json()).job_id,job.id);
});

test('offline and old-client verifications have web reports without needing app diagnostics',async()=>{
 const job=await verification(null);
 const row=db.prepare('SELECT value FROM settings WHERE key=?').get('recording_desktop_job');
 const expired={...JSON.parse(row.value),expires:Date.now()-1};
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(expired),'recording_desktop_job');
 const endpoint='/v1/admin/recording-session/feed/'+firstId+'/diagnostic';
 const report=await (await admin(env,'GET',endpoint)).json();
 assert.equal(report.status,'expired');assert.equal(report.evidence_available,false);assert.equal(report.job_id,job.id);
 const feed=(await (await admin(env,'GET','/v1/admin/profiles')).json()).profiles[0].feed;
 assert.equal(feed.status,'expired');assert.equal(feed.report_available,true);
 expired.status='queued';db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(expired),'recording_desktop_job');
 assert.equal((await (await admin(env,'GET',endpoint)).json()).status,'desktop_offline');
});

test('reports are invalidated by profile edits, reconnection and a newer verification',async()=>{
 const job=await verification({status:'profile_unverified',diagnostic:{error:'fallo anterior'}});
 const endpoint='/v1/admin/recording-session/feed/'+firstId;
 await admin(env,'POST',endpoint,{});
 assert.equal((await admin(env,'GET',endpoint+'/diagnostic?job='+job.id)).status,409);
 const {job:next}=await (await desktop(env,'POST','/v1/recording-desktop-job')).json();
 await desktop(env,'PUT','/v1/recording-desktop-job',{id:next.id,claim:next.claim,status:'ready',identity_checked:true,observed_username:'model_52'});
 const ready=await (await admin(env,'GET',endpoint+'/diagnostic')).json();
 assert.equal(ready.status,'ready');assert.equal(ready.error,undefined);assert.equal(ready.screenshot,undefined);
 assert.deepEqual(await (await desktop(env,'PUT','/v1/recording-desktop-job',
  {id:job.id,claim:job.claim,status:'connection_error',identity_checked:true,diagnostic:{error:'reporte obsoleto'}})).json(),{active:false});
 assert.equal((await (await admin(env,'GET',endpoint+'/diagnostic')).json()).status,'ready');
 await admin(env,'PUT',route,{...input,revision:1});
 assert.equal((await admin(env,'GET',endpoint+'/diagnostic')).status,409);
 const profileFeed=(await (await admin(env,'GET','/v1/admin/profiles')).json()).profiles[0].feed;
 assert.equal(profileFeed.status,'pending');
});

test('reconnecting AgencyKey invalidates the previous web report',async()=>{
 await verification({status:'profile_unverified',diagnostic:{error:'sesión anterior'}});
 const session=await (await desktop(env,'GET','/v1/recording-session')).json();
 await saveSharedSession(env,session.state,session.revision);
 assert.equal((await admin(env,'GET','/v1/admin/recording-session/feed/'+firstId+'/diagnostic')).status,409);
 assert.equal((await (await admin(env,'GET','/v1/admin/profiles')).json()).profiles[0].feed.status,'pending');
});

test('report sanitizer bounds evidence and discards unsupported image formats and private fields',async()=>{
 const clean=cleanWebDiagnostic({error:'Bearer private',cookies:['secret'],traceback:'x'.repeat(20000),
  frames:Array.from({length:30},()=>({url:'https://app.agencykey.com/models/52?token=private'})),
  screenshot:{mime:'image/svg+xml',data:'<svg onload=alert(1)>'}});
 assert.equal(clean.error,'Bearer [oculto]');assert.equal(clean.traceback.length,12000);assert.equal(clean.frames.length,16);
 assert.equal(clean.cookies,undefined);assert.equal(clean.screenshot,undefined);
 const bytes=new Uint8Array(await reportZip({error:'Prueba ñ',screenshot:{mime:'image/jpeg',data:'/9j/2Q=='}}).arrayBuffer());
 assert.equal(new DataView(bytes.buffer).getUint32(bytes.length-22,true),0x06054b50);
 assert.equal(new DataView(bytes.buffer).getUint16(bytes.length-14,true),2);
});

test('recoverable check survives queue outage, lost start response, lease expiry and duplicate completion',async()=>{
 await admin(env,'PUT',route,input);
 await saveSharedSession(env,{cookies:[{name:'session',domain:'.agencykey.com',value:'test'}],origins:[]},null);
 const root='/v1/admin/recording-session', claim='/v1/recording-desktop-job';
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});
 const cookie={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const start=()=>request(env,'POST',root+'/feed/'+firstId,{request_id:firstId},cookie);
 const first=await (await start()).json();
 let row=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('recording_desktop_job').value);
 row.expires=Date.now()-1;db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(row),'recording_desktop_job');
 const replay=await (await start()).json();assert.equal(replay.id,first.id);assert.equal(replay.status,'queued');
 let {job}=await (await desktop(env,'POST',claim)).json();assert.equal(job.id,first.id);
 assert.equal((await (await desktop(env,'PUT',claim,{...job,phase:'retrying',attempt:3})).json()).active,true);
 const check=await (await request(env,'POST',root+'/check',{id:job.id},cookie)).json();
 assert.equal(check.phase,'retrying');assert.equal(check.attempt,3);
 // A new authenticated admin session can resume a recoverable job after login expires.
 assert.equal((await (await admin(env,'POST',root+'/check',{id:job.id})).json()).status,'running');
 assert.equal((await (await admin(env,'GET',root+'/active')).json()).id,job.id);
 const profiles=await (await request(env,'GET','/v1/admin/profiles',undefined,cookie)).json();
 assert.equal(profiles.profiles[0].feed.id,job.id);
 row=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('recording_desktop_job').value);
 row.expires=Date.now()-1;db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(row),'recording_desktop_job');
 const old=job;({job}=await (await desktop(env,'POST',claim)).json());assert.notEqual(job.claim,old.claim);
 assert.equal((await (await desktop(env,'PUT',claim,{...old,status:'ready',identity_checked:true,observed_username:'model_52'})).json()).active,false);
 const result={...job,status:'ready',identity_checked:true,observed_username:'model_52'};
 await desktop(env,'PUT',claim,result);await desktop(env,'PUT',claim,result);
 assert.equal((await (await start()).json()).status,'ready');
});

test('editing the model cancels the old recoverable check and allows the new model',async()=>{
 await admin(env,'PUT',route,input);
 await saveSharedSession(env,{cookies:[{name:'session',domain:'.agencykey.com',value:'test'}],origins:[]},null);
 const root='/v1/admin/recording-session', claim='/v1/recording-desktop-job';
 const login=await request(env,'POST','/v1/admin/login',{password:env.ADMIN_TOKEN});
 const cookie={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const queued=await (await request(env,'POST',root+'/feed/'+firstId,{request_id:firstId},cookie)).json();
 const {job}=await (await desktop(env,'POST',claim)).json();
 await admin(env,'PUT',route,{creator_id:99,revision:1});
 const next=await request(env,'POST',root+'/feed/'+firstId,{request_id:firstId},cookie);assert.equal(next.status,202);
 assert.notEqual((await next.json()).id,queued.id);
 assert.equal((await (await desktop(env,'PUT',claim,{...job,phase:'retrying'})).json()).active,false);
 const fresh=await (await desktop(env,'POST',claim)).json();assert.equal(fresh.job.creator_id,99);
});

test('retired PC access is rejected and the app password still opens the bot',async()=>{
 const saved=await admin(env,'PUT',route,{...input,telegram_users:['@Editor','editor']});
 assert.equal(saved.status,200,await saved.clone().text());
 const pc='pc_'+firstId+'_'+'x'.repeat(43);
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pc))).toString('base64');
 db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('device:'+firstId,digest);
 assert.equal((await desktop(env,'GET','/v1/profiles',undefined,pc)).status,401);
 assert.equal((await admin(env,'POST',route+'/device',{})).status,404);
 const app=await (await desktop(env,'GET','/v1/profiles')).json();
 assert.deepEqual(app.profiles.map(p=>p.id),[firstId]);
 assert.deepEqual(app.profiles[0].telegram_users,['editor']);
 const creds=await (await desktop(env,'POST',credentials)).json();
 assert.equal(creds.api_key,input.api_key);
 assert.equal(creds.telegram_token,firstToken);
 const html=await (await request(env,'GET','/admin')).text();
 assert.match(html,/Usuarios de Telegram autorizados/);
 assert.doesNotMatch(html,/Clave de AgencyKey de esta PC|Generar acceso de PC/);
});

test('a recoverable verification expires after its maximum lifetime',async()=>{
 await admin(env,'PUT',route,input);
 await saveSharedSession(env,{cookies:[{name:'session',domain:'.agencykey.com',value:'test'}],origins:[]},null);
 const root='/v1/admin/recording-session';
 const first=await (await admin(env,'POST',root+'/feed/'+firstId,{request_id:crypto.randomUUID()})).json();
 const row=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('recording_desktop_job').value);
 row.requested_at=new Date(Date.now()-31*60000).toISOString();
 db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(row),'recording_desktop_job');
 assert.equal((await (await admin(env,'POST',root+'/check',{id:first.id})).json()).status,'desktop_offline');
 assert.equal((await admin(env,'POST',root+'/feed/'+firstId,{request_id:crypto.randomUUID()})).status,202);
});

test('daily summaries group confirmed publications by Drop and model in Caracas time', async()=>{
 const path = '/v1/drop-publications';
 const drop = 'a'.repeat(32), otherDrop = 'b'.repeat(32);
 const beforeMidnight = Date.parse('2026-11-16T03:59:00Z')/1000;
 const afterMidnight = Date.parse('2026-11-16T04:01:00Z')/1000;
 const post = (post_id, options={})=>({post_id, creator_id:52, creator_name:'Modelo A',
   drop_id:drop, position:1, manual:false, confirmed_at:beforeMidnight, ...options});
 const posts = [
  post('101'),
  post('103',{position:3,confirmed_at:afterMidnight}),
  post('104',{position:4,manual:true,confirmed_at:afterMidnight}),
  post('105',{drop_id:otherDrop,confirmed_at:afterMidnight}),
  post('101',{creator_id:99,creator_name:'Modelo B',confirmed_at:afterMidnight}),
 ];
 assert.equal((await request(env,'POST',path,{posts})).status,401);
 assert.equal((await request(env,'GET','/v1/admin/drops')).status,401);
 assert.equal((await desktop(env,'POST',path,{posts:[post('999'),post('invalid')]})).status,400);
 for (let i=0;i<2;i++) assert.equal((await desktop(env,'POST',path,{posts})).status,200);
 const previous = await (await admin(env,'GET','/v1/admin/drops?date=2026-11-15')).json();
 assert.deepEqual(previous.drops.map(d=>[d.creator_id,d.drop_id,d.automatic,d.manual]),[[52,drop,1,0]]);
 const next = await (await admin(env,'GET','/v1/admin/drops?date=2026-11-16')).json();
 assert.deepEqual(next.drops.map(d=>[d.creator_id,d.drop_id,d.automatic,d.manual]),
   [[52,drop,1,1],[52,otherDrop,1,0],[99,drop,1,0]]);
 assert.equal(db.prepare('SELECT COUNT(*) AS count FROM drop_publications').get().count,5);
 assert.equal((await admin(env,'GET','/v1/admin/drops?date=2026-02-30')).status,400);
});

test('only one desktop instance can reserve a bot, with status and daily totals', async () => {
  assert.equal((await admin(env,'PUT',route,input)).status,200);
  const lease='/v1/profiles/'+firstId+'/lease';
  const call=(owner,method,path,body)=>request(env,method,path,body,{
    Authorization:'Bearer '+env.ACCESS_TOKEN,'X-Recorder-Protocol':'2','X-Dropper-Instance':owner.repeat(32),
  });
  const starts=await Promise.all(['a','b'].map(owner=>call(owner,'POST',lease,{revision:1})));
  assert.deepEqual(starts.map(response=>response.status).sort(),[200,409]);
  const owner=starts[0].ok?'a':'b';
  const other=owner==='a'?'b':'a';
  assert.equal((await call(other,'POST',credentials)).status,409);
  assert.equal((await desktop(env,'POST',credentials)).status,409);
  assert.equal((await call(owner,'POST',credentials)).status,200);
  assert.deepEqual((await (await admin(env,'GET','/v1/admin/active-bots')).json()).profiles,[]);
  assert.equal((await call(owner,'PUT',lease,{ready:true})).status,200);
  assert.equal((await (await admin(env,'GET','/v1/admin/active-bots')).json()).profiles[0].id,firstId);

  const today=(await (await admin(env,'GET','/v1/admin/drops')).json()).date;
  const empty=await (await admin(env,'GET','/v1/admin/drops')).json();
  assert.equal(empty.models[0].creator_name,'Lilith');
  assert.deepEqual(empty.drops,[]);
  const posts=[{creator_id:52,creator_name:'Lilith',drop_id:'a'.repeat(32),position:1,
    post_id:'501',confirmed_at:Date.parse(today+'T12:00:00Z')/1000,manual:false}];
  assert.equal((await desktop(env,'POST','/v1/drop-publications',{posts})).status,200);
  const status=await (await call(other,'GET','/v1/profile-revisions')).json();
  assert.equal(status.profiles[0].active_elsewhere,1);
  assert.equal(status.profiles[0].published_today,1);
  assert.equal((await call(other,'DELETE',lease)).status,200);
  assert.equal((await call(other,'POST',lease,{revision:1})).status,409);
  assert.equal((await call(owner,'DELETE',lease)).status,200);
  assert.equal((await call(other,'POST',lease,{revision:1})).status,200);
});

test('HERS Dropper reads the API key stored in Services once the shared backend is enabled', async () => {
  await admin(env,'PUT',route,input);
  let key='shared-service-key';
  env.HERS_AGENCY_KEY={async read(){return key;}};
  assert.equal((await admin(env,'PUT','/v1/admin/agencykey',{api_key:'unused-key'})).status,409);
  assert.equal((await (await desktop(env,'POST',credentials)).json()).api_key,key);
  key=null;
  assert.equal((await desktop(env,'POST',credentials)).status,409);
});
