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
import HERS from "./hers.jsx";
import "./hers.css";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HERS />
  </React.StrictMode>,
);
