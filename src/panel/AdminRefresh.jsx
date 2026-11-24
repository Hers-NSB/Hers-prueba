import { RefreshCw } from "lucide-react";

export default function AdminRefresh({ busy, section }) {
  return busy ? <RefreshCw className="hf-refreshing" size={20} role="status" aria-label={`Actualizando ${section}`} /> : null;
}
