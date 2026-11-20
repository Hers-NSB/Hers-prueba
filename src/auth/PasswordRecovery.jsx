import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { recoveryPath, readRecoveryTokens } from "./recovery.js";

const expired = "El enlace no es válido o expiró. Solicita uno nuevo desde el acceso de Administrador";

export function openRecovery() {
  const tokens = readRecoveryTokens(window.location.hash);
  window.history.replaceState(null, "", recoveryPath);
  if (!tokens) return Promise.resolve(null);
  const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      storageKey: "hers-password-recovery",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client.auth.setSession(tokens)
    .then(({ data, error }) => !error && data.session ? client : null)
    .catch(() => null);
}

export default function PasswordRecovery({ session }) {
  const [state, setState] = useState("ready");
  const [notice, setNotice] = useState("");

  async function save(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = fields.get("password");
    if (password !== fields.get("confirm")) {
      setNotice("Las contraseñas no coinciden");
      return;
    }
    setState("saving");
    setNotice("");
    try {
      const { error } = await session.auth.updateUser({ password });
      if (error) {
        setNotice(error.code === "weak_password" ? "Elige una contraseña más segura"
          : error.code === "same_password" ? "Elige una contraseña diferente"
          : "No se pudo guardar la contraseña. Si el enlace expiró, solicita uno nuevo");
        setState("ready");
        return;
      }
      setState("complete");
      await session.auth.signOut({ scope: "local" }).catch(() => {});
    } catch {
      setNotice("No se pudo conectar con Supabase. Intenta de nuevo");
      setState("ready");
    }
  }

  return <main className="hers-recovery">
    <section className="hers-recovery__card">
      <h1>Crear o restablecer contraseña</h1>
      {!session && <p role="alert">{expired}</p>}
      {state === "complete" && <p role="status">Contraseña guardada. Ya puedes entrar al panel con tu correo y la nueva contraseña</p>}
      {session && state !== "complete" && <form className="auth-form" onSubmit={save}>
        <label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
        <label>Confirmar contraseña<input name="confirm" type="password" autoComplete="new-password" minLength={8} required /></label>
        {notice && <p className="field-error" role="alert">{notice}</p>}
        <button className="btn btn--growth btn--full" disabled={state === "saving"}>
          {state === "saving" ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>}
      <a href="/?acceso=administrador">Volver al acceso de Administrador</a>
    </section>
  </main>;
}
