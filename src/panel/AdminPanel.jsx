/*Importante hacer esto en mi jsx:
Evitar y elminar funciones repetidas.
Crear comentarios del nombre de las secciones del código.
No poner comentarios explicativos.
Eliminar partes del código que no se estén usando.
Evitar y eliminar tener código incoherente.
No usar . final en los textos ni usar el signo ¿
Siempre usa iconos del paquete de emojis de React
*/

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./adminPanel.css";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Users,
} from "lucide-react";
import Historias from "./Historias/historias.jsx";
import Postulaciones from "./Postulaciones/postulaciones.jsx";
import Finanzas from "./finanzas/finanzas.jsx";
import Integrations from "./integrations/Integrations.jsx";
import { supabase, APPLICATIONS_TABLE, adminLogout } from "../lib/supabase";

export default function AdminPanel({ onClose }) {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [applicationCount, setApplicationCount] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadCount = async () => {
      const { count } = await supabase
        .from(APPLICATIONS_TABLE)
        .select("id", { count: "exact", head: true });
      if (mounted) setApplicationCount(count || 0);
    };
    loadCount();
    return () => {
      mounted = false;
    };
  }, [activeSection]);

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

  const goTo = (section) => setActiveSection(section);
  const logout = async () => {
    await adminLogout();
    onClose();
  };

  return createPortal(
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
            <button
              className={`admin-nav-item ${activeSection === "dashboard" ? "is-active" : ""}`}
              onClick={() => goTo("dashboard")}
            >
              <Home size={18} />
              <span>Inicio</span>
            </button>
            <button
              className={`admin-nav-item ${activeSection === "applications" ? "is-active" : ""}`}
              onClick={() => goTo("applications")}
            >
              <ClipboardList size={18} />
              <span>Postulaciones</span>
            </button>
            <button
              className={`admin-nav-item ${activeSection === "stories" ? "is-active" : ""}`}
              onClick={() => goTo("stories")}
            >
              <BookOpen size={18} />
              <span>Historias</span>
            </button>
            <button className="admin-nav-item" disabled>
              <Users size={18} />
              <span>IA</span>
              <small>Próximo</small>
            </button>
            <button
              className={`admin-nav-item ${activeSection === "finance" ? "is-active" : ""}`}
              onClick={() => goTo("finance")}
            >
              <BarChart3 size={18} />
              <span>Finanzas</span>
            </button>
            <button
              className={`admin-nav-item ${activeSection === "integrations" ? "is-active" : ""}`}
              onClick={() => goTo("integrations")}
            >
              <Plug size={18} />
              <span>Integraciones</span>
            </button>
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
          {activeSection === "dashboard" && (
            <AdminDashboardHome applicationCount={applicationCount} />
          )}

          {activeSection === "applications" && (
            <div className="admin-module-view">
              <Postulaciones onBack={() => goTo("dashboard")} />
            </div>
          )}

          {activeSection === "stories" && (
            <div className="admin-module-view">
              <Historias embedded onBack={() => goTo("dashboard")} />
            </div>
          )}

          {activeSection === "integrations" && (
            <div className="admin-module-view">
              <Integrations />
            </div>
          )}

          {activeSection === "finance" && (
            <div className="admin-module-view">
              <Finanzas onBack={() => goTo("dashboard")} />
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body,
  );
}

function AdminDashboardHome({ applicationCount }) {
  return (
    <section className="admin-dashboard-home">
      <div className="admin-dashboard-hero">
        <div>
          <span className="admin-eyebrow">HERS AGENCY · ADMINISTRACIÓN</span>
          <h1>Centro de Administración</h1>
          <p>
            Gestiona las áreas internas de HERS desde un único espacio seguro.
            Selecciona una función para comenzar.
          </p>
        </div>
        <div className="admin-dashboard-hero__mark">
          <img src="/HERSl.jpg" alt="HERS" />
        </div>
      </div>

      <div className="admin-dashboard-stats">
        <div className="admin-stat-card">
          <span className="admin-stat-card__label">Postulaciones</span>
          <strong>{applicationCount}</strong>
          <span>Registros recibidos</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-card__label">Historias</span>
          <strong>Editor</strong>
          <span>Gestión de contenido activa</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-card__label">Estado</span>
          <strong>Seguro</strong>
          <span>Sesión de administrador activa</span>
        </div>
      </div>
    </section>
  );
}
