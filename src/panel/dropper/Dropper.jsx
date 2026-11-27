import AdminRefresh from "../AdminRefresh";
import { useEffect, useState } from "react";
import { AdminError } from "../adminActions";
import AdminLoading, { AdminInitialContent } from "../AdminLoading";
import PeriodPicker from "../finanzas/PeriodPicker";
import ActiveBots from "./ActiveBots";
import dropperApi from "./dropperApi";
import "../finanzas/finanzas.css";
import "./dropper.css";

const caracas = { timeZone: "America/Caracas" };
const dateFormat = new Intl.DateTimeFormat("sv-SE", { ...caracas, dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("es-VE", { ...caracas, hour: "2-digit", minute: "2-digit" });

export default function Dropper({ revision }) {
  const [botsCompleted, setBotsCompleted] = useState(null);
  const [dropsCompleted, setDropsCompleted] = useState(null);
  const refreshing = botsCompleted !== revision || dropsCompleted !== revision;
  return <AdminInitialContent loading={botsCompleted === null || dropsCompleted === null} label="Dropper">
  <section className="hf hers-dropper" aria-labelledby="hers-dropper-title">
    <header className="hers-dropper__header">
      <h1 id="hers-dropper-title">Dropper <AdminRefresh busy={refreshing} section="Dropper" /></h1>
    </header>
    <ActiveBots revision={revision} section="Dropper" onLoaded={setBotsCompleted} />
    <DailyDrops revision={revision} onLoaded={setDropsCompleted} />
  </section>
  </AdminInitialContent>;
}

function DailyDrops({ revision, onLoaded }) {
  const [date, setDate] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const current = dateFormat.format(new Date());
  const selected = date ?? current;

  useEffect(() => {
    let controller;
    const trackToday = !date || date === dateFormat.format(new Date());
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
      } finally {
        if (!request.signal.aborted) onLoaded(revision);
      }
    }
    void read();
    const timer = trackToday ? window.setInterval(() => {
      if (!document.hidden && (!date || date === dateFormat.format(new Date()))) void read();
    }, 45_000) : undefined;
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [date, revision, onLoaded]);

  const models = new Map();
  if (report && report.date === (date ?? report.today)) {
    for (const model of report.models ?? []) {
      models.set(model.creator_id, { name: model.creator_name, total: 0, lastAt: 0 });
    }
    for (const drop of report.drops) {
      const model = models.get(drop.creator_id) ?? { name: drop.creator_name, total: 0, lastAt: 0 };
      model.total += drop.automatic + drop.manual;
      model.lastAt = Math.max(model.lastAt, drop.last_at);
      models.set(drop.creator_id, model);
    }
  }

  return <section className="hf-section hers-dropper-daily" aria-labelledby="hers-dropper-daily-title">
    <div className="hf-summary-head">
      <div><h2 id="hers-dropper-daily-title">Resumen diario de Drops</h2><p>Hora de Caracas</p></div>
      <button type="button" className="hf-select-trigger" onClick={() => setDate(null)} disabled={!date}>Hoy</button>
    </div>
    <PeriodPicker label="Fecha" value={{ from: selected }} single onChange={({ from }) => setDate(from)} />
    <AdminError id="dropper-daily" section="Dropper" message={error} />
    {report && report.date === (date ?? report.today) ? models.size ? <div className="hers-dropper-models">
      {[...models].map(([id, model]) => <article key={id} className="hers-dropper-model">
        <h3>{model.name}</h3>
        <span>{model.lastAt ? timeFormat.format(new Date(model.lastAt * 1000)) : "—"}</span>
        <strong>{model.total} / 400</strong>
      </article>)}
    </div> : <p className="hf-empty">No hay modelos configuradas</p> :
      !error && <AdminLoading>Cargando el resumen diario…</AdminLoading>}
  </section>;
}
