import "./adminLoading.css";

export default function AdminLoading({ children, fullscreen = false }) {
  return (
    <div
      className={`admin-loading${fullscreen ? " admin-loading--fullscreen" : ""}`}
      role="status"
    >
      <span className="admin-loading__spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AdminInitialContent({ children, loading, label }) {
  return <div className="admin-initial-content" aria-busy={loading}>
    {loading && <AdminLoading>Cargando {label}…</AdminLoading>}
    <div className={loading ? "admin-initial-content__pending" : undefined} inert={loading ? "" : undefined} aria-hidden={loading || undefined}>
      {children}
    </div>
  </div>;
}
