import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase, APPLICATIONS_TABLE } from "../lib/supabase";
import AdminRefresh from "./AdminRefresh";
import { AdminInitialContent } from "./AdminLoading";
import { AdminError } from "./adminActions";
import { monthRange } from "./finanzas/finance";
import { loadOverview } from "./finanzas/financeData";
import Overview from "./finanzas/Overview";
import ActiveBots from "./dropper/ActiveBots";

export default function AdminDashboardHome({ revision, notices, onDismiss }) {
  const [completed, setCompleted] = useState(null);
  const [botsCompleted, setBotsCompleted] = useState(null);
  const [report, setReport] = useState(null);
  const [count, setCount] = useState(null);
  const [financeError, setFinanceError] = useState("");
  const [applicationsError, setApplicationsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const range = monthRange();
    const finance = loadOverview(range, signal).then((period) => {
      if (signal.aborted) return;
      setReport({ range, data: { ...period, commissions: [] } });
      setFinanceError("");
    }).catch(() => {
      if (!signal.aborted) setFinanceError("No se pudo consultar el resumen financiero del mes");
    });

    async function loadCount() {
      const result = await supabase.from(APPLICATIONS_TABLE)
        .select("id", { count: "exact", head: true }).abortSignal(signal);
      if (result.error) throw result.error;
      if (signal.aborted) return;
      setCount(result.count);
      setApplicationsError("");
    }
    const applications = loadCount().catch(() => {
      if (!signal.aborted) setApplicationsError("No se pudo consultar el conteo de postulaciones");
    });
    void Promise.all([finance, applications]).then(() => { if (!signal.aborted) setCompleted(revision); });
    return () => controller.abort();
  }, [revision]);

  const dialog = useRef(null);
  const notifications = Object.entries(notices);
  return <AdminInitialContent loading={completed === null || botsCompleted === null} label="Inicio">
  <section className="admin-dashboard-home">
    <div className="admin-dashboard-hero">
      <div><h1>Centro de Administración <AdminRefresh busy={completed !== revision || botsCompleted !== revision} section="Centro de Administración" /></h1></div>
      <div className="admin-dashboard-hero__actions">
        <div className="admin-dashboard-hero__mark"><img src="/HERSl.jpg" alt="HERS" /></div>
        <button type="button" className="admin-notifications-button" aria-haspopup="dialog"
          aria-label={`Notificaciones (${notifications.length})`} onClick={() => dialog.current.showModal()}>
          <Bell size={21} aria-hidden="true" />
          {notifications.length > 0 && <span aria-hidden="true">{notifications.length}</span>}
        </button>
      </div>
    </div>
    <AdminError id="home-finance" section="Inicio" message={financeError} />
    <AdminError id="home-applications" section="Inicio" message={applicationsError} />
    <div className="admin-dashboard-stats">
      <div className="admin-stat-card">
        <span className="admin-stat-card__label">Postulaciones</span>
        <strong>{count ?? "—"}</strong>
        <span>Registros recibidos</span>
      </div>
      <ActiveBots revision={revision} section="Inicio" onLoaded={setBotsCompleted} />
    </div>
    <div className="hf admin-month-overview">
      {report && <Overview {...report} monthly />}
    </div>
    <dialog ref={dialog} className="admin-workspace-notice" aria-labelledby="admin-notifications-title">
      <header>
        <h2 id="admin-notifications-title">Notificaciones</h2>
        <form method="dialog"><button type="submit" aria-label="Cerrar notificaciones"><X size={18} /></button></form>
      </header>
      <div aria-live="polite">
        {notifications.length ? <ul>{notifications.map(([id, { section, message }]) => <li key={id}>
          <span><strong>{section}</strong> · {message}</span>
          <button type="button" aria-label={`Descartar aviso de ${section}`} onClick={() => onDismiss(id)}>
            <X size={17} aria-hidden="true" />
          </button>
        </li>)}</ul> : <p>Sin notificaciones</p>}
      </div>
    </dialog>
  </section>
  </AdminInitialContent>;
}
