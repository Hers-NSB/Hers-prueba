import { IntegrationError, seal, unseal, workerRpc } from "./integrations.js";

const agency = "https://app.agencykey.com";
const resource = `${agency}/mcp`;
const callback = "/api/admin/integrations/agencykey-directory/callback";
const oauthCookie = "__Secure-hers-agencykey";
const stateKind = "directory-state";
const tokenKind = "directory-token";
const encoder = new TextEncoder();
const base64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const cookie = (value, age) => `${oauthCookie}=${value}; Path=${callback}; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const directoryId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function failure(message, code = "AK-DIRECTORY", status = 502) {
  return new IntegrationError(status, message, code);
}

async function responseJson(response, stage) {
  if (!response.ok) throw failure(`AgencyKey rechazó ${stage} (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw failure(`AgencyKey devolvió un formato inválido al consultar ${stage}`); }
}

function providerOptions(options) {
  return { ...options, redirect: "manual", signal: AbortSignal.timeout(12_000) };
}

async function requestToken(parameters, send) {
  const response = await send(`${agency}/oauth/token`, providerOptions({
    method: "POST", body: new URLSearchParams(parameters),
  }));
  if (response.status === 400) throw failure("Vuelve a conectar el directorio de AgencyKey", "AK-DIRECTORY-CONNECT", 409);
  const token = await responseJson(response, "la autorización del directorio");
  if (typeof token.access_token !== "string" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw failure("AgencyKey devolvió una autorización inválida");
  }
  return {
    access: token.access_token, refresh: token.refresh_token,
    expires: Date.now() + token.expires_in * 1000,
  };
}

const protect = (env, purpose, data) => seal(env.HERS_INTEGRATIONS_SECRET, "agencykey-directory", purpose, JSON.stringify(data));
const reveal = async (env, purpose, value) => JSON.parse(await unseal(env.HERS_INTEGRATIONS_SECRET, "agencykey-directory", purpose, value));
const rpc = (project, env, action, data, send) => workerRpc("hers_agencykey_directory", project, env, action, data, send);

