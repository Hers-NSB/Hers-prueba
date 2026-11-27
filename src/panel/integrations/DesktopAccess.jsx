import { useState } from "react";
import { AdminError, AdminNotice } from "../adminActions";
import dropperApi from "../dropper/dropperApi";

export default function DesktopAccess() {
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
      <div className="hf-actions"><button type="submit" className="hf-primary hers-desktop-access__submit" disabled={busy}>Cambiar contraseña</button></div>
    </form>
    <AdminNotice id="dropper-access-saved" section="Conectores" message={saved ? "Contraseña cambiada" : ""} />
    <AdminError id="dropper-access" section="Conectores" message={error} />
  </section>;
}
