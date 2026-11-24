import { useEffect, useState } from "react";
import { AdminError } from "../adminActions";
import dropperApi from "./dropperApi";

export default function ActiveBots({ revision, section }) {
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
      });
    }
    read();
    const timer = window.setInterval(() => { if (!document.hidden) read(); }, 30_000);
    return () => { window.clearInterval(timer); controller?.abort(); };
  }, [revision]);

  return <section className="admin-stat-card hers-dropper-bots">
    <AdminError id={`bots-${section}`} section={section} message={error} />
    <span className="admin-stat-card__label">Bots activos de Dropper</span>
    <strong>{profiles?.length ?? "—"}</strong>
    {profiles?.length ? <ul>{profiles.map(({ id, creator }) =>
      <li key={id}>{creator.name}{creator.username ? ` · @${creator.username}` : ""}</li>
    )}</ul> : profiles && <span>Sin bots en línea</span>}
  </section>;
}
