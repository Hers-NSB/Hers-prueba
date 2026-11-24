import { useEffect, useState } from "react";
import { supabase, APPLICATIONS_TABLE } from "../lib/supabase";
import AdminLoading from "./AdminLoading";
import { AdminError } from "./adminActions";
import { monthRange } from "./finanzas/finance";
import { loadOverview } from "./finanzas/financeData";
import Overview from "./finanzas/Overview";
import ActiveBots from "./dropper/ActiveBots";

export default function AdminDashboardHome({ revision }) {
  const [report, setReport] = useState(null);
  const [count, setCount] = useState(null);
  const [financeError, setFinanceError] = useState("");
  const [applicationsError, setApplicationsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const range = monthRange();
    loadOverview(range, signal).then((period) => {
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
    loadCount().catch(() => {
      if (!signal.aborted) setApplicationsError("No se pudo consultar el conteo de postulaciones");
    });
    return () => controller.abort();
  }, [revision]);

  return <section className="admin-dashboard-home">
    <div className="admin-dashboard-hero">
      <div><h1>Centro de Administración</h1></div>
      <div className="admin-dashboard-hero__mark"><img src="/HERSl.jpg" alt="HERS" /></div>
    </div>
    <AdminError id="home-finance" section="Inicio" message={financeError} />
    <AdminError id="home-applications" section="Inicio" message={applicationsError} />
    <div className="admin-dashboard-stats">
      <div className="admin-stat-card">
        <span className="admin-stat-card__label">Postulaciones</span>
        <strong>{count ?? "—"}</strong>
        <span>Registros recibidos</span>
      </div>
      <ActiveBots revision={revision} section="Inicio" />
    </div>
    <div className="hf admin-month-overview">
      {report ? <Overview {...report} monthly /> : financeError ? null : <AdminLoading>Cargando el resumen del mes…</AdminLoading>}
    </div>
  </section>;
}
