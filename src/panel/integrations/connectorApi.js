import { supabase } from "../../lib/supabase";

export default async function callApi(path = "", method = "GET", payload, signal, base = "/api/admin/integrations") {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("[CON-SESSION-MISSING] Inicia sesión para continuar");
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method, signal, cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
      body: payload && JSON.stringify(payload),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("[CON-NETWORK] No se pudo conectar con el Worker", { cause: error });
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || `[CON-RESPONSE] El Worker devolvió una respuesta inesperada (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result;
}
