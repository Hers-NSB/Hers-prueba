import { Download } from "lucide-react";
import DropperFrame from "./DropperFrame.jsx";

const windowsDownload = "https://github.com/Hers-NSB/Dropper/releases/latest/download/HERS-Dropper.exe";

export default function Dropper() {
  return (
    <section className="hers-dropper" aria-labelledby="hers-dropper-title">
      <header className="hers-dropper__header">
        <h1 id="hers-dropper-title">Dropper</h1>
        <a href={windowsDownload}><Download size={16} aria-hidden="true" /> Descargar para Windows</a>
      </header>
      <DropperFrame view="operations" title="Drops y ajustes de Dropper" />
    </section>
  );
}
