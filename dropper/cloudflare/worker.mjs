import {adminPage} from './admin-page.mjs';
import {cleanStorageState} from './recording-session.mjs';
import {cleanWebDiagnostic, reportZip} from './web-report.mjs';

const encoder = new TextEncoder();
const columns = 'id, name, bot_id, creator_id, creator_name, creator_username, revision, updated_at';
const needsToken = (row) => row?.encrypted_secrets.startsWith('legacy:');
const verificationLifetime = 30 * 60 * 1000;
const appAccessVerificationLifetime = 24 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=31536000',
  }});
}

async function digest(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

async function equal(provided, expected) {
  return crypto.subtle.timingSafeEqual(await digest(provided), await digest(expected));
}

async function accessHash(env) {
  const source = encode(await digest(env.ACCESS_TOKEN));
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_access'").first();
  if (row) {
    const saved = JSON.parse(row.value);
    if (saved.source === source) return saved.hash;
  }
  return source;
}

function appAccessVerificationId(access, expires) {
  return JSON.stringify(['app_access_verification', access, expires]);
}

async function verifyAppAccess(provided, saved, row, env) {
  const fingerprint = encode(await digest(provided));
  if (row.verification) {
    try {
      const {expires, encrypted} = JSON.parse(row.verification);
      if (Number.isSafeInteger(expires) && expires > Date.now()) {
        // Authenticate the expiry and the exact password record along with the verifier.
        const {verified} = await decrypt(encrypted, appAccessVerificationId(row.value, expires), env);
        return await equal(fingerprint, verified);
      }
    } catch {
      // A damaged entry or a rotated key requires the original password check.
    }
  }
  if (!await equal(await passwordHash(provided, saved.salt), saved.hash)) return false;
  try {
    const expires = Date.now() + appAccessVerificationLifetime;
    const encrypted = await encrypt({verified:fingerprint}, appAccessVerificationId(row.value, expires), env);
    // A request that started before password rotation must not replace the new entry.
    await env.DB.prepare(`INSERT INTO settings(key, value)
      SELECT 'app_access_verification', ? WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'app_access' AND value = ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({expires, encrypted}), row.value).run();
  } catch {
    console.error(JSON.stringify({event:'app_access_verification_write_failed'}));
  }
  return true;
}

async function authorize(request, env) {
  if (!env.ACCESS_TOKEN || !env.ENCRYPTION_KEY) throw new ApiError(503, 'Servicio sin configurar');
  const value = request.headers.get('Authorization') || '';
  let provided = value.startsWith('Bearer ') ? value.slice(7, 520) : '';
  if (value.startsWith('Dropper ')) {
    try {
      const encoded = value.slice(8);
      if (encoded.length>2048 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
      provided = new TextDecoder('utf-8',{fatal:true}).decode(fromBase64url(encoded));
    } catch {throw new ApiError(401,'Contraseña incorrecta o cambiada');}
  }
  if (/^pc_[a-f0-9-]{36}_[A-Za-z0-9_-]{43}$/.test(provided))
    throw new ApiError(401, 'Usa la contraseña general de la app');
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attemptId = 'app:' + encode(await digest(ip));
  const blocked = await env.DB.prepare('SELECT attempts, expires FROM login_attempts WHERE id = ?').bind(attemptId).first();
  if (blocked?.expires > Date.now() && blocked.attempts >= 10) throw new ApiError(429, 'Demasiados intentos, espera 15 minutos');
  const row = await env.DB.prepare(`SELECT value,
    (SELECT value FROM settings WHERE key = 'app_access_verification') AS verification
    FROM settings WHERE key = 'app_access'`).first();
  const saved = row ? JSON.parse(row.value) : null;
  const source = encode(await digest(env.ACCESS_TOKEN));
  let valid;
  if (saved?.source === source && saved.kind === 'pbkdf2') {
    valid = await verifyAppAccess(provided, saved, row, env);
  } else {
    valid = await equal(encode(await digest(provided)), saved?.source === source ? saved.hash : source);
  }
  if (!valid) {
    const now = Date.now();
    const attempts = await env.DB.prepare(`INSERT INTO login_attempts(id, attempts, expires) VALUES (?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET attempts = CASE WHEN expires < ? THEN 1 ELSE attempts+1 END,
      expires = CASE WHEN expires < ? THEN excluded.expires ELSE expires END RETURNING attempts`).bind(attemptId, now+900000, now, now).first();
    throw new ApiError(attempts.attempts > 10 ? 429 : 401, attempts.attempts > 10 ? 'Demasiados intentos, espera 15 minutos' : 'Contraseña incorrecta o cambiada');
  }
}

async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return encode(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:decode(salt), iterations:100000}, material, 256));
}

async function key(env) {
  const raw = Uint8Array.from(atob(env.ENCRYPTION_KEY), char => char.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function encode(bytes) {
  const data = new Uint8Array(bytes);
  let result = '';
  for (let i=0; i<data.length; i+=8192) result += String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(result);
}

function decode(text) {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

async function encrypt(value, id, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv, additionalData: encoder.encode(id)}, await key(env), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({v: 1, iv: encode(iv), ciphertext: encode(ciphertext)});
}

async function decrypt(value, id, env) {
  const data = JSON.parse(value);
  if (data.v !== 1) throw new Error('Unsupported secret format');
  const plaintext = await crypto.subtle.decrypt(
    {name: 'AES-GCM', iv: decode(data.iv), additionalData: encoder.encode(id)}, await key(env), decode(data.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function body(request, maximum=16384) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Configuración vacía');
  let size = 0;
  const chunks = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ApiError(413, 'Configuración demasiado grande');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {throw new ApiError(400, 'Configuración inválida');}
}

function text(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n\x00]/.test(value)) {
    throw new ApiError(400, `${name} inválido`);
  }
  return value.trim();
}

function telegramUsers(value) {
  if (!Array.isArray(value) || value.length > 50 ||
      value.some(name => typeof name !== 'string' || !/^@?[a-zA-Z0-9_]{5,32}$/.test(name.trim()))) {
    throw new ApiError(400, 'Indica hasta 50 nombres de usuario de Telegram válidos');
  }
  return [...new Set(value.map(name => name.trim().replace(/^@/, '').toLowerCase()))];
}

function profile(row) {
  return {
    id: row.id, name: row.name, bot_id: row.bot_id,
    creator: {external_id: row.creator_id, name: row.creator_name, username: row.creator_username},
    revision: row.revision, updated_at: row.updated_at,
  };
}

function base64url(bytes) {
  return encode(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64url(value) {
  const str = value.replaceAll('-', '+').replaceAll('_', '/');
  return decode(str + '='.repeat((4-str.length%4)%4));
}

function originCheck(request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) throw new ApiError(403, 'Solicitud de otro origen bloqueada');
}

async function adminState(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_access'").first();
  if (row) return JSON.parse(row.value);
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) throw new ApiError(503, 'Acceso de administrador sin configurar');
  return {version:encode(await digest(env.ADMIN_TOKEN)), setup_used:false};
}

function sessionToken(request) {
  const cookie = (request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-recorder_admin='));
  const token = cookie?.slice('__Host-recorder_admin='.length);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

async function sessionId(token) {
  return 'admin_session:'+encode(await digest(token));
}

async function authorizeAdmin(request, env) {
  const token = sessionToken(request);
  if (!token) throw new ApiError(401, 'Introduce la contraseña de administrador');
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(await sessionId(token)).first();
  if (!row) throw new ApiError(401, 'Vuelve a iniciar sesión');
  const session = JSON.parse(row.value);
  if (session.expires <= Date.now() || session.version !== (await adminState(env)).version) throw new ApiError(401, 'La sesión caducó. Vuelve a entrar');
}

async function issueSession(env) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const state = await adminState(env);
  await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'admin_session:%' AND CAST(json_extract(value,'$.expires') AS INTEGER) < ?").bind(now).run();
  await env.DB.prepare('INSERT INTO settings(key,value) VALUES (?,?)').bind(await sessionId(token),JSON.stringify({expires:now+28800000,version:state.version})).run();
  const response = json({authenticated:true});
  response.headers.set('Set-Cookie',`__Host-recorder_admin=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict`);
  return response;
}

async function loginLimit(request,env) {
  const id = 'admin:'+encode(await digest(request.headers.get('CF-Connecting-IP') || 'unknown'));
  const now = Date.now();
  const attempts = await env.DB.prepare(`INSERT INTO login_attempts(id, attempts, expires) VALUES (?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET attempts = CASE WHEN expires < ? THEN 1 ELSE attempts+1 END,
    expires = CASE WHEN expires < ? THEN excluded.expires ELSE expires END RETURNING attempts`).bind(id,now+900000,now,now).first();
  if (attempts.attempts > 10) throw new ApiError(429,'Demasiados intentos, espera 15 minutos');
  return id;
}

async function matchesAdmin(password,env) {
  const state = await adminState(env);
  return state.hash ? equal(await passwordHash(password,state.salt),state.hash) : equal(password,env.ADMIN_TOKEN);
}

async function matchesApp(password,env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_access'").first();
  const saved = row ? JSON.parse(row.value) : null;
  const source = encode(await digest(env.ACCESS_TOKEN));
  return saved?.source===source && saved.kind==='pbkdf2' ? equal(await passwordHash(password,saved.salt),saved.hash) : equal(encode(await digest(password)),await accessHash(env));
}

async function newAdminPassword(password,env) {
  if (typeof password!=='string' || password.length<12 || password.length>256 || /[\r\n\x00]/.test(password)) throw new ApiError(400,'Usa una contraseña de entre 12 y 256 caracteres');
  if (await matchesApp(password,env)) throw new ApiError(400,'Usa una contraseña distinta de la contraseña de las apps');
  const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
  return {salt,hash:await passwordHash(password,salt),version:crypto.randomUUID(),setup_used:true};
}

async function adminLogin(request,env,setup=false) {
  originCheck(request);
  const attempt = await loginLimit(request,env);
  const input = await body(request);
  if (setup) {
    let config;
    try {config=JSON.parse(env.ADMIN_SETUP || '{}');} catch {config={};}
    if (typeof input.token!=='string' || !config.token || !(config.expires > Date.now()) || !await equal(input.token,config.token)) throw new ApiError(403,'El enlace de configuración no es válido o caducó');
    const state = await newAdminPassword(input.password,env);
    const result = await env.DB.prepare(`INSERT INTO settings(key,value) VALUES ('admin_access',?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.setup_used') IS NOT 1 RETURNING key`).bind(JSON.stringify(state)).first();
    if (!result) throw new ApiError(409,'La contraseña ya fue creada. Entra con ella');
  } else {
    if (typeof input.password!=='string' || input.password.length>256 || !await matchesAdmin(input.password,env)) throw new ApiError(401,'Contraseña de administrador incorrecta');
    if (await matchesApp(input.password,env)) throw new ApiError(403,'Configura una contraseña de administrador distinta de la de las apps');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE id = ?').bind(attempt).run();
  return issueSession(env);
}

async function globalApi(env) {
  const saved = await env.DB.prepare("SELECT value FROM settings WHERE key = 'agencykey'").first();
  if (saved) return (await decrypt(saved.value, 'agencykey', env)).api_key;
  const rows = await env.DB.prepare("SELECT id, encrypted_secrets FROM profiles WHERE encrypted_secrets NOT LIKE 'legacy:%'").all();
  const keys = new Set();
  for (const row of rows.results) keys.add((await decrypt(row.encrypted_secrets, row.id, env)).api_key);
  if (keys.size !== 1) throw new ApiError(409, 'Configura la API de AgencyKey para los bots en Conectores');
  const apiKey = [...keys][0];
  const value = await encrypt({api_key:apiKey}, 'agencykey', env);
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES ('agencykey',?) ON CONFLICT(key) DO NOTHING").bind(value).run();
  return apiKey;
}

async function upstreamJson(url, headers, service) {
  let response;
  try {response = await fetch(url, {headers, signal: AbortSignal.timeout(20000), redirect: 'manual'});}
  catch {throw new ApiError(502, `No se pudo conectar con ${service}`);}
  if (response.status >= 300 && response.status < 400) {
    throw new ApiError(502, `${service} devolvió una redirección inesperada`);
  }
  if (!response.ok) {
    if ([401,403].includes(response.status)) throw new ApiError(400, `Revisa las credenciales y permisos de ${service}`);
    throw new ApiError(502, `${service} respondió HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 1048576) {await reader.cancel(); throw new ApiError(502, `Respuesta demasiado grande de ${service}`);}
    chunks.push(next.value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.length;}
  try {return JSON.parse(new TextDecoder().decode(data));}
  catch {throw new ApiError(502, `Respuesta inválida de ${service}`);}
}

function creatorId(value) {
  if (!/^[1-9][0-9]{0,15}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new ApiError(400, 'Introduce el ID numérico de OnlyFans de la modelo');
  }
  return Number(value);
}

async function listCreators(apiKey) {
  const creators = [];
  for (let page=1; page<=100; page++) {
    const data = await upstreamJson(`https://app.agencykey.com/api/v1/onlyfans/creators?page=${page}&limit=100`,
      {'x-public-api-key':apiKey, 'Accept':'application/json'}, 'AgencyKey');
    if (!Array.isArray(data.data)) throw new ApiError(502, 'No se pudo leer la lista de modelos');
    for (const item of data.data) {
      const account = item?.account;
      if (!account?.username || !Number.isSafeInteger(Number(account.externalId))) continue;
      // The CRM label (item.name) can be edited; use the OnlyFans username.
      creators.push({external_id:creatorId(account.externalId), name:'@'+account.username, username:account.username});
    }
    const pages = data.pagination?.pages ?? 1;
    if (!Number.isSafeInteger(pages) || pages < 1) throw new ApiError(502, 'Paginación inválida de AgencyKey');
    if (page >= pages) return creators;
  }
  throw new ApiError(502, 'La lista de modelos está incompleta');
}

async function resolveCreator(apiKey, id) {
  const creator = (await listCreators(apiKey)).find(x=>x.external_id===id);
  if (!creator) throw new ApiError(400, 'La modelo no está disponible para la API de AgencyKey');
  try {
    const data = await upstreamJson(`https://app.agencykey.com/api/v1/onlyfans/${id}/api2/v2/users/me`,
      {'x-public-api-key':apiKey, 'Accept':'application/json'}, 'OnlyFans');
    if (Number(data.id)!==id) throw new ApiError(502, 'OnlyFans devolvió otra modelo');
    return {external_id:id, name:text(data.name, 'Nombre de OnlyFans',120), username:text(data.username, 'Usuario de OnlyFans',120)};
  } catch (error) {
    // Some AgencyKey accounts cannot proxy users/me. The canonical username
    // remains authoritative; an editable CRM alias must never replace it.
    if (error instanceof ApiError && error.status===502 && error.message==='OnlyFans respondió HTTP 400') return creator;
    throw error;
  }
}

async function verifyBot(token) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token)) throw new ApiError(400, 'Token de Telegram inválido');
  return token.split(':')[0];
}

async function listAdminProfiles(env) {
  const session = await sharedSession(env);
  const latest = (await readDesktopJob(env))?.job;
  const result = await env.DB.prepare(`SELECT p.*, s.value AS feed_result
    FROM profiles p LEFT JOIN settings s ON s.key = 'feed_check:' || p.id
    ORDER BY p.name COLLATE NOCASE`).all();
  return json({profiles: await Promise.all(result.results.map(async row => {
    if (needsToken(row)) return {...profile(row), needs_token:true, feed:{status:'token_required'}};
    const stored = row.feed_result && JSON.parse(row.feed_result);
    const check = latest?.kind==='feed' && latest.profile_id===row.id && latest.creator_id===row.creator_id
      && latest.creator_username===row.creator_username && latest.profile_revision===row.revision
      && latest.connection===session.connection ? latest : stored;
    const feed = session.configured && check?.creator_id === row.creator_id && check.connection === session.connection
      && (check===latest || check.identity_checked === true) && check.creator_username === row.creator_username
      && check.profile_revision === row.revision
      ? profileCheckResult(check, jobStatus(check))
      : {status:session.configured?'pending':'no_session'};
    const secrets = await decrypt(row.encrypted_secrets, row.id, env);
    return {...profile(row), feed, telegram_users:secrets.telegram_users ?? []};
  })), recording_session:session});
}

async function listProfiles(env) {
  const {results} = await env.DB.prepare(`SELECT ${columns}, encrypted_secrets FROM profiles WHERE encrypted_secrets NOT LIKE 'legacy:%' ORDER BY name COLLATE NOCASE`).all();
  const profiles = await Promise.all(results.map(async row => ({
    ...profile(row), telegram_users:(await decrypt(row.encrypted_secrets,row.id,env)).telegram_users ?? [],
  })));
  return json({profiles, recording_session:await sharedSession(env)});
}

const sessionKey = 'recording_session';
const desktopJobKey = 'recording_desktop_job';

export async function sharedSession(env, includeState=false) {
  const key = sessionKey;
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!row) return {configured:false, revision:null};
  const value = JSON.parse(row.value);
  return {configured:true, revision:value.revision, updated_at:value.updated_at, connection:value.connection ?? value.revision,
    ...(includeState ? {state:await decrypt(value.sealed,key,env)} : {})};
}

export async function saveSharedSession(env, state, revision, connection=crypto.randomUUID()) {
  const key = sessionKey;
  try {state=cleanStorageState(state);} catch {throw new ApiError(400,'Sesión de AgencyKey inválida');}
  const value={revision:crypto.randomUUID(),connection,updated_at:new Date().toISOString(),sealed:await encrypt(state,key,env)};
  const saved=await env.DB.prepare(`INSERT INTO settings(key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(settings.value,'$.revision') = ? RETURNING key`)
    .bind(key,JSON.stringify(value),revision).first();
  if (!saved) throw new ApiError(409,'La sesión compartida cambió. Actualiza antes de volver a conectar');
  return {configured:true,revision:value.revision,updated_at:value.updated_at};
}

function profileCheckResult(job, status) {
  return {status, checked_at:job.checked_at, expected_username:job.creator_username, observed_username:job.observed_username,
    ...(['queued','running','finishing'].includes(status) ? {id:job.id,phase:job.phase,attempt:job.attempt} : {}),
    ...(job.kind==='feed' && job.id && !['queued','running','finishing'].includes(status)
      ? {report_id:job.id,report_available:true} : {})};
}

async function webVerificationReport(request, env, profileId, download) {
  const profile = await env.DB.prepare('SELECT creator_id, creator_username, revision FROM profiles WHERE id = ?').bind(profileId).first();
  if (!profile) throw new ApiError(404,'La configuración de la modelo ya no existe');
  const session = await sharedSession(env);
  const current = await readDesktopJob(env);
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('feed_check:'+profileId).first();
  const saved = row ? JSON.parse(row.value) : null;
  const matches = job => job?.kind==='feed' && job.profile_id===profileId && job.creator_id===profile.creator_id
    && job.creator_username===profile.creator_username && job.profile_revision===profile.revision && job.connection===session.connection;
  const job = matches(current?.job) ? current.job : matches(saved) ? saved : null;
  const requested = new URL(request.url).searchParams.get('job');
  if (!job || !session.configured || (requested && job.id!==requested)) throw new ApiError(409,'La verificación cambió. Actualiza la lista y vuelve a consultar el detalle');
  const status = jobStatus(job);
  if (['queued','running','finishing'].includes(status)) throw new ApiError(409,'La verificación sigue en curso');
  let diagnostic = null;
  if (saved?.id===job.id && saved.sealed_diagnostic) diagnostic = await decrypt(saved.sealed_diagnostic,'web_report:'+profileId,env);
  const report = {...(diagnostic||{}),source:'web_verification',schema:1,job_id:job.id,profile_id:profileId,
    creator_id:profile.creator_id,expected_username:profile.creator_username,observed_username:job.observed_username||null,
    status,checked_at:job.checked_at||null,requested_at:job.requested_at||null,
    stage:diagnostic?.stage || 'verificación manual desde la web',
    evidence_available:Boolean(diagnostic),
    ...(!diagnostic ? {screenshot_omitted:'no_browser_evidence'} : {})};
  if (!download) return json(report);
  return new Response(reportZip(report),{headers:{'Content-Type':'application/zip',
    'Content-Disposition':`attachment; filename="verificacion-web-${profile.creator_id}.zip"`,
    'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}});
}

function normalizedUsername(value) {
  const username = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  return /^[a-z0-9_]{1,64}$/.test(username) ? username : null;
}

const desktopResults = new Set(['ready','login_required','unavailable','profile_menu_missing','wrong_profile','profile_not_visible','feed_unverified','profile_unverified','connection_error','cancelled']);

async function readDesktopJob(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(desktopJobKey).first();
  return row ? {raw:row.value, job:JSON.parse(row.value)} : null;
}

async function replaceDesktopJob(env, entry, job) {
  const value = JSON.stringify(job);
  const result = entry
    ? await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING key')
      .bind(value,desktopJobKey,entry.raw).first()
    : await env.DB.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO NOTHING RETURNING key')
      .bind(desktopJobKey,value).first();
  return Boolean(result);
}

function jobStatus(job) {
  if (job.recover && ['queued','running'].includes(job.status)) {
    if (Date.parse(job.requested_at) + verificationLifetime <= Date.now())
      return job.status==='queued' ? 'desktop_offline' : 'expired';
    return job.status;
  }
  if (job.expires<=Date.now() && ['queued','running','finishing'].includes(job.status)) {
    return job.status==='queued' ? 'desktop_offline' : 'expired';
  }
  return job.status;
}

async function recordingAdmin(request, env, path, hersOwner) {
  const root='/v1/admin/recording-session';
  if (path===root && request.method==='GET') return json(await sharedSession(env));
  const report = path.match(/^\/v1\/admin\/recording-session\/feed\/([a-f0-9-]{36})\/(diagnostic|report)$/);
  if (report && request.method==='GET') return webVerificationReport(request,env,report[1],report[2]==='report');
  const owner=hersOwner ?? await sessionId(sessionToken(request));
  let entry=await readDesktopJob(env);
  if (path===root+'/active' && request.method==='GET') {
    if (!entry || (entry.job.owner!==owner && !entry.job.recover)) return json({status:'none'});
    return json({kind:entry.job.kind,profile_id:entry.job.profile_id,...profileCheckResult(entry.job,jobStatus(entry.job))});
  }
  const feed=path.match(/^\/v1\/admin\/recording-session\/feed\/([a-f0-9-]{36})$/);
  const connect=path===root+'/connect';
  if (request.method==='POST' && (connect || feed)) {
    const input=await body(request);
    const requestId=typeof input.request_id==='string' && /^[a-f0-9-]{36}$/.test(input.request_id) ? input.request_id : null;
    const profile=feed
      ? await env.DB.prepare('SELECT creator_id, creator_username, revision FROM profiles WHERE id = ?').bind(feed[1]).first()
      : null;
    if (feed && !profile) throw new ApiError(404,'La configuración de la modelo ya no existe');
    const session=await sharedSession(env);
    if (requestId && entry?.job.request_id===requestId && (entry.job.owner===owner || entry.job.recover)
        && entry.job.kind===(connect?'connect':'feed') && (!feed || (entry.job.profile_id===feed[1]
          && entry.job.profile_revision===profile.revision && entry.job.creator_id===profile.creator_id
          && entry.job.connection===session.connection))) {
      return json({id:entry.job.id,...profileCheckResult(entry.job,jobStatus(entry.job))});
    }
    if (entry?.job.kind==='feed' && ['queued','running'].includes(jobStatus(entry.job))) {
      const current=await env.DB.prepare('SELECT creator_id, creator_username, revision FROM profiles WHERE id = ?').bind(entry.job.profile_id).first();
      if (!current || current.revision!==entry.job.profile_revision || current.creator_id!==entry.job.creator_id
          || entry.job.connection!==session.connection) {
        await replaceDesktopJob(env,entry,{...entry.job,status:'cancelled'});
        entry=await readDesktopJob(env);
      }
    }
    if (entry && ['queued','running','finishing'].includes(jobStatus(entry.job))) {
      throw new ApiError(409,'Ya hay una solicitud de Chrome en curso');
    }
    if (feed && !session.configured) return json({status:'no_session'});
    const job={id:crypto.randomUUID(),owner,request_id:requestId,recover:Boolean(requestId),kind:connect?'connect':'feed',
      ...(profile?{profile_id:feed[1],creator_id:profile.creator_id,creator_username:profile.creator_username,
        profile_revision:profile.revision,connection:session.connection}:{}),revision:session.revision,
      requested_at:new Date().toISOString(),status:'queued',expires:Date.now()+45000};
    if (!await replaceDesktopJob(env,entry,job)) throw new ApiError(409,'Ya hay una solicitud de Chrome en curso');
    return json({id:job.id,status:job.status},202);
  }
  if (request.method==='POST' && [root+'/check',root+'/cancel'].includes(path)) {
    const {id}=await body(request);
    if (!entry || entry.job.id!==id || (entry.job.owner!==owner && !entry.job.recover)) return json({status:'expired'});
    const status=jobStatus(entry.job);
    if (path.endsWith('/cancel') && ['queued','running'].includes(status)) {
      const cancelled=await replaceDesktopJob(env,entry,{...entry.job,status:'cancelled'});
      return json({status:cancelled?'cancelled':'finishing'});
    }
    return json(profileCheckResult(entry.job, status));
  }
  throw new ApiError(405,'Método no permitido');
}

async function desktopRecordingJob(request,env) {
  const entry=await readDesktopJob(env);
  if (request.method==='POST') {
    if (!entry || !(jobStatus(entry.job)==='queued' ||
        (entry.job.recover && jobStatus(entry.job)==='running' && entry.job.expires<=Date.now()))) return json({job:null});
    const job={...entry.job,status:'running',claim:crypto.randomUUID(),expires:Date.now()+300000};
    if (!await replaceDesktopJob(env,entry,job)) return json({job:null});
    const {id,claim,kind,creator_id,creator_username}=job;
    return json({job:{id,claim,kind,creator_id,creator_username}});
  }
  if (request.method!=='PUT') throw new ApiError(405,'Método no permitido');
  const input=await body(request,524288);
  if (!entry || entry.job.id!==input.id || entry.job.claim!==input.claim || jobStatus(entry.job)!=='running') {
    return json({active:false});
  }
  if (entry.job.kind==='feed') {
    const current=await env.DB.prepare('SELECT creator_id, creator_username, revision FROM profiles WHERE id = ?').bind(entry.job.profile_id).first();
    const session=await sharedSession(env);
    if (!current || current.revision!==entry.job.profile_revision || current.creator_id!==entry.job.creator_id
        || session.connection!==entry.job.connection) {
      await replaceDesktopJob(env,entry,{...entry.job,status:'cancelled'});
      return json({active:false});
    }
  }
  if (!input.status) {
    const heartbeat={...entry.job,expires:Date.now()+300000,
      phase:['opening','retrying','saving'].includes(input.phase)?input.phase:entry.job.phase,
      attempt:Number.isSafeInteger(input.attempt)?Math.max(1,Math.min(input.attempt,1000000)):entry.job.attempt};
    return json({active:await replaceDesktopJob(env,entry,heartbeat)});
  }
  if (!desktopResults.has(input.status)) throw new ApiError(400,'Resultado de Chrome inválido');
  const job={...entry.job,status:input.status,checked_at:new Date().toISOString()};
  if (job.kind==='connect' && input.status==='ready') {
    const finishing={...entry.job,status:'finishing',expires:Date.now()+30000};
    if (!await replaceDesktopJob(env,entry,finishing)) return json({active:false});
    try {await saveSharedSession(env,input.state,job.revision);}
    catch {job.status='connection_error';}
    await replaceDesktopJob(env,{raw:JSON.stringify(finishing)},job);
  } else if (job.kind === 'feed' && job.profile_id) {
    if (input.identity_checked !== true && job.status !== 'cancelled') job.status = 'desktop_update_required';
    job.observed_username = normalizedUsername(input.observed_username);
    if (job.status === 'ready') {
      const expected = normalizedUsername(job.creator_username);
      if (!expected || !job.observed_username) job.status = 'profile_unverified';
      else if (job.observed_username !== expected) job.status = 'wrong_profile';
    }
    const diagnostic = job.status!=='ready' ? cleanWebDiagnostic(input.diagnostic) : null;
    const check = {id:job.id,kind:'feed',profile_id:job.profile_id,profile_revision:job.profile_revision,
      identity_checked:true, creator_id:job.creator_id, creator_username:job.creator_username,
      observed_username:job.observed_username, connection:job.connection, status:job.status, checked_at:job.checked_at};
    if (diagnostic) check.sealed_diagnostic=await encrypt(diagnostic,'web_report:'+job.profile_id,env);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO settings(key,value)
        SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key = ? AND value = ?)
        AND EXISTS (SELECT 1 FROM profiles WHERE id = ? AND creator_id = ? AND creator_username IS ? AND revision = ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
        .bind('feed_check:'+job.profile_id,JSON.stringify(check),desktopJobKey,entry.raw,job.profile_id,job.creator_id,job.creator_username ?? null,job.profile_revision),
      env.DB.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?')
        .bind(JSON.stringify(job),desktopJobKey,entry.raw),
    ]);
  } else if (!await replaceDesktopJob(env,entry,job)) {
    return json({active:false});
  }
  return json({active:false});
}

const caracasDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'America/Caracas', year:'numeric', month:'2-digit', day:'2-digit',
});

async function reportDropPublications(request, env) {
  const input = await body(request, 32768);
  if (!Array.isArray(input?.posts) || input.posts.length < 1 || input.posts.length > 50)
    throw new ApiError(400, 'Envía entre 1 y 50 publicaciones');
  const latest = Math.floor(Date.now()/1000) + 86400;
  const statements = input.posts.map(post => {
    if (!post || typeof post.drop_id !== 'string' || !/^[a-f0-9]{32}$/.test(post.drop_id) ||
        typeof post.post_id !== 'string' || !/^[1-9][0-9]{0,24}$/.test(post.post_id) ||
        typeof post.creator_name !== 'string' || !post.creator_name.trim() || post.creator_name.length > 256 ||
        !Number.isSafeInteger(post.position) || post.position < 1 ||
        typeof post.manual !== 'boolean' || !Number.isSafeInteger(post.confirmed_at) ||
        post.confirmed_at < 0 || post.confirmed_at > latest)
      throw new ApiError(400, 'Publicación inválida');
    const id = creatorId(post.creator_id);
    const day = caracasDate.format(new Date(post.confirmed_at*1000));
    return env.DB.prepare(`INSERT INTO drop_publications
      (creator_id, creator_name, drop_id, position, post_id, manual, confirmed_at, local_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(id,post.creator_name.trim(),post.drop_id,post.position,post.post_id,
            Number(post.manual),post.confirmed_at,day);
  });
  await env.DB.batch(statements);
  return json({accepted:true});
}

async function dailyDrops(request, env) {
  const today = caracasDate.format(new Date());
  const day = new URL(request.url).searchParams.get('date') ?? today;
  const date = new Date(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0,10) !== day)
    throw new ApiError(400, 'Introduce una fecha válida');
  const {results} = await env.DB.prepare(`SELECT d.creator_id,
    COALESCE(p.creator_name, MAX(d.creator_name)) AS creator_name, d.drop_id,
    SUM(1 - d.manual) AS automatic, SUM(d.manual) AS manual, MAX(d.confirmed_at) AS last_at
    FROM drop_publications d LEFT JOIN profiles p ON p.creator_id = d.creator_id
    WHERE d.local_date = ? GROUP BY d.creator_id, d.drop_id
    ORDER BY creator_name COLLATE NOCASE, d.creator_id, last_at DESC, d.drop_id`).bind(day).all();
  return json({date:day,today,drops:results});
}

async function adminHandle(request, env, path, hersOwner) {
  if (!hersOwner) {
    if (path === '/v1/admin/login' && request.method === 'POST') return adminLogin(request,env);
    if (path === '/v1/admin/setup' && request.method === 'POST') return adminLogin(request,env,true);
    await authorizeAdmin(request, env);
  }
  if (request.method !== 'GET') originCheck(request);
  if (path === '/v1/admin/drops' && request.method === 'GET') return dailyDrops(request,env);
  if (path.startsWith('/v1/admin/recording-session')) return recordingAdmin(request,env,path,hersOwner);
  if (path === '/v1/admin/logout' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(await sessionId(sessionToken(request))).run();
    const response=json({authenticated:false});
    response.headers.set('Set-Cookie','__Host-recorder_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    return response;
  }
  if (path === '/v1/admin/password' && request.method === 'PUT') {
    const input=await body(request);
    if (typeof input.current_password!=='string' || !await matchesAdmin(input.current_password,env)) throw new ApiError(400,'La contraseña actual es incorrecta');
    const state=await newAdminPassword(input.password,env);
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES ('admin_access',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(state)).run();
    return issueSession(env);
  }
  if (path === '/v1/admin/session' && request.method === 'GET') return json({authenticated: true});
  if (path === '/v1/admin/settings' && request.method === 'GET') {
    let configured = false;
    try {await globalApi(env); configured = true;} catch (error) {if (!(error instanceof ApiError) || error.status!==409) throw error;}
    return json({api_configured:configured});
  }
  if (path === '/v1/admin/agencykey' && request.method === 'PUT') {
    const input = await body(request);
    const apiKey = text(input.api_key, 'API de AgencyKey',512);
    const creators = await listCreators(apiKey);
    const value = await encrypt({api_key:apiKey}, 'agencykey',env);
    await env.DB.prepare("INSERT INTO settings(key,value) VALUES ('agencykey',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(value).run();
    return json({configured:true,creators});
  }
  if (path === '/v1/admin/creators' && request.method === 'GET') return json({creators:await listCreators(await globalApi(env))});
  if (path === '/v1/admin/access' && request.method === 'POST') {
    const input = await body(request);
    const code = input.code ? text(input.code, 'Código', 256) : base64url(crypto.getRandomValues(new Uint8Array(32)));
    if (code.length < 8) throw new ApiError(400, 'Usa una contraseña de al menos 8 caracteres');
    if (await matchesAdmin(code,env)) throw new ApiError(400,'Usa una contraseña distinta de la contraseña de administrador');
    const salt = encode(crypto.getRandomValues(new Uint8Array(16)));
    const value = JSON.stringify({kind:'pbkdf2', source:encode(await digest(env.ACCESS_TOKEN)), salt, hash:await passwordHash(code,salt)});
    await env.DB.prepare("INSERT INTO settings(key, value) VALUES ('app_access', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(value).run();
    return json({code});
  }
  if (path === '/v1/admin/profiles' && request.method === 'GET') return listAdminProfiles(env);
  if (path === '/v1/admin/active-bots' && request.method === 'GET') {
    const {results} = await env.DB.prepare(`SELECT p.* FROM profiles p JOIN bot_activity a ON
      a.profile_id = p.id AND a.revision = p.revision WHERE a.last_seen > ?
      ORDER BY p.name COLLATE NOCASE`).bind(Date.now() - 90_000).all();
    return json({profiles: results.map(profile)});
  }
  if (path === '/v1/admin/resolve' && request.method === 'POST') {
    const input = await body(request);
    const id = creatorId(input.creator_id);
    const apiKey = await globalApi(env);
    return json({creator: await resolveCreator(apiKey, id)});
  }
  const match = path.match(/^\/v1\/admin\/profiles\/([a-f0-9-]{36})$/);
  if (!match) throw new ApiError(404, 'Recurso no encontrado');
  const id = match[1];
  if (request.method === 'DELETE') {
    const revision = Number(request.headers.get('If-Match'));
    if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError(400, 'Versión inválida');
    const result = await env.DB.prepare('DELETE FROM profiles WHERE id = ? AND revision = ?').bind(id, revision).run();
    if (!result.meta.changes) throw new ApiError(409, 'La configuración cambió, actualiza la lista');
    return json({deleted: id});
  }
  if (request.method !== 'PUT') throw new ApiError(405, 'Método no permitido');
  const input = await body(request);
  const revision = input.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new ApiError(400, 'Versión inválida');
  const existing = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first();
  if ((existing?.revision || 0) !== revision) throw new ApiError(409, 'La configuración cambió, actualiza la lista');
  const previous = existing && !needsToken(existing) ? await decrypt(existing.encrypted_secrets, id, env) : {};
  const apiKey = await globalApi(env);
  const token = text(input.telegram_token || previous.telegram_token, 'Token de Telegram', 256);
  const modelId = creatorId(input.creator_id);
  const [creator, botId] = await Promise.all([resolveCreator(apiKey, modelId), verifyBot(token)]);
  const telegram_users = input.telegram_users === undefined ? (previous.telegram_users ?? []) : telegramUsers(input.telegram_users);
  const encrypted = await encrypt({telegram_token:token, telegram_users}, id, env);
  const now = new Date().toISOString();
  let result;
  try {
    result = await env.DB.prepare(`INSERT INTO profiles
      (id, name, bot_id, creator_id, creator_name, creator_username, encrypted_secrets, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, bot_id=excluded.bot_id, creator_id=excluded.creator_id,
      creator_name=excluded.creator_name, creator_username=excluded.creator_username,
      encrypted_secrets=excluded.encrypted_secrets, revision=profiles.revision+1, updated_at=excluded.updated_at
      WHERE profiles.revision = ?`).bind(id, creator.name, botId, creator.external_id, creator.name, creator.username, encrypted, now, revision).run();
  } catch (error) {
    if (String(error.message).includes('profiles.creator_id')) throw new ApiError(409, 'Esta modelo ya tiene un bot asignado');
    if (String(error.message).includes('UNIQUE constraint failed')) throw new ApiError(409, 'Este bot ya tiene una configuración');
    throw error;
  }
  if (!result.meta.changes) throw new ApiError(409, 'La configuración cambió, actualiza la lista');
  return json({id, name: creator.name, bot_id: botId, creator, revision: revision+1, updated_at: now});
}

const hersActions = /^\/(?:session|drops|active-bots|settings|agencykey|creators|access|resolve|profiles(?:\/[a-f0-9-]{36})?|recording-session(?:\/(?:active|connect|check|cancel|feed\/[a-f0-9-]{36}(?:\/(?:diagnostic|report))?))?)$/;

async function hersAdmin(request, env, action) {
  if (!hersActions.test(action)) throw new ApiError(404, 'Operación de Dropper no disponible');
  if (request.method !== 'GET') originCheck(request);
  const token = request.headers.get('Authorization');
  if (!/^Bearer [\w.-]+$/.test(token || '') || token.length > 6144) throw new ApiError(401, 'Inicia sesión en HERS');
  if (!env.HERS_SUPABASE_PUBLISHABLE_KEY) throw new ApiError(503, 'Acceso desde HERS sin configurar');
  let response;
  try {
    response = await fetch('https://glpevkghlzzuwkxojpvc.supabase.co/auth/v1/user', {
      headers: {apikey:env.HERS_SUPABASE_PUBLISHABLE_KEY, Authorization:token}, redirect:'manual', cache:'no-store',
    });
  } catch {
    throw new ApiError(502, 'No se pudo verificar la sesión de HERS');
  }
  if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Vuelve a iniciar sesión en HERS');
  if (!response.ok) throw new ApiError(502, 'No se pudo verificar la sesión de HERS');
  const user = await response.json();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(user?.id || '') || user.app_metadata?.role !== 'admin') {
    throw new ApiError(403, 'Acceso exclusivo para administradores de HERS');
  }
  return adminHandle(request, env, '/v1/admin'+action, 'hers_admin:'+user.id);
}

function adminDocument(request, embedded = '') {
  if (request.method !== 'GET') throw new ApiError(405, 'Método no permitido');
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(18)));
  const ancestors = embedded ? "'self'" : "'none'";
  return new Response(adminPage(nonce, embedded), {headers: {'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors ${ancestors}`}});
}

async function handle(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/') return Response.redirect(new URL('/admin',request.url).href,302);
  if (path === '/admin' || path === '/admin/') return adminDocument(request);
  const view = path.match(/^\/embed\/(bots|operations)$/);
  if (view) return adminDocument(request, view[1]);
  if (path.startsWith('/v1/hers-admin/')) return hersAdmin(request, env, path.slice('/v1/hers-admin'.length));
  if (path === '/health' && request.method === 'GET') return json({service: 'dropper', version: 9});
  if (path.startsWith('/v1/admin/')) return adminHandle(request, env, path);
  await authorize(request, env);
  if (path==='/v1/drop-publications' && request.method==='POST') return reportDropPublications(request,env);
  if (path==='/v1/recording-desktop-job') return desktopRecordingJob(request,env);
  if (path==='/v1/recording-session') {
    if (request.method==='GET') {
      const session=await sharedSession(env,true);
      if (!session.configured) throw new ApiError(409,'Conecta la sesión compartida de AgencyKey desde la web');
      return json(session);
    }
    if (request.method==='PUT') {
      const input=await body(request,524288);
      const session=await sharedSession(env);
      if (typeof input.revision!=='string' || !session.configured) throw new ApiError(409,'Conecta AgencyKey desde la web');
      return json(await saveSharedSession(env,input.state,input.revision,session.connection));
    }
    throw new ApiError(405,'Método no permitido');
  }
  if (path === '/v1/profiles' && request.method === 'GET') return listProfiles(env);
  if (path === '/v1/bot-activity' && request.method === 'POST') {
    const {profiles} = await body(request, 16384);
    if (!Array.isArray(profiles) || profiles.length > 100 || profiles.some((entry) =>
      !entry || !/^[a-f0-9-]{36}$/.test(entry.id) || !Number.isSafeInteger(entry.revision))) {
      throw new ApiError(400, 'Actividad de bots inválida');
    }
    const now = Date.now();
    if (profiles.length) await env.DB.batch(profiles.map(({id, revision}) => env.DB.prepare(`
      INSERT INTO bot_activity (profile_id, revision, last_seen)
      SELECT id, revision, ? FROM profiles WHERE id = ? AND revision = ? AND encrypted_secrets NOT LIKE 'legacy:%'
      ON CONFLICT(profile_id) DO UPDATE SET revision = excluded.revision, last_seen = excluded.last_seen
    `).bind(now, id, revision)));
    return json({received: true});
  }
  if (path === '/v1/profile-revisions' && request.method === 'GET') {
    const {results} = await env.DB.prepare("SELECT id, revision, updated_at FROM profiles WHERE encrypted_secrets NOT LIKE 'legacy:%'").all();
    return json({profiles:results});
  }
  const match = path.match(/^\/v1\/profiles\/([a-f0-9-]{36})\/credentials$/);
  if (match && request.method === 'POST') {
    const row = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(match[1]).first();
    if (!row) throw new ApiError(404, 'La configuración ya no existe');
    if (needsToken(row)) throw new ApiError(409, 'Vuelve a guardar el token en Conectores → Bots');
    const secret = await decrypt(row.encrypted_secrets,row.id,env);
    if (request.headers.get('X-Recorder-Protocol') !== '2')
      throw new ApiError(409, 'Actualiza la app de Windows antes de iniciar este bot');
    return json({...profile(row), telegram_users:secret.telegram_users ?? [],
      telegram_token:secret.telegram_token, api_key:await globalApi(env)});
  }
  if (['PUT','DELETE','PATCH','POST'].includes(request.method)) throw new ApiError(403, 'Gestiona las configuraciones desde el panel privado');
  throw new ApiError(404, 'Recurso no encontrado');
}

export default {
  async fetch(request, env) {
    try {
      const result = await handle(request, env);
      console.log(JSON.stringify({method: request.method, path: new URL(request.url).pathname, status: result.status}));
      return result;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error(JSON.stringify({event: 'config_error', type: error.name}));
      return json({error: status === 500 ? 'No se pudo procesar la configuración' : error.message}, status);
    }
  },
};
