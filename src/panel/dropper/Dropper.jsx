import { CircleCheck, CircleHelp, CircleX, History, VideoOff, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AdminRefresh from "../AdminRefresh";
import { useEffect, useRef, useState } from "react";
import { AdminError } from "../adminActions";
import AdminLoading, { AdminInitialContent } from "../AdminLoading";
import PeriodPicker from "../finanzas/PeriodPicker";
import ActiveBots from "./ActiveBots";
import ManualDrops from "./ManualDrops";
import dropperApi from "./dropperApi";
import "../finanzas/finanzas.css";
import "./dropper.css";

const caracas = { timeZone: "America/Caracas" };
const dateFormat = new Intl.DateTimeFormat("sv-SE", { ...caracas, dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("es-VE", { ...caracas, hour: "2-digit", minute: "2-digit" });

export default function Dropper({ revision }) {
  const [tab, setTab] = useState("Drops");
  const [botsCompleted, setBotsCompleted] = useState(null);
  const [dropsCompleted, setDropsCompleted] = useState(null);
  const refreshing = botsCompleted !== revision || (tab === "Drops" && dropsCompleted !== revision);
  return <AdminInitialContent loading={botsCompleted === null || dropsCompleted === null} label="Dropper">
  <section className="hf hers-dropper" aria-labelledby="hers-dropper-title">
    <header className="hers-dropper__header">
      <h1 id="hers-dropper-title">Dropper <AdminRefresh busy={refreshing} section="Dropper" /></h1>
    </header>
    <ActiveBots revision={revision} section="Dropper" onLoaded={setBotsCompleted} />
    <nav className="hf-tabs" aria-label="Secciones de Dropper">
      {["Drops", "Drops manuales"].map((name) => <button type="button" key={name}
        aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}
    </nav>
    {tab === "Drops" ? <DailyDrops revision={revision} onLoaded={setDropsCompleted} /> : <ManualDrops revision={revision} />}
  </section>
  </AdminInitialContent>;
}

function DailyDrops({ revision, onLoaded }) {
  const [date, setDate] = useState(null);
  const [historyModel, setHistoryModel] = useState(null);
  const history = useRef(null);
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
        <button type="button" className="hers-dropper-history-button" aria-label={`Historial de ${model.name}`}
          onClick={() => { setHistoryModel(id); history.current.showModal(); }}>
          <History size={17} aria-hidden="true" />
        </button>
      </article>)}
    </div> : <p className="hf-empty">No hay modelos configuradas</p> :
      !error && <AdminLoading>Cargando el resumen diario…</AdminLoading>}
    {report?.monthly && <MonthlyDrops today={report.today} monthly={report.monthly} />}
    <dialog ref={history} className="hf-dialog hers-dropper-history" aria-labelledby="dropper-history-title">
      <div className="hf-summary-head">
        <h2 id="dropper-history-title">Historial de {models.get(historyModel)?.name}</h2>
        <form method="dialog"><button type="submit" aria-label="Cerrar historial"><X size={17} /></button></form>
      </div>
      <p>{selected}</p>
      <DropHistory drops={report?.drops.filter((drop) => drop.creator_id === historyModel) ?? []} />
    </dialog>
  </section>;
}

function DropHistory({ drops }) {
  if (!drops.length) return <p className="hf-empty">Sin drops registrados</p>;
  return <ul>{drops.map(({ drop_id, automatic, manual, last_at, recording_completed, scheduled }) => {
    const [Icon, label] = scheduled ? [VideoOff, "Drop programado sin grabación"]
      : recording_completed === 1 ? [CircleCheck, "Grabación completa"]
      : recording_completed === 0 ? [CircleX, "Grabación incompleta"] : [CircleHelp, "Grabación sin confirmar"];
    return <li key={drop_id}>
      <time dateTime={new Date(last_at * 1000).toISOString()}>{timeFormat.format(new Date(last_at * 1000))}</time>
      <span>{automatic + manual} publicaciones</span>
      <span className="hers-dropper-recording" title={label}>
        <Icon size={19} role="img" aria-label={label} />
      </span>
    </li>;
  })}</ul>;
}

function MonthlyDrops({ today, monthly }) {
  const [year, month] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totals = new Map(monthly.map(({ date, total }) => [Number(date.slice(-2)), total]));
  const points = Array.from({ length: lastDay }, (_, index) => ({ day: index + 1, total: totals.get(index + 1) ?? 0 }));
  const label = new Intl.DateTimeFormat("es-VE", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  const axis = { fill: "var(--hf-muted)", fontSize: 11 };
  return <div className="hers-dropper-monthly">
    <h3>Drops por día · {label}</h3>
    <div className="hf-chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={points} accessibilityLayer aria-label={`Drops por día de ${label}`}>
          <CartesianGrid stroke="var(--hf-line)" vertical={false} />
          <XAxis dataKey="day" tick={axis} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} width="auto" tick={axis} />
          <Tooltip labelFormatter={(day) => `Día ${day}`} contentStyle={{ background: "var(--hf-bg)" }} />
          <Bar dataKey="total" name="Drops" fill="var(--hf-accent)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>;
}
