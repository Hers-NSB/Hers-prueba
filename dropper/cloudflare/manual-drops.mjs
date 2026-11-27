import savedProfiles from '../agencykey-perfiles.json' with {type:'json'};

export const manualDropsCron = '* * * * *';
const dayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'America/Caracas', year:'numeric', month:'2-digit', day:'2-digit',
});
const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone:'America/Caracas', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const photoPattern = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:jpg|png)$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function configured(env) {
  return Boolean(env.SUPABASE_STORAGE_SERVICE_ROLE && env.SUPABASE_URL);
}

export async function listManualDrops(env) {
  const today = dayFormat.format(new Date());
  const [chains, steps, deliveries] = await env.DB.batch([
    env.DB.prepare('SELECT id, creator_id, creator_name, name, enabled, start_date, revision FROM manual_drop_chains ORDER BY name COLLATE NOCASE, id'),
    env.DB.prepare('SELECT * FROM manual_drop_steps ORDER BY position'),
    env.DB.prepare(`SELECT c.name, s.position, s.state, s.error FROM manual_drop_deliveries s
      JOIN manual_drop_chains c ON c.id=s.chain_id
      WHERE s.local_date=? AND (s.state IN ('failed','uncertain') OR (s.state='publishing' AND s.updated_at < ?))
      ORDER BY s.updated_at DESC`).bind(today, Date.now() - 300_000),
  ]);
  const byChain = new Map(chains.results.map((chain) => [chain.id, { ...chain, steps: [] }]));
  for (const step of steps.results) byChain.get(step.chain_id)?.steps.push(step);
  return { chains: [...byChain.values()], deliveries: deliveries.results, photos_configured: configured(env) };
}

export async function saveManualDrops(env, input, readCreators, fail, now=new Date()) {
  if (!input || typeof input.id !== 'string' || !idPattern.test(input.id) ||
      !Number.isSafeInteger(input.creator_id) || input.creator_id <= 0 ||
      typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120 ||
      typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !Array.isArray(input.steps) || !input.steps.length || input.steps.length > 50)
    throw fail(400, 'Introduce un nombre, una modelo y entre 1 y 50 publicaciones');

  for (const [index, step] of input.steps.entries()) {
    if (!step || typeof step.send_time !== 'string' || !timePattern.test(step.send_time) ||
        typeof step.text !== 'string' || step.text.length > 4000 || (!step.text.trim() && !step.photo) ||
        (step.photo !== null && (typeof step.photo !== 'string' || !photoPattern.test(step.photo) ||
          !step.photo.startsWith(input.id+'/'))) ||
        (index > 0 && step.send_time < input.steps[index-1].send_time))
      throw fail(400, 'Revisa el texto, la foto y el orden de las horas de cada publicación');
    if (step.photo && !configured(env)) throw fail(503, 'El Worker aún no tiene acceso al almacenamiento de fotos');
  }

  const creator = (await readCreators()).find(({external_id}) => external_id === input.creator_id);
  if (!creator) throw fail(400, 'La modelo seleccionada no está disponible en AgencyKey');

  const today = dayFormat.format(now);
  const tomorrow = new Date(Date.parse(today+'T00:00:00Z') + 86_400_000).toISOString().slice(0,10);
  const start = input.steps[0].send_time <= timeFormat.format(now) ? tomorrow : today;
  const next = input.revision + 1;
  const writeId = crypto.randomUUID();
  const update = await env.DB.batch([
    env.DB.prepare(`INSERT INTO manual_drop_chains (id, creator_id, creator_name, name, enabled, start_date, revision, write_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ? = 0
        OR EXISTS (SELECT 1 FROM manual_drop_chains WHERE id=? AND revision=?)
      ON CONFLICT(id) DO UPDATE SET creator_id=excluded.creator_id, creator_name=excluded.creator_name,
        name=excluded.name, enabled=excluded.enabled, start_date=excluded.start_date, revision=excluded.revision, write_id=excluded.write_id
      WHERE manual_drop_chains.revision=? AND NOT EXISTS (
        SELECT 1 FROM manual_drop_deliveries WHERE chain_id=excluded.id AND local_date=?
      )`).bind(input.id,input.creator_id,creator.name,input.name.trim(),Number(input.enabled),start,next,writeId,
        input.revision,input.id,input.revision,input.revision,today),
    env.DB.prepare(`DELETE FROM manual_drop_steps WHERE chain_id=? AND EXISTS (SELECT 1 FROM manual_drop_chains WHERE id=? AND write_id=?)`).bind(input.id,input.id,writeId),
    ...input.steps.map((step,index) => env.DB.prepare(`INSERT INTO manual_drop_steps
      (chain_id, position, send_time, text, photo)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM manual_drop_chains WHERE id=? AND write_id=?
      ) ON CONFLICT (chain_id, position) DO NOTHING`)
      .bind(input.id,index+1,step.send_time,step.text,step.photo,input.id,writeId)),
  ]);
  if (!update[0].meta.changes) throw fail(409, 'La cadena cambió o ya comenzó a enviarse hoy. Actualiza el panel.');
}

