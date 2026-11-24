import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AdminError } from "../adminActions";
import AdminLoading from "../AdminLoading.jsx";
import "./dropper.css";

export default function DropperFrame({ view, title, revision, onLoaded, hidden = false }) {
  const frame = useRef(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const initialRevision = useRef(revision);
  const completedRevision = useRef(-1);
  const [height, setHeight] = useState(192);

  useLayoutEffect(() => {
    async function respond(event) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "hers-dropper-size" && Number.isFinite(event.data.height)) {
        setHeight(Math.min(100_000, Math.max(96, Math.ceil(event.data.height))));
        return;
      }
      if (event.data?.type === "hers-dropper-ready") {
        setReady(true);
        const finished = event.data.revision ?? initialRevision.current;
        if (Number.isSafeInteger(finished) && finished > completedRevision.current) {
          completedRevision.current = finished;
          onLoaded(finished);
        }
        return;
      }
      if (event.data?.type === "hers-dropper-error" && typeof event.data.message === "string") {
        setMessage(event.data.message.slice(0, 1500));
        return;
      }
      if (event.data?.type !== "hers-dropper-session" || event.ports.length !== 1) return;
      const [port] = event.ports;
      try {
        const { data, error } = await supabase.auth.getSession();
        port.postMessage({ token: error ? null : data?.session?.access_token });
      } catch {
        port.postMessage({ token: null });
      } finally {
        port.close();
      }
    }
    window.addEventListener("message", respond);
    return () => window.removeEventListener("message", respond);
  }, [onLoaded]);

  useEffect(() => {
    if (ready && revision !== initialRevision.current) {
      frame.current?.contentWindow?.postMessage({ type: "hers-dropper-refresh", revision }, window.location.origin);
    }
  }, [ready, revision]);

  return <>
    <AdminError id={`connector-${view}`} section="Conectores" message={message} />
    {!loaded && !hidden && <AdminLoading>Cargando {title}…</AdminLoading>}
    <iframe ref={frame} className="hers-dropper-frame" title={title} src={`/api/admin/dropper/view/${view}`}
      style={{ height }} onLoad={() => setLoaded(true)} hidden={!loaded || hidden} />
  </>;
}
