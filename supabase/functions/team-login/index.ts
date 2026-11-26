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
  let email: string;
  let adminId: string | undefined;
  if (role === "admin") {
    const alias = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,64}$/.test(alias)) {
      return respond({ error: "Usuario o contraseña incorrectos" }, 401);
    }
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return respond({ error: "Inicio de sesión no disponible" }, 503);
    const lookup = new URL(`${project}/rest/v1/admin_login_aliases`);
    lookup.searchParams.set("select", "email,user_id");
    lookup.searchParams.set("username", "eq." + alias);
    const mapping = await fetch(lookup, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => null);
    if (!mapping?.ok) return respond({ error: "Inicio de sesión no disponible" }, 503);
    const rows = await mapping.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length !== 1 ||
        typeof rows[0].email !== "string" || typeof rows[0].user_id !== "string") {
      return respond({ error: "Usuario o contraseña incorrectos" }, 401);
    }
    email = rows[0].email;
    adminId = rows[0].user_id;
  } else {
    email = username.includes("@") ? username : `${username}@hers-prueba.example`;
  }
  const result = await fetch(`${project}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => null);
  if (!result?.ok) return respond({ error: "Usuario o contraseña incorrectos" }, result?.status === 429 ? 429 : 401);
  const { access_token, refresh_token, user } = await result.json();
  if (!access_token || !refresh_token || user?.app_metadata?.role !== role ||
      (role === "admin" && user?.id !== adminId)) {
    return respond({ error: "Usuario o contraseña incorrectos" }, 401);
  }
  return respond({ session: { access_token, refresh_token }, user, username, role }, 200);
});
