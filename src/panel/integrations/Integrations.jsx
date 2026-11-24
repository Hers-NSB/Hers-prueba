import { useEffect, useRef, useState } from "react";
import { KeyRound, Plus, Save, ShieldCheck } from "lucide-react";
import { AdminError } from "../adminActions";
import AdminLoading from "../AdminLoading.jsx";
import DropperFrame from "../dropper/DropperFrame.jsx";
import callApi from "./connectorApi";
import { usd } from "../finanzas/finance";
import "../finanzas/finanzas.css";
import "./integrations.css";

const kinds = { "api-key": "Clave API", token: "Token", password: "Contraseña de servicio" };
const blank = { service: "agencykey", kind: "api-key", value: "" };
const dateTime = (date) => new Date(date).toLocaleString("es-VE");

export default function Integrations({ revision }) {
  const [bots, setBots] = useState(false);
  return <section className="hf hers-integrations" aria-labelledby="hers-integrations-title">
    <header className="hf-header">
      <div><h1 id="hers-integrations-title">Conectores</h1><p>Conexiones y credenciales de HERS</p></div>
    </header>
    <nav className="hf-tabs" aria-label="Secciones de Conectores">
      <button type="button" aria-pressed={!bots} onClick={() => setBots(false)}>Servicios</button>
      <button type="button" aria-pressed={bots} onClick={() => setBots(true)}>Bots</button>
    </nav>
    {bots ? <DropperFrame view="bots" title="Bots y sesión compartida de Dropper" revision={revision} /> : <Services revision={revision} />}
  </section>;
}

function Services({ revision }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [directoryConnected, setDirectoryConnected] = useState(null);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);
  const directoryPopup = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      callApi("", "GET", undefined, controller.signal),
      callApi("/agencykey-directory", "GET", undefined, controller.signal),
    ]).then(([status, directory]) => {
      if (controller.signal.aborted) return;
      if (status.status === "fulfilled") setData(status.value);
      if (directory.status === "fulfilled") setDirectoryConnected(directory.value.connected);
      const messages = [status, directory].filter((result) => result.status === "rejected")
        .map((result) => result.reason.message);
      setNotice((current) => messages.length ? { error: [...new Set(messages)].join(" · ") }
        : current?.error ? null : current);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    function complete(event) {
      if (event.origin !== window.location.origin || event.source !== directoryPopup.current ||
          event.data?.type !== "hers-agencykey-directory") return;
      if (event.data.connected) setDirectoryConnected(true);
      setNotice(event.data.connected
        ? { success: "Directorio de AgencyKey autorizado" }
        : { error: "No se pudo autorizar el directorio de AgencyKey" });
    }
    window.addEventListener("message", complete);
    return () => window.removeEventListener("message", complete);
  }, []);

  async function connectDirectory() {
    if (action) return;
    const popup = window.open("about:blank", "hers-agencykey-directory", "popup,width=640,height=700");
    directoryPopup.current = popup;
    setAction("directory");
    try {
      const { authorize } = await callApi("/agencykey-directory/connect", "POST");
      if (popup) popup.location.replace(authorize);
      else window.location.assign(authorize);
    } catch (error) {
      popup?.close();
      setNotice({ error: error.message });
    } finally {
      setAction("");
    }
  }

  async function perform(operation) {
    setAction(operation);
    setNotice(null);
    setFormError("");
    let saved = false;
    try {
      if (operation === "save") {
        await callApi("/credential", "PUT", form);
        saved = true;
        setForm(null);
        setNotice({ success: "Credencial guardada" });
      } else if (operation === "test") {
        const result = await callApi(`/${operation}`, "POST");
        const label = "Conexión correcta";
        const total = typeof result.netTotal === "number" ? ` · Neto ${usd(result.netTotal)}` : "";
        setNotice({ success: `${label} · ${result.day} · ${result.creators} modelos${total}` });
      }
      setData(await callApi());
    } catch (error) {
      if (operation === "save" && !saved) setFormError(error.message);
      else setNotice({ error: saved ? "Credencial guardada. No se pudo actualizar el estado" : error.message });
    } finally { setAction(""); }
  }

  const agencyKeySaved = data?.credentials.some(({ service, kind }) => service === "agencykey" && kind === "api-key");
  const busy = Boolean(action);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const edit = (service = blank.service, kind = blank.kind) => {
    setFormError("");
    setForm({ service, kind, value: "" });
  };
  const close = () => { if (!busy) setForm(null); };

  return <section aria-label="Servicios">
    <AdminError id="connector-services" section="Conectores" message={notice?.error} />
    {notice?.success && <p className="hf-notice" role="status">{notice.success}</p>}
    {!data && !notice && <AdminLoading>Cargando Conectores…</AdminLoading>}
    {data && <>
      <section className="hf-section hers-integration-card">
        <div className="hf-summary-head">
          <h2><ShieldCheck size={18} aria-hidden="true" /> AgencyKey</h2>
          <span className="hers-integration-state" data-ready={Boolean(agencyKeySaved)}>
            {agencyKeySaved ? "Clave configurada" : "Clave pendiente"}
          </span>
        </div>
        <dl>
          <div><dt>Última sincronización correcta</dt>
            <dd>{data.sync ? dateTime(data.sync.last_success) : "Sin sincronizaciones correctas"}</dd></div>
          {data.sync && <div><dt>Último día importado</dt><dd>{data.sync.through_day}</dd></div>}
        </dl>
        <div className="hf-actions">
          {directoryConnected && <span role="status">Directorio de AgencyKey autorizado</span>}
          {directoryConnected === false && <button type="button" disabled={busy} onClick={connectDirectory}>Autorizar directorio de AgencyKey</button>}
          {agencyKeySaved ? <>
            <button type="button" disabled={busy} onClick={() => perform("test")}>{action === "test" ? "Probando…" : "Probar conexión"}</button>
          </> : <button type="button" className="hf-primary" disabled={busy} onClick={() => edit()}>Configurar AgencyKey</button>}
        </div>
      </section>
      <section className="hf-section hers-integration-card">
        <div className="hf-summary-head">
          <h2><KeyRound size={18} aria-hidden="true" /> Credenciales guardadas</h2>
          <button type="button" disabled={busy} onClick={() => edit()}><Plus size={16} aria-hidden="true" /> Agregar credencial</button>
        </div>
        {data.credentials.length ? <ul>{data.credentials.map(({ service, kind, updated_at }) => <li key={`${service}/${kind}`}>
          <div><strong>{service === "agencykey" ? "AgencyKey" : service}</strong><small>{kinds[kind]}</small></div>
          <div><small>{dateTime(updated_at)}</small><button type="button" disabled={busy} onClick={() => edit(service, kind)}>Reemplazar</button></div>
        </li>)}</ul> : <p className="hf-empty">Sin credenciales guardadas</p>}
      </section>
    </>}
    {form && <dialog className="hf-dialog" aria-labelledby="hers-credential-title"
      ref={(el) => { if (el && !el.open) el.showModal(); }} onCancel={(event) => { event.preventDefault(); close(); }}>
      <form onSubmit={(event) => { event.preventDefault(); perform("save"); }}>
        <h2 id="hers-credential-title">Guardar credencial</h2>
        <fieldset className="hf-form hers-integration-form" disabled={busy}>
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
        </fieldset>
        {formError && <p className="hf-notice" role="alert">{formError}</p>}
        <div className="hf-actions">
          <button type="button" disabled={busy} onClick={close}>Cancelar</button>
          <button className="hf-primary" type="submit" disabled={busy}><Save size={16} aria-hidden="true" /> {busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </dialog>}
  </section>;
}
