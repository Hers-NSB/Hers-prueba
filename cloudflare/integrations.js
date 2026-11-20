const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const hex = (data) => Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");

class IntegrationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function integrationKey(secret, purpose, algorithm, operations) {
  const key = await crypto.subtle.importKey("raw", bytes(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("hers-prueba/integrations/v1"), info: encoder.encode(purpose) },
    key, algorithm, purpose === "rpc", operations,
  );
}

export async function bridgeToken(secret) {
  const key = await integrationKey(secret, "rpc", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]);
  return hex(await crypto.subtle.exportKey("raw", key));
}

export async function seal(secret, service, kind, value) {
  const key = await integrationKey(secret, "encryption", { name: "AES-GCM", length: 256 }, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`${service}/${kind}`) }, key, encoder.encode(value),
  );
  return `v1.${base64(iv)}.${base64(encrypted)}`;
}

async function unseal(secret, service, kind, value) {
  const [version, iv, encrypted] = value.split(".");
  if (version !== "v1") throw new Error("Versión de credencial desconocida");
  const key = await integrationKey(secret, "encryption", { name: "AES-GCM", length: 256 }, ["decrypt"]);
  return decoder.decode(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv), additionalData: encoder.encode(`${service}/${kind}`) }, key, bytes(encrypted),
  ));
}

export async function bridge(project, env, action, data = {}, send = fetch) {
  const response = await send(`${project}/rest/v1/rpc/hers_integration_worker`, {
    method: "POST",
    redirect: "manual",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: await bridgeToken(env.HERS_INTEGRATIONS_SECRET), p_action: action, p_data: data }),
  });
  if (!response.ok) throw new IntegrationError(502, "El almacenamiento de integraciones no está disponible");
  return response.json();
}

export async function storedAgencyKey(project, env, send = fetch) {
  const record = await bridge(project, env, "agencykey", {}, send);
  return record?.ciphertext
    ? unseal(env.HERS_INTEGRATIONS_SECRET, "agencykey", "api-key", record.ciphertext)
    : env.AGENCYKEY_API_KEY;
}

async function admin(request, project, env, send) {
  const token = request.headers.get("Authorization");
  if (!token?.startsWith("Bearer ") || token.length > 6144) throw new IntegrationError(401, "Inicia sesión para continuar");
  const response = await send(`${project}/auth/v1/user`, {
    redirect: "manual",
    cache: "no-store",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: token },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new IntegrationError(401, "Vuelve a iniciar sesión");
    throw new IntegrationError(502, "No se pudo verificar tu sesión");
  }
  const user = await response.json();
  if (!user.id || user.app_metadata?.role !== "admin") throw new IntegrationError(403, "Acceso exclusivo para administradores");
  return user.id;
}

async function readCredential(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new IntegrationError(400, "Faltan los datos de la credencial");
  let raw = "";
  let size = 0;
  const stream = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw new IntegrationError(413, "La credencial supera el tamaño permitido");
    }
    raw += stream.decode(value, { stream: true });
  }
  let data;
  try { data = JSON.parse(raw + stream.decode()); }
  catch { throw new IntegrationError(400, "Formato de credencial inválido"); }
  const { service, kind, value } = data ?? {};
  if (
    typeof service !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(service) ||
    !["api-key", "token", "password"].includes(kind) ||
    (service === "agencykey" && kind !== "api-key") ||
    typeof value !== "string" || !value.trim() || encoder.encode(value).length > 4096 ||
    (kind !== "password" && /[\r\n]/.test(value))
  ) throw new IntegrationError(400, "Comprueba el servicio, el tipo y el valor");
  return { service, kind, value };
}

export async function handleIntegrations(request, project, env, run, send = fetch) {
  const json = (payload, status = 200) => Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
  const route = new URL(request.url);
  const action = route.pathname.slice("/api/admin/integrations".length);
  try {
    if (!env.HERS_INTEGRATIONS_SECRET || !env.SUPABASE_PUBLISHABLE_KEY) {
      throw new IntegrationError(503, "Integraciones aún no está configurado");
    }
    if (request.headers.has("Origin") && request.headers.get("Origin") !== route.origin) {
      throw new IntegrationError(403, "Origen no permitido");
    }
    const user = await admin(request, project, env, send);
    if (request.method === "GET" && action === "") return json(await bridge(project, env, "status", {}, send));
    if (request.method === "PUT" && action === "/credential") {
      const { service, kind, value } = await readCredential(request);
      const ciphertext = await seal(env.HERS_INTEGRATIONS_SECRET, service, kind, value);
      return json(await bridge(project, env, "save", { service, kind, ciphertext, updated_by: user }, send));
    }
    if (request.method === "POST" && ["/test", "/sync"].includes(action)) {
      const result = await run(action === "/test");
      if (result.skipped) throw new IntegrationError(409, "Guarda primero la clave API de AgencyKey");
      return json({ ok: true, ...result });
    }
    return json({ error: "Operación no disponible" }, 404);
  } catch (error) {
    if (error instanceof IntegrationError) return json({ error: error.message }, error.status);
    const upstream = /^AgencyKey (?:creators|employees): HTTP ([1-5][0-9]{2})$/.exec(error.message);
    return json({ error: upstream
      ? `AgencyKey respondió HTTP ${upstream[1]}. Revisa la clave y los permisos de reportes`
      : "La operación no se pudo completar" }, 502);
  }
}