export async function beginDirectory(request, user, env, send = fetch) {
  const redirectUri = new URL(callback, request.url).href;
  const registration = await send(`${agency}/oauth/register`, providerOptions({
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "HERS prueba · Empleados",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }));
  const { client_id: client } = await responseJson(registration, "el registro de HERS");
  if (typeof client !== "string" || !client) throw failure("Registro de AgencyKey inválido");
  const state = random();
  const verifier = random();
  const challenge = base64url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  const sealed = await protect(env, stateKind, { state, verifier, client, user, redirectUri, expires: Date.now() + 600_000 });
  const authorize = new URL(`${agency}/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code", client_id: client, redirect_uri: redirectUri, state,
    code_challenge: challenge, code_challenge_method: "S256", resource,
  }).toString();
  return Response.json({ authorize: authorize.href }, { headers: { ...noStore, "Set-Cookie": cookie(sealed, 600) } });
}

function directoryCallbackPage(connected) {
  const nonce = random();
  const message = connected ? "Directorio de AgencyKey conectado" : "No se pudo conectar el directorio de AgencyKey";
  return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><title>${message}</title>
    <p>${message}</p><a href="/">Volver a HERS prueba</a>
    <script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"hers-agencykey-directory",connected:${connected}},location.origin);window.close()}</script></html>`,
  { headers: { ...noStore, "Set-Cookie": cookie("", 0), "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'` } });
}

export async function finishDirectory(request, project, env, send = fetch) {
  const url = new URL(request.url);
  const sealed = request.headers.get("Cookie")?.split(/;\s*/).find((part) => part.startsWith(`${oauthCookie}=`))?.slice(oauthCookie.length + 1);
  const code = url.searchParams.get("code");
  try {
    if (!sealed || !code) throw new Error("Autorización cancelada");
    const { state, verifier, client, user, redirectUri, expires } = await reveal(env, stateKind, sealed);
    if (Date.now() > expires || state !== url.searchParams.get("state") || new URL(callback, url).href !== redirectUri) {
      throw new Error("Sesión de autorización inválida");
    }
    const token = await requestToken({
      grant_type: "authorization_code", code, code_verifier: verifier, client_id: client, redirect_uri: redirectUri, resource,
    }, send);
    const snapshot = await readAgencyDirectory(token.access, send);
    const connection = await protect(env, tokenKind, { ...token, client });
    await rpc(project, env, "connect", { connection, user, snapshot }, send);
    return directoryCallbackPage(true);
  } catch {
    return directoryCallbackPage(false);
  }
}

async function decodeMcp(response) {
  if (!(response.headers.get("Content-Type") ?? "").includes("text/event-stream")) return response.json();
  const source = await response.text();
  for (const frame of source.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
    if (lines.length) {
      const message = JSON.parse(lines.join("\n"));
      if ("id" in message) return message;
    }
  }
  throw failure("AgencyKey dejó incompleta la respuesta del directorio");
}

async function mcpSession(access, send) {
  const headers = {
    Authorization: `Bearer ${access}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json",
  };
  let sequence = 0;
  async function request(method, params, notification = false) {
    const id = ++sequence;
    const response = await send(resource, providerOptions({
      method: "POST", headers: { ...headers }, body: JSON.stringify({
        jsonrpc: "2.0", ...(!notification && { id }), method, ...(params && { params }),
      }),
    }));
    if (response.status === 401) throw failure("Vuelve a conectar el directorio de AgencyKey", "AK-DIRECTORY-CONNECT", 409);
    if (!response.ok) throw failure(`AgencyKey rechazó la consulta del directorio (HTTP ${response.status})`);
    if (notification) return;
    const payload = await decodeMcp(response);
    if (payload.id !== id || payload.error || !payload.result) throw failure("AgencyKey no completó la consulta del directorio");
    return { result: payload.result, session: response.headers.get("Mcp-Session-Id") };
  }
  const { result, session } = await request("initialize", {
    protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "HERS prueba", version: "1.0.0" },
  });
  if (typeof result.protocolVersion !== "string") throw failure("AgencyKey no devolvió una versión de protocolo");
  headers["MCP-Protocol-Version"] = result.protocolVersion;
  if (session) headers["Mcp-Session-Id"] = session;
  await request("notifications/initialized", undefined, true);
  return async (name, args) => {
    const { result } = await request("tools/call", { name, arguments: args });
    if (result.isError) throw failure("AgencyKey no permitió consultar el directorio");
    if (result.structuredContent) return result.structuredContent;
    const content = result.content?.find(({ type }) => type === "text");
    return JSON.parse(content?.text ?? "null");
  };
}

async function readAll(call, tool) {
  const all = new Map();
  let total;
  let pages;
  for (let page = 1; ; page += 1) {
    const { data, pagination } = (await call(tool, { page, limit: 100 })) ?? {};
    if (!Array.isArray(data) || pagination?.page !== page || !Number.isInteger(pagination?.pages) ||
      pagination.pages < 0 || pagination.pages > 100 || !Number.isInteger(pagination?.total) ||
      (page > 1 && (pagination.total !== total || pagination.pages !== pages))) {
      throw failure("AgencyKey no devolvió un directorio completo");
    }
    ({ total, pages } = pagination);
    for (const row of data) {
      if (!directoryId.test(row.id) || all.has(row.id)) throw failure("AgencyKey devolvió un registro inválido o repetido");
      all.set(row.id, row);
    }
    if (page >= pages) break;
  }
  if (all.size !== total) throw failure("AgencyKey no devolvió todas las filas del directorio");
  return [...all.values()];
}

export async function readAgencyDirectory(access, send = fetch) {
  const call = await mcpSession(access, send);
  const [members, accounts] = await Promise.all([
    readAll(call, "users_list_team_members"),
    readAll(call, "creators_list"),
  ]);
  if (!members.some(({ roles, status }) => status === "ACTIVE" && roles?.some(({ name }) => name === "Owner"))) {
    throw failure("Conecta una cuenta de AgencyKey con acceso al directorio completo", "AK-DIRECTORY-SCOPE", 409);
  }
  const employees = members.map(({ id, username, roles, status }) => {
    if (typeof username !== "string" || !username.trim() || !Array.isArray(roles) ||
        roles.some(({ name }) => typeof name !== "string" || !name.trim()) ||
        !["ACTIVE", "INVITING", "INACTIVE"].includes(status)) {
      throw failure("AgencyKey devolvió un empleado con nombre, rol o estado inválido");
    }
    return { id, name: username.trim().slice(0, 120), role: roles.map(({ name }) => name.trim()).join(", ").slice(0, 120) || "Sin rol",
      active: status === "ACTIVE" };
  });
  const creators = accounts.map(({ id, name }) => {
    if (typeof name !== "string" || !name.trim()) throw failure("AgencyKey devolvió una modelo sin nombre");
    return { id, name: name.trim().slice(0, 120), role: "Modelo" };
  });
  return { employees, creators };
}

export async function syncDirectory(project, env, send = fetch) {
  const connection = await rpc(project, env, "load", {}, send);
  if (!connection?.ciphertext) throw failure("Conecta el directorio de AgencyKey para agregar empleados", "AK-DIRECTORY-CONNECT", 409);
  let token = await reveal(env, tokenKind, connection.ciphertext);
  if (token.expires < Date.now() + 30_000) {
    if (!token.refresh) throw failure("Vuelve a conectar el directorio de AgencyKey", "AK-DIRECTORY-CONNECT", 409);
    const lease = crypto.randomUUID();
    const { claimed } = await rpc(project, env, "claim", { revision: connection.revision, lease }, send);
    if (!claimed) throw failure("El directorio se está actualizando. Intenta de nuevo", "AK-DIRECTORY-BUSY", 409);
    try {
      const next = await requestToken({ grant_type: "refresh_token", client_id: token.client, refresh_token: token.refresh, resource }, send);
      token = { ...next, refresh: next.refresh ?? token.refresh, client: token.client };
      const ciphertext = await protect(env, tokenKind, token);
      const refreshed = await rpc(project, env, "refresh", { lease, connection: ciphertext }, send);
      if (!refreshed.saved) throw failure("La conexión del directorio cambió. Intenta de nuevo", "AK-DIRECTORY-BUSY", 409);
      connection.revision = refreshed.revision;
    } finally {
      await rpc(project, env, "release", { lease }, send).catch(() => {});
    }
  }
  const started_at = new Date().toISOString();
  const snapshot = await readAgencyDirectory(token.access, send);
  const { saved } = await rpc(project, env, "snapshot", { revision: connection.revision, snapshot, started_at }, send);
  if (!saved) throw failure("La conexión del directorio cambió. Intenta de nuevo", "AK-DIRECTORY-BUSY", 409);
  return { ...snapshot, employees: snapshot.employees.filter(({ active }) => active) };
}
