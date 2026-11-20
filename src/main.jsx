/*Importante hacer esto en mi jsx:
Evitar y elminar funciones repetidas.
Crear comentarios del nombre de las secciones del código.
No poner comentarios explicativos.
Eliminar partes del código que no se estén usando.
Evitar y eliminar tener código incoherente.
No usar . final en los textos ni usar el signo ¿
Siempre usa iconos del paquete de emojis de React
*/

import React from "react";
import ReactDOM from "react-dom/client";
import { recoveryPath } from "./auth/recovery.js";
import "./hers.css";
import "./global.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

async function start() {
  const page = window.location.pathname;
  if (page === recoveryPath || page === recoveryPath + "/") {
    document.title = "Restablecer contraseña · HERS";
    const { default: PasswordRecovery, openRecovery } = await import("./auth/PasswordRecovery.jsx");
    root.render(<p className="hers-recovery" role="status">Verificando enlace…</p>);
    const session = await openRecovery();
    root.render(<PasswordRecovery session={session} />);
    return;
  }

  const { default: HERS } = await import("./hers.jsx");
  root.render(<React.StrictMode><HERS /></React.StrictMode>);
}

start();
