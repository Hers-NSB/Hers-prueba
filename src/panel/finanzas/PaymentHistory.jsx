import { useEffect, useId, useState } from "react";
import { supabase } from "../../lib/supabase";
import { usd } from "./finance";

export default function PaymentHistory({ type, person, onConfirmed }) {
  const id = useId();
  const [records, setRecords] = useState([]);
  const [error, setError] = useState("");
  const [revision, reload] = useState(0);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const field = type === "modelShare" ? "creator_id" : "member_id";
    const readHistory = async () => {
      const rows = [];
      const pageSize = 500;
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await supabase.from("finance_payments")
          .select("id, period_start, period_end, amount, paid_at").eq(field, person)
          .order("period_start", { ascending: false }).range(start, start + pageSize - 1).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (error) { setError("No se pudo consultar el historial de pagos"); break; }
        rows.push(...data);
        if (data.length < pageSize) { setRecords(rows); setError(""); break; }
      }
      setLoading(false);
    };
    readHistory();
    return () => controller.abort();
  }, [type, person, revision]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("finance_confirm_payment", { p_id: confirming });
      if (error) throw error;
      setConfirming(null);
      reload((value) => value + 1);
      onConfirmed();
    } catch {
      setError("No se pudo confirmar el pago");
    } finally {
      setBusy(false);
    }
  }

  return <section className="hf-payment-history" aria-labelledby={id} aria-busy={loading || busy}>
    <h3 id={id}>Historial de pagos</h3>
    {!records.length && !loading && !error && <p>Sin cortes registrados</p>}
    {records.length > 0 && <ul>{records.map(({ id, period_start, period_end, amount, paid_at }) => <li key={id}>
      <div><strong>{usd(amount)}</strong><span>{period_start} – {period_end}</span></div>
      <div>
        <span>{paid_at ? `Pagado · ${new Date(paid_at).toLocaleDateString("es-VE")}` : Number(amount) > 0 ? "Pendiente de pago" : "Sin importe por pagar"}</span>
        {!paid_at && Number(amount) > 0 && (confirming === id
          ? <div className="hf-actions">
            <button type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</button>
            <button type="button" disabled={busy} onClick={confirm}>Confirmar pago y registrar inversión</button>
          </div>
          : <button type="button" disabled={busy} onClick={() => setConfirming(id)}>Marcar como pagado</button>)}
      </div>
    </li>)}</ul>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