class DeliveryError extends Error {
  constructor(message, state='failed', retryAt=0) {
    super(message);
    this.state=state;
    this.retryAt=retryAt;
  }
}

async function preparePhoto(step, base, env, ask, send) {
  const type = step.photo.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const extension = type === 'image/png' ? 'png' : 'jpg';
  const storageKey = step.photo.split('/').map(encodeURIComponent).join('/');
  const storageCredential = env.SUPABASE_STORAGE_SERVICE_ROLE;
  const headers = {apikey:storageCredential};
  if (!storageCredential.startsWith('sb_secret_')) headers.Authorization = 'Bearer '+storageCredential;
  const photo = await send(`${env.SUPABASE_URL}/storage/v1/object/authenticated/manual-drop-photos/${storageKey}`, {
    redirect:'error', signal:AbortSignal.timeout(30_000), headers,
  });
  if (!photo.ok) throw new DeliveryError('No se pudo descargar la foto privada');
  const bytes = await photo.arrayBuffer();
  if (bytes.byteLength > 10_485_760) throw new DeliveryError('La foto excede 10 MB');

  const profileResponse = await ask(base+'/users/me');
  const profile = profileResponse.ok ? await profileResponse.json()
    : profileResponse.status === 400 ? savedProfiles[String(step.creator_id)] : null;
  const settings = profile?.upload?.geoUploadArgs;
  if (!settings || String(profile.id) !== String(step.creator_id) ||
      String(settings.additional?.user) !== String(step.creator_id))
    throw new DeliveryError('No se pudo verificar la configuración de fotos de la modelo');

  const filename = `dropper-${crypto.randomUUID()}.${extension}`;
  const key = `upload/${crypto.randomUUID()}/${String(crypto.getRandomValues(new Uint32Array(1))[0]).padStart(12,'0')}/${filename}`;
  const signedResponse = await ask(base+'/upload/signed/create', {key, parts:1, contentType:type, secure:false, userPrefix:'upload'});
  if (!signedResponse.ok) throw new DeliveryError('AgencyKey rechazó la solicitud de carga de foto');
  const signed = await signedResponse.json();
  const putUrl = new URL(signed.putUrl);
  if (putUrl.origin !== 'https://of2transcoder.s3-accelerate.amazonaws.com' || putUrl.username || putUrl.password || !putUrl.search)
    throw new DeliveryError('La carga de fotos devolvió un destino inválido');
  const upload = await send(putUrl, {method:'PUT', body:bytes, headers:{'Content-Type':type},
    redirect:'error', signal:AbortSignal.timeout(45_000)});
  const etag = upload.headers.get('ETag');
  if (!upload.ok || !etag || signed.key !== key || typeof signed.uploadToken !== 'string')
    throw new DeliveryError('No se pudo subir la foto');

  const fields = {
    preset:settings.preset, isDelay:String(settings.isDelay), needThumbs:String(settings.needThumbs),
    'additional[user]':String(step.creator_id), 'file[ETag]':etag, 'file[Location]':putUrl.origin+putUrl.pathname,
    'file[Key]':key, 'file[Bucket]':'of2transcoder', 'file[name]':filename, 'file[uploadToken]':signed.uploadToken,
  };
  if (profile.hasWatermarkPhoto) {
    fields['watermark[text]']=profile.watermarkText;
    fields['watermark[position]']=profile.watermarkPosition;
  }
  const body = new FormData();
  for (const [name,value] of Object.entries(fields)) body.append(name,value);
  const converted = await send('https://convert.onlyfans.com/file/upload', {
    method:'POST', body, redirect:'error', signal:AbortSignal.timeout(45_000),
  });
  if (!converted.ok) throw new DeliveryError('No se pudo procesar la foto');
  const output = await converted.json();
  const attachment = {processId:output.processId, host:output.host, extra:output.extra, name:filename};
  if (!Object.values(attachment).every(value => typeof value === 'string' && value))
    throw new DeliveryError('El procesamiento no confirmó el adjunto');
  return attachment;
}

