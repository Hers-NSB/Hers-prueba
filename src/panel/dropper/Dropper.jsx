import { useEffect, useState } from "react";
import { AdminError } from "../adminActions";
import AdminLoading from "../AdminLoading";
import PeriodPicker from "../finanzas/PeriodPicker";
import ActiveBots from "./ActiveBots";
import dropperApi from "./dropperApi";
import "../finanzas/finanzas.css";
import "./dropper.css";

const caracas = { timeZone: "America/Caracas" };
const dateFormat = new Intl.DateTimeFormat("sv-SE", { ...caracas, dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("es-VE", { ...caracas, hour: "2-digit", minute: "2-digit" });

function postCounts(automatic, manual) {
  const total = automatic + manual;
  return `${total} ${total === 1 ? "post" : "posts"} · ${automatic} ${automatic === 1 ? "automático" : "automáticos"} · ${manual} ${manual === 1 ? "manual" : "manuales"}`;
}

export default function Dropper({ revision }) {
  const [tab, setTab] = useState("Drops");
  return <section className="hf hers-dropper" aria-labelledby="hers-dropper-title">
    <header className="hers-dropper__header">
      <h1 id="hers-dropper-title">Dropper</h1>
    </header>
    <ActiveBots revision={revision} section="Dropper" />
    <nav className="hf-tabs" aria-label="Secciones de Dropper">
      {["Drops", "Ajustes"].map((name) => <button type="button" key={name}
        aria-pressed={name === tab} onClick={() => setTab(name)}>{name}</button>)}
    </nav>
    {tab === "Drops" ? <DailyDrops revision={revision} /> : <DesktopAccess />}
  </section>;
}

function DailyDrops({ revision }) {
  const [date, setDate] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const current = dateFormat.format(new Date());
  const selected = date ?? current;

  useEffect(() => {
    let controller;
    async function read() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const data = await dropperApi(date ? `/drops?date=${encodeURIComponent(date)}` : "/drops", "GET", undefined, request.signal);
        if (request.signal.aborted) return;
        setReport(data);
        setError("");
      } catch (failure) {
        if (!request.signal.aborted) setError(failure.message);
      }
    }
    void read();
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 45_000);
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [date, revision]);

  const models = new Map();
  for (const drop of report?.date === selected ? report.drops : []) {
    const model = models.get(drop.creator_id) ?? { name: drop.creator_name, drops: [], automatic: 0, manual: 0 };
    model.drops.push(drop);
    model.automatic += drop.automatic;
    model.manual += drop.manual;
    models.set(drop.creator_id, model);
  }

  return <section className="hf-section hers-dropper-daily" aria-labelledby="hers-dropper-daily-title">
    <div className="hf-summary-head">
      <div><h2 id="hers-dropper-daily-title">Resumen diario de Drops</h2><p>Hora de Caracas</p></div>
      <button type="button" className="hf-select-trigger" onClick={() => setDate(null)} disabled={!date}>Hoy</button>
    </div>
    <PeriodPicker label="Fecha" value={{ from: selected }} single onChange={({ from }) => setDate(from)} />
    <AdminError id="dropper-daily" section="Dropper" message={error} />
    {report?.date === selected ? models.size ? [...models].map(([id, model]) => <article key={id} className="hers-dropper-model">
      <h3>{model.name}</h3>
      <p>{model.drops.length} {model.drops.length === 1 ? "Drop" : "Drops"} · {postCounts(model.automatic, model.manual)}</p>
      <ul>{model.drops.map((drop) => <li key={drop.drop_id}>
        {timeFormat.format(new Date(drop.last_at * 1000))} · {postCounts(drop.automatic, drop.manual)}
      </li>)}</ul>
    </article>) : <p className="hf-empty">No hay publicaciones confirmadas para esta fecha</p> :
      !error && <AdminLoading>Cargando el resumen diario…</AdminLoading>}
  </section>;
}

function DesktopAccess() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function change(event) {
    event.preventDefault();
    if (busy || !window.confirm("¿Cambiar la contraseña de las apps? Se pedirá al volver a descargar las configuraciones.")) return;
    const form = event.currentTarget;
    const code = new FormData(form).get("code");
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await dropperApi("/access", "POST", { code });
      form.reset();
      setSaved(true);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="hf-section">
    <h2>Acceso de las apps</h2>
    <form className="hf-form" onSubmit={change}>
      <label>Nueva contraseña<input name="code" type="password" required minLength={8} maxLength={256} autoComplete="new-password" /></label>
      <div className="hf-actions"><button type="submit" className="hf-primary" disabled={busy}>Cambiar contraseña</button></div>
    </form>
    {saved && <p role="status">Contraseña cambiada</p>}
    <AdminError id="dropper-access" section="Dropper" message={error} />
  </section>;
}
