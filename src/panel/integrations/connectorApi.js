import { supabase } from "../../lib/supabase";

export default async function callApi(path = "", method = "GET", payload, signal) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Inicia sesión para continuar");
  const response = await fetch(`/api/admin/integrations${path}`, {
    method, signal, cache: "no-store",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: payload && JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "Conectores no está disponible");
  return result;
}
