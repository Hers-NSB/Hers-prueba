import { useEffect, useState } from "react";
import { KeyRound, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import "../finanzas/finanzas.css";
import "./integrations.css";

const kinds = { "api-key": "Clave API", token: "Token", password: "Contraseña de servicio" };
const blank = { service: "agencykey", kind: "api-key", value: "" };
const dateTime = (date) => new Date(date).toLocaleString("es-VE");

async function callApi(path = "", method = "GET", payload, signal) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Inicia sesión para continuar");
  const response = await fetch(`/api/admin/integrations${path}`, {
    method, signal, cache: "no-store",
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: payload && JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "Integraciones no está disponible");
  return result;
}

export default function Integrations() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(blank);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    callApi("", "GET", undefined, controller.signal).then(setData).catch((error) => {
      if (!controller.signal.aborted) setNotice({ error: error.message });
    });
    return () => controller.abort();
  }, []);

  async function perform(operation) {
    setAction(operation);
    setNotice(null);
    try {
      if (operation === "save") {
        await callApi("/credential", "PUT", form);
        setForm((current) => ({ ...current, value: "" }));
        setNotice({ success: "Credencial guardada" });
      } else if (operation !== "refresh") {
        const result = await callApi(`/${operation}`, "POST");
        const label = operation === "test" ? "Conexión correcta" : "Importación completada";
        setNotice({ success: `${label} · ${result.day} · ${result.creators} modelos · ${result.attributions} atribuciones` });
      }
      setData(await callApi());
    } catch (error) {
      setNotice({ error: error.message });
    } finally { setAction(""); }
  }

  const agencyKeySaved = data?.credentials.some(({ service, kind }) => service === "agencykey" && kind === "api-key");
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  return <section className="hf hers-integrations" aria-label="Integraciones">
    <header className="hf-header">
      <div><h1>Integraciones</h1><p>Credenciales de servicios y sincronización de AgencyKey</p></div>
      <button type="button" onClick={() => perform("refresh")} disabled={Boolean(action)}>
        <RefreshCw size={16} aria-hidden="true" /> Actualizar estado
      </button>
    </header>
    {notice && <p className="hf-notice" role={notice.error ? "alert" : "status"}>{notice.error || notice.success}</p>}
    {!data && !notice && <p role="status">Cargando integraciones…</p>}
    {data && <div className="hf-catalogs">
      <section className="hf-section">
        <h2><KeyRound size={18} aria-hidden="true" /> Guardar credencial</h2>
        <form onSubmit={(event) => { event.preventDefault(); perform("save"); }}>
          <fieldset disabled={Boolean(action)}>
            <label>Servicio<input required maxLength={40} pattern="[a-z0-9][a-z0-9\x2d]{0,39}" placeholder="agencykey" value={form.service}
              onChange={(event) => {
                const service = event.target.value.toLowerCase();
                setForm((current) => ({ ...current, service, kind: service === "agencykey" ? "api-key" : current.kind }));
              }} /></label>
            <label>Tipo<select value={form.kind} disabled={form.service === "agencykey"} onChange={(event) => set("kind", event.target.value)}>
              {Object.entries(kinds).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <label>Nuevo valor<input required type="password" autoComplete="new-password" spellCheck={false} maxLength={4096}
              value={form.value} onChange={(event) => set("value", event.target.value)} /></label>
            <button className="hf-primary" type="submit"><Save size={16} aria-hidden="true" /> {action === "save" ? "Guardando…" : "Guardar o reemplazar"}</button>
          </fieldset>
        </form>
      </section>
      <section className="hf-section">
        <h2><ShieldCheck size={18} aria-hidden="true" /> AgencyKey</h2>
        <dl>
          <dt>Clave API</dt><dd>{agencyKeySaved ? "Configurada" : "Pendiente"}</dd>
          <dt>Última sincronización correcta</dt>
          <dd>{data.sync ? dateTime(data.sync.last_success) : "Sin sincronizaciones correctas"}</dd>
          {data.sync && <><dt>Último día importado</dt><dd>{data.sync.through_day}</dd></>}
        </dl>
        <div className="hf-actions">
          <button type="button" disabled={!agencyKeySaved || Boolean(action)} onClick={() => perform("test")}>{action === "test" ? "Probando…" : "Probar conexión"}</button>
          <button type="button" className="hf-primary" disabled={!agencyKeySaved || Boolean(action)} onClick={() => perform("sync")}>{action === "sync" ? "Sincronizando…" : "Sincronizar ahora"}</button>
        </div>
      </section>
    </div>}
    {data && <section className="hf-section">
      <h2>Credenciales guardadas</h2>
      {data.credentials.length ? <ul>{data.credentials.map(({ service, kind, updated_at }) => <li key={`${service}/${kind}`}>
        <div><strong>{service}</strong> <small>{kinds[kind]}</small></div>
        <div><small>{dateTime(updated_at)}</small> <button type="button" disabled={Boolean(action)} onClick={() => setForm({ service, kind, value: "" })}>Reemplazar</button></div>
      </li>)}</ul> : <p>Sin credenciales guardadas</p>}
    </section>}
  </section>;
}
