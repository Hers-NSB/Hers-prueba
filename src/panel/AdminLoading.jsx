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
