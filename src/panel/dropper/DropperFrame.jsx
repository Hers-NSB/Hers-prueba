import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { AdminError } from "../adminActions";
import AdminLoading from "../AdminLoading.jsx";
import "./dropper.css";

export default function DropperFrame({ view, title, revision, hidden = false }) {
  const frame = useRef(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    async function respond(event) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
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
  }, []);

  useEffect(() => {
    if (loaded && revision) frame.current?.contentWindow?.postMessage({ type: "hers-dropper-refresh" }, window.location.origin);
  }, [loaded, revision]);

  return <>
    <AdminError id="connector-bots" section="Conectores" message={message} />
    {!loaded && !hidden && <AdminLoading>Cargando {title}…</AdminLoading>}
    <iframe ref={frame} className="hers-dropper-frame" title={title} src={`/api/admin/dropper/view/${view}`}
      onLoad={() => setLoaded(true)} hidden={!loaded || hidden} />
  </>;
}
