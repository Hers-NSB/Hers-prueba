const tokenPattern = /^[0-9a-f]{64}$/;
const uuid = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const photoPattern = new RegExp(`^${uuid}/${uuid}\\.(jpg|png)$`);
const maxSize = 10_485_760;
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function fail(status: number) {
  return new Response(null, { status, headers: responseHeaders });
}

export async function manualDropPhoto(
  request: Request,
  project: string | undefined,
  key: string | undefined,
  send = fetch,
) {
  if (request.method !== "GET") return fail(405);
  const token = request.headers.get("X-HERS-Photo-Token") ?? "";
  if (!tokenPattern.test(token)) return fail(401);
  const path = new URL(request.url).searchParams.get("path") ?? "";
  const match = photoPattern.exec(path);
  if (!match) return fail(400);
  if (!project || !key) return fail(503);

  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  try {
    const check = await send(`${project}/rest/v1/rpc/manual_drop_photo_authorized`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!check.ok) return fail(503);
    if (await check.json() !== true) return fail(403);

    const photo = await send(`${project}/storage/v1/object/authenticated/manual-drop-photos/${path}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (photo.status === 400 || photo.status === 404) return fail(404);
    if (!photo.ok || !photo.body) return fail(502);
    const mime = match[1] === "png" ? "image/png" : "image/jpeg";
    const size = Number(photo.headers.get("Content-Length"));
    if (photo.headers.get("Content-Type")?.split(";")[0] !== mime || size > maxSize) {
      await photo.body.cancel();
      return fail(415);
    }

    return new Response(photo.body, {
      headers: { ...responseHeaders, "Content-Type": mime },
    });
  } catch {
    return fail(502);
  }
}
