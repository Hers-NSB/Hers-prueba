import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FaTelegram } from "react-icons/fa";
import AdminLoading from "./AdminLoading.jsx";
import "./adminPanel.css";
import {
  BarChart3,
  ClipboardList,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  RefreshCw,
  X,
} from "lucide-react";
import { adminLogout } from "../lib/supabase";
import { AdminActions } from "./adminActions";
import AdminDashboardHome from "./AdminDashboardHome";

const Postulaciones = lazy(() => import("./Postulaciones/postulaciones.jsx"));
const Finanzas = lazy(() => import("./finanzas/finanzas.jsx"));
const Integrations = lazy(() => import("./integrations/Integrations.jsx"));
const Dropper = lazy(() => import("./dropper/Dropper.jsx"));
const sections = [
  ["dashboard", "Inicio", Home],
  ["applications", "Postulaciones", ClipboardList],
  ["finance", "Finanzas", BarChart3],
  ["dropper", "Dropper", FaTelegram],
  ["integrations", "Conectores", Plug],
];

export default function AdminPanel({ onClose }) {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [revisions, setRevisions] = useState({});
  const [financeRequested, setFinanceRequested] = useState(false);
  const [errors, setErrors] = useState({});
  const [handlers] = useState(() => new Map());

  function refresh(section) {
    if (section === activeSection && handlers.has(section)) {
      handlers.get(section)?.();
      return;
    }
    if (section === "finance") setFinanceRequested(true);
    setRevisions((current) => ({ ...current, [section]: (current[section] ?? 0) + 1 }));
    setActiveSection(section);
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0)
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const revision = revisions[activeSection] ?? 0;
  const sectionName = sections.find(([id]) => id === activeSection)[1];
  const logout = async () => {
    await adminLogout();
    onClose();
  };

  return createPortal(
    <AdminActions.Provider value={{ handlers, setErrors }}>
    <div
      className="admin-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Panel de administración"
    >
      <div
        className={`admin-shell${sidebarCollapsed ? " admin-shell--collapsed" : ""}`}
      >
        <aside className="admin-sidebar">
          <div className="admin-sidebar__brand">
            <div className="admin-sidebar__logo">
              <img src="/HERSl.jpg" alt="HERS" />
            </div>
            <div className="admin-sidebar__brand-copy">
              <strong>HERS</strong>
              <span>Administración</span>
            </div>
            <button
              type="button"
              className="admin-sidebar__toggle-button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={
                sidebarCollapsed ? "Expandir navegación" : "Contraer navegación"
              }
              title={
                sidebarCollapsed ? "Expandir navegación" : "Contraer navegación"
              }
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
          </div>

          <nav className="admin-sidebar__nav" aria-label="Administración HERS">
            {sections.map(([id, label, Icon]) => <div key={id} className="admin-nav-row">
              <button type="button" className={`admin-nav-item ${activeSection === id ? "is-active" : ""}`}
                onClick={() => setActiveSection(id)} aria-label={label} aria-current={activeSection === id ? "page" : undefined}>
                <Icon size={18} aria-hidden="true" /><span>{label}</span>
              </button>
              <button type="button" className="admin-nav-refresh" onClick={() => refresh(id)}
                aria-label={`Actualizar ${label}`} title={`Actualizar ${label}`}>
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            </div>)}
          </nav>

          <div className="admin-sidebar__footer">
            <div className="admin-sidebar__secure">PRIVATE · SECURE · HERS</div>
            <button
              className="admin-nav-logout"
              onClick={logout}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={17} />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </aside>

        <main className="admin-workspace">
          {Object.keys(errors).length > 0 && <section className="admin-workspace-notice" aria-label="Notificaciones de errores">
            <h2>Notificaciones de errores</h2>
            <ul aria-live="polite">{Object.entries(errors).map(([id, { section, message }]) => <li key={id}>
              <span><strong>{section}</strong> · {message}</span>
              <button type="button" aria-label={`Descartar aviso de ${section}`} onClick={() => setErrors((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              })}><X size={17} aria-hidden="true" /></button>
            </li>)}</ul>
          </section>}
          <Suspense fallback={<AdminLoading>Cargando {sectionName}…</AdminLoading>}>
            {activeSection === "dashboard" ? <AdminDashboardHome revision={revision} /> :
              <div className="admin-module-view">
                {activeSection === "applications" && <Postulaciones revision={revision} />}
                {activeSection === "finance" && <Finanzas refreshRequested={financeRequested} clearRefresh={setFinanceRequested} />}
                {activeSection === "dropper" && <Dropper revision={revision} />}
                {activeSection === "integrations" && <Integrations revision={revision} />}
              </div>}
          </Suspense>
        </main>
      </div>
    </div>
    </AdminActions.Provider>,
    document.body,
  );
}
