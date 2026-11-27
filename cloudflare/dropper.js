import worker from "../dropper/cloudflare/worker.mjs";

export const dropperPath = "/api/admin/dropper/";

const desktop = /^\/v1\/(?:profiles(?:\/[a-f0-9-]{36}\/(?:lease|credentials))?|profile-revisions|bot-activity|drop-publications|drop-recording|recording-desktop-job|recording-session)$/;

export function desktopDropperPath(path) {
  return desktop.test(path);
}

export function localDropper(env, readAgencyKey) {
  if (!env.DROPPER_DB) return null;
  const dropperEnv = {
    DB: env.DROPPER_DB,
    ACCESS_TOKEN: env.DROPPER_ACCESS_TOKEN,
    SUPABASE_STORAGE_SERVICE_ROLE: env.SUPABASE_STORAGE_SERVICE_ROLE,
    SUPABASE_URL: env.SUPABASE_URL,
    ENCRYPTION_KEY: env.DROPPER_ENCRYPTION_KEY,
    HERS_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
    HERS_AGENCY_KEY: { read: readAgencyKey },
  };
  return { fetch: (request) => worker.fetch(request, dropperEnv) };
}

export async function handleDropper(request, service) {
  const url = new URL(request.url);
  const action = url.pathname.slice(dropperPath.length);
  const error = (message, status) => Response.json({ error: message }, {
    status, headers: { "Cache-Control": "no-store" },
  });
  const view = action.match(/^view\/(bots|operations|session)$/)?.[1];
  if (view && request.method !== "GET") return error("Método no permitido", 405);
  if (!view && !/^api\/[a-z0-9/-]+$/.test(action)) return error("Operación de Dropper no disponible", 404);
  const origin = request.headers.get("Origin");
  if (request.method !== "GET" && origin !== url.origin) return error("Origen no permitido", 403);
  if (!view && !request.headers.has("Authorization")) return error("Inicia sesión en HERS", 401);
  if (!service) return error("Dropper aún no está conectado al Worker de HERS", 503);

  url.pathname = view ? `/embed/${view}` : `/v1/hers-admin/${action.slice(4)}`;
  if (view) url.search = "";
  const headers = new Headers();
  for (const name of ["Origin", "Authorization", "Content-Type", "If-Match"]) {
    const value = request.headers.get(name);
    if (value && !view) headers.set(name, value);
  }
  const upstream = new Request(new Request(url, request), { headers, redirect: "manual" });
  try {
    return await service.fetch(upstream);
  } catch {
    return error("El servicio Dropper no está disponible", 502);
  }
}
