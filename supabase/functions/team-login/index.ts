const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const respond = (body: object, status: number) => Response.json(body, { status, headers: cors });
const project = Deno.env.get("SUPABASE_URL");
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return respond({ error: "Método no permitido" }, 405);
  if (!project || !publishableKey) return respond({ error: "Inicio de sesión no disponible" }, 503);
  const credentials = await request.json().catch(() => null);
  const { username, password, role } = credentials ?? {};
  if (typeof username !== "string" || username.length > 254 || typeof password !== "string" ||
      !password.length || password.length > 1024 || !["admin", "chatter"].includes(role)) {
    return respond({ error: "Usuario o contraseña incorrectos" }, 400);
  }
  const email = username.includes("@") ? username : `${username}@hers-prueba.example`;
  const result = await fetch(`${project}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  if (!result?.ok) return respond({ error: "Usuario o contraseña incorrectos" }, result?.status === 429 ? 429 : 401);
  const { access_token, refresh_token, user } = await result.json();
  if (!access_token || !refresh_token || user?.app_metadata?.role !== role) {
    return respond({ error: "Usuario o contraseña incorrectos" }, 401);
  }
  return respond({ session: { access_token, refresh_token }, user, username, role }, 200);
});
