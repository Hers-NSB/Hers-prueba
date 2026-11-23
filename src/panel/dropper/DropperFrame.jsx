import { useLayoutEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import AdminLoading from "../AdminLoading.jsx";
import "./dropper.css";

export default function DropperFrame({ view, title }) {
  const frame = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    async function respond(event) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow ||
          event.data?.type !== "hers-dropper-session" || event.ports.length !== 1) return;
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

  return <>
    {!loaded && <AdminLoading>Cargando {title}…</AdminLoading>}
    <iframe ref={frame} className="hers-dropper-frame" title={title} src={`/api/admin/dropper/view/${view}`}
      onLoad={() => setLoaded(true)} hidden={!loaded} />
  </>;
}
