export const dropperPath = "/api/admin/dropper/";

export async function handleDropper(request, service, downloads) {
  const url = new URL(request.url);
  const action = url.pathname.slice(dropperPath.length);
  const error = (message, status) => Response.json({ error: message }, {
    status, headers: { "Cache-Control": "no-store" },
  });
  if (action === "download/windows") {
    if (!["GET", "HEAD"].includes(request.method)) return error("Método no permitido", 405);
    try {
      const object = await downloads?.[request.method === "HEAD" ? "head" : "get"]("windows/HERS-Dropper.exe");
      if (!object) return error("La descarga de HERS Dropper aún no está publicada", 503);
      return new Response(request.method === "HEAD" ? null : object.body, { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="HERS-Dropper.exe"',
        "Content-Length": String(object.size),
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch {
      return error("La descarga de HERS Dropper no está disponible", 502);
    }
  }
  const view = action.match(/^view\/(bots|operations)$/)?.[1];
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