async function publish(step, env, key, send) {
  const base = `/v1/onlyfans/${step.creator_id}/api2/v2`;
  function ask(path, payload) {
    return send('https://app.agencykey.com/api'+path, {
      redirect:'error', signal:AbortSignal.timeout(45_000),
      headers:{'x-public-api-key':key, Accept:'application/json', 'Content-Type':'application/json'},
      method:payload ? 'POST' : 'GET', body:payload ? JSON.stringify(payload) : undefined,
    });
  }
  const payload = {text:step.text, expireDays:1};
  if (step.photo) payload.mediaFiles = [await preparePhoto(step,base,env,ask,send)];
  let response;
  try {
    response = await ask(base+'/posts', payload);
  } catch {
    throw new DeliveryError('AgencyKey no confirmó si creó la publicación. Revisa el feed.', 'uncertain');
  }
  if (response.status === 429) {
    const value=response.headers.get('Retry-After');
    const seconds=/^\d+$/.test(value ?? '') ? Number(value) : (Date.parse(value)-Date.now())/1000;
    throw new DeliveryError('AgencyKey limitó temporalmente el envío', 'retry',
      Date.now()+1000*Math.max(60, Number.isFinite(seconds) ? seconds : 60));
  }
  if ([400,401,403,404,422].includes(response.status))
    throw new DeliveryError(`AgencyKey rechazó la publicación (HTTP ${response.status})`);
  const data = response.ok ? await response.json().catch(() => null) : null;
  const id = data?.id;
  if (!/^[1-9]\d{0,24}$/.test(String(id)) || (typeof id === 'number' && !Number.isSafeInteger(id)) ||
      (step.photo && data?.mediaCount === 0))
    throw new DeliveryError('AgencyKey no confirmó la publicación completa. Revisa el feed.', 'uncertain');
  return String(id);
}

export async function runManualDrops(env, instant, readAgencyKey, send=fetch) {
  if (!env.DB) return;
  const day=dayFormat.format(instant);
  const hour=timeFormat.format(instant);
  const {results}=await env.DB.prepare(`SELECT s.*, c.creator_id, c.creator_name, c.revision
    FROM manual_drop_chains c JOIN manual_drop_steps s ON s.chain_id=c.id
    LEFT JOIN manual_drop_deliveries d ON d.chain_id=c.id AND d.position=s.position AND d.local_date=?
    WHERE c.enabled=1 AND c.start_date<=? AND s.send_time<=?
      AND (d.state IS NULL OR d.state='retry' AND d.retry_at<=?)
      AND NOT EXISTS (SELECT 1 FROM manual_drop_steps p WHERE p.chain_id=c.id AND p.position<s.position
        AND NOT EXISTS (SELECT 1 FROM manual_drop_deliveries q
          WHERE q.chain_id=c.id AND q.local_date=? AND q.position=p.position AND q.state='published'))
    ORDER BY s.send_time, c.id LIMIT 20`).bind(day,day,hour,Date.now(),day).all();
  if (!results.length) return;
  const key=await readAgencyKey();
  if (!key) throw new Error('Configura la clave de AgencyKey para enviar drops manuales');

  for (const step of results) {
    const claimTime=Date.now();
    const claimed=await env.DB.prepare(`INSERT INTO manual_drop_deliveries (chain_id, local_date, position, state, updated_at)
      SELECT ?, ?, ?, 'publishing', ? WHERE EXISTS (
        SELECT 1 FROM manual_drop_chains WHERE id=? AND revision=? AND enabled=1
      ) ON CONFLICT (chain_id, local_date, position) DO UPDATE SET state='publishing', updated_at=excluded.updated_at
        WHERE state='retry' AND retry_at<=excluded.updated_at`)
      .bind(step.chain_id,day,step.position,claimTime,step.chain_id,step.revision).run();
    if (!claimed.meta.changes) continue;
    let postId;
    try {
      postId=await publish(step,env,key,send);
    } catch (error) {
      const state=error instanceof DeliveryError ? error.state : 'failed';
      const message=error instanceof DeliveryError ? error.message : 'No se pudo preparar la publicación';
      await env.DB.prepare(`UPDATE manual_drop_deliveries SET state=?, updated_at=?, retry_at=?, error=?
        WHERE chain_id=? AND local_date=? AND position=?`)
        .bind(state,Date.now(),error.retryAt ?? 0,message,step.chain_id,day,step.position).run();
      continue;
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE manual_drop_deliveries SET state='published',updated_at=?,post_id=?,error=NULL
        WHERE chain_id=? AND local_date=? AND position=?`).bind(Date.now(),postId,step.chain_id,day,step.position),
      env.DB.prepare(`INSERT INTO drop_publications
        (creator_id, creator_name, drop_id, position, post_id, manual, confirmed_at, local_date)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING`)
        .bind(step.creator_id,step.creator_name,`${step.chain_id}-${day}`,step.position,postId,Math.floor(Date.now()/1000),day),
    ]);
  }
}
