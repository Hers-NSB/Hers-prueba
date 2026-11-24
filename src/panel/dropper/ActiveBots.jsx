import "./dropper.css";
import { useEffect, useState } from "react";
import { AdminError } from "../adminActions";
import dropperApi from "./dropperApi";

export default function ActiveBots({ revision, section, onLoaded }) {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let controller;
    function read() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      dropperApi("/active-bots", "GET", undefined, request.signal).then(({ profiles }) => {
        if (request.signal.aborted) return;
        setProfiles(profiles);
        setError("");
      }).catch((failure) => {
        if (!request.signal.aborted) setError(failure.message);
      }).finally(() => { if (!request.signal.aborted) onLoaded(revision); });
    }
    read();
    const timer = window.setInterval(() => { if (!document.hidden) read(); }, 30_000);
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [revision, onLoaded]);

  return <section className="admin-stat-card hers-dropper-bots">
    <AdminError id={`bots-${section}`} section={section} message={error} />
    <span className="admin-stat-card__label">Bots activos de Dropper</span>
    {section === "Inicio" ? <strong className="hers-dropper-online-row">
      {profiles?.length ?? "—"}{Boolean(profiles?.length) && <Online />}
    </strong> : profiles?.length ? <ul>{profiles.map(({ id, creator }) =>
      <li className="hers-dropper-online-row" key={id}>{creator.name} <Online /></li>
    )}</ul> : profiles && <span>Sin bots en línea</span>}
  </section>;
}

function Online() {
  return <span className="hers-dropper-online" role="img" aria-label="En línea" />;
}
