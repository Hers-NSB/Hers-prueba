import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { isActiveFinanceEntry, usd } from "./finance";
import { isChatter } from "./distribution";
import PeriodPicker from "./PeriodPicker";

const moneyDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "short", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("es-VE", { dateStyle: "long", timeZone: "UTC" });
const percentFormat = new Intl.NumberFormat("es-VE", { style: "percent", maximumFractionDigits: 2 });
const utcDate = (value) => new Date(`${value}T00:00:00Z`);
const date = (value) => moneyDate.format(utcDate(value));
const percent = (value) => percentFormat.format(Number(value) / 100);
const period = (row) => `${date(row.period_start)} – ${date(row.period_end)}`;
const canPay = (row) => !row.paid_at && Number(row.amount) > 0;
const paymentPercent = (row) => row.pay_rate_min == null ? "—" : row.pay_rate_min === row.pay_rate_max
  ? percent(row.pay_rate_min) : `${percent(row.pay_rate_min)} – ${percent(row.pay_rate_max)}`;
const total = (rows, field) => {
  const values = rows.map((row) => row[field]).filter((value) => value != null);
  return values.length ? values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100 : null;
};

function PaymentFacts({ row }) {
  return <dl className="hf-payment-facts">
    <div><dt>Período</dt><dd>{period(row)}</dd></div>
    <div><dt>Ventas netas</dt><dd>{usd(row.net_sales)}</dd></div>
    <div><dt>Porcentaje pagado</dt><dd>{paymentPercent(row)}</dd></div>
  </dl>;
}

function CurrentPeriod({ id, period, net, amount }) {
  const { from, to, importedDays, totalDays } = period;
  return <section className="hf-current-pay" aria-labelledby={id}>
    <header><h3 id={id}>Quincena actual</h3><span>En curso</span></header>
    <p className="hf-current-pay-dates">{longDate.formatRange(utcDate(from), utcDate(to))}</p>
    <dl>
      <div><dt>Ventas netas acumuladas</dt><dd>{usd(net)}</dd></div>
      <div><dt>Pago estimado</dt><dd>{usd(amount)}</dd></div>
    </dl>
    {importedDays != null && totalDays > 0 && <div className="hf-current-pay-progress">
      <progress value={importedDays} max={totalDays} aria-labelledby={`${id}-progress`} />
      <span id={`${id}-progress`}>{importedDays} de {totalDays} días importados para el cierre</span>
    </div>}
  </section>;
}

export default function PaymentHistory({ type, person, rate, currentPeriod, currentAmount, currentNet, financeRevision, movements, onEdit, onArchive, onConfirmed, onClose }) {
  const id = useId();
  const [records, setRecords] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, reload] = useState(0);
  const [range, setRange] = useState({});
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rateInput, setRateInput] = useState(null);
  const [rateError, setRateError] = useState("");
  const payrollDay = currentPeriod?.day;
  const importedDays = currentPeriod?.importedDays;

  useEffect(() => {
    const controller = new AbortController();
    const field = type === "modelShare" ? "creator_id" : "member_id";
    async function readHistory() {
      const rows = [];
      const pageSize = 500;
      try {
        for (let start = 0; ; start += pageSize) {
          const { data, error } = await supabase.from("finance_payments").select("*").eq(field, person.id)
            .order("period_start", { ascending: false }).order("id")
            .range(start, start + pageSize - 1).abortSignal(controller.signal);
          if (controller.signal.aborted) return;
          if (error) throw error;
          rows.push(...data);
          if (data.length < pageSize) break;
        }
        setRecords(rows);
        setLoadError("");
      } catch {
        if (!controller.signal.aborted) setLoadError("No se pudo consultar el historial de pagos");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    readHistory();
    return () => controller.abort();
  }, [type, person.id, revision, financeRevision, payrollDay, importedDays]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc("finance_confirm_payment", { p_id: confirming.id });
      if (error) throw error;
      setConfirming(null);
      setNotice(data ? "Pago confirmado y registrado como inversión." : "El corte ya no está disponible para confirmar.");
      setLoading(true);
      onConfirmed();
    } catch {
      setError("No se pudo confirmar el pago. Inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRate(event) {
    event.preventDefault();
    if (busy) return;
    const model = type === "modelShare";
    const creatorIds = rate?.creator_ids ?? [];
    if (!model && !isChatter(person.role) && Number(rateInput) > 0 && !creatorIds.length) {
      setRateError("Abre Editar en este panel y asigna al menos un modelo.");
      return;
    }

    setBusy(true);
    setRateError("");
    try {
      const { error } = await supabase.rpc("finance_save_current_pay_rate", {
        p_member_id: model ? null : person.id,
        p_creator_id: model ? person.id : null,
        p_name: model ? null : person.name,
        p_role: model ? null : person.role,
        p_percent: Number(rateInput),
        p_creator_ids: creatorIds,
      });
      if (error) throw error;
      setRateInput(null);
      onConfirmed();
    } catch {
      setRateError("No se pudo guardar el porcentaje. Inténtalo nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  function closeConfirmation() {
    if (busy) return;
    setConfirming(null);
    setError("");
  }

  const shown = records.filter((row) =>
    (!range.from || row.period_end >= range.from) && (!range.to || row.period_start <= range.to));
  const movementByPayment = new Map(movements.filter((row) => row.finance_payment_id)
    .map((row) => [row.finance_payment_id, row]));
  const activeRate = rate ? percent(rate.percent) : "—";
  const editableManual = type === "member" && !person.agencykey_id && isActiveFinanceEntry(person);

  return <dialog className="hf-dialog hf-finance-dialog hf-payment-panel" aria-labelledby={id}
    ref={(node) => { if (node && !node.open) node.showModal(); }}
    onCancel={(event) => { event.preventDefault(); if (!busy && !confirming) onClose(); }}>
    <header className="hf-payment-header">
      <div><h2 id={id}>Pagos de {person.name}</h2>
        {!isActiveFinanceEntry(person) && <small className="hf-employee-status">Inactivo</small>}
        <p>{type === "modelShare" ? "Modelo" : "Empleado"}</p>
        {rateInput === null ? <p className="hf-payment-rate">
          Porcentaje de pago de la quincena {person.archived_on ? activeRate :
            <button type="button" className="hf-payment-rate-value" aria-label={`Porcentaje de pago de la quincena ${activeRate}`}
              disabled={busy} onClick={() => setRateInput(String(rate?.percent ?? 0))}>{activeRate}</button>}
        </p> : <form className="hf-payment-rate" onSubmit={saveRate}>
          <label htmlFor={`${id}-rate`}>Porcentaje de pago de la quincena</label>
          <input id={`${id}-rate`} type="number" min="0" max="100" step="0.01" required autoFocus
            disabled={busy} value={rateInput} onChange={(event) => setRateInput(event.target.value)} />
          <span aria-hidden="true">%</span>
          <button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button>
          <button type="button" disabled={busy} onClick={() => { setRateError(""); setRateInput(null); }}>Cancelar</button>
          {rateError && <p className="hf-notice" role="alert">{rateError}</p>}
        </form>}
      </div>
      <div className="hf-actions">
        {editableManual && <>
          <button type="button" aria-haspopup="dialog" disabled={busy} onClick={onEdit}>Editar</button>
          <button type="button" aria-haspopup="dialog" disabled={busy} onClick={onArchive}>Eliminar</button>
        </>}
        <button type="button" aria-label="Cerrar pagos" disabled={busy} onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    <div className="hf-payment-content" aria-busy={loading || busy}>
      {currentPeriod && <CurrentPeriod id={`${id}-current`} period={currentPeriod} net={currentNet} amount={currentAmount} />}
      <div className="hf-kpis hf-payment-kpis">
        <article><span>Pendiente</span><strong>{usd(total(shown.filter(canPay), "amount") ?? (loading ? null : 0))}</strong></article>
        <article><span>Pagado</span><strong>{usd(total(shown.filter((row) => row.paid_at), "amount") ?? (loading ? null : 0))}</strong></article>
        <article><span>Ventas de cortes cerrados</span><strong>{usd(total(shown, "net_sales"))}</strong></article>
      </div>
      <div className="hf-payment-filters">
        <PeriodPicker label="Fechas" value={range} onChange={setRange} />
        <button type="button" onClick={() => setRange({})}>Limpiar filtros</button>
      </div>
      <h3 id={`${id}-history`}>Historial de pagos</h3>
      {notice && <p role="status">{notice}</p>}
      {shown.some((row) => row.net_sales == null) && <p className="hf-payment-history-note">
        Los cortes anteriores sin detalle guardado muestran únicamente el importe del pago.
      </p>}
      {loadError && <p className="hf-notice" role="alert">{loadError} <button type="button" onClick={() => {
        setLoading(true);
        reload((value) => value + 1);
      }}>Reintentar</button></p>}
      {!shown.length && !loadError && <p>{loading ? "Cargando cortes…"
        : records.length ? "Sin cortes para estos filtros" : "Todavía no hay cortes cerrados."}</p>}
      {shown.length > 0 && <div className="hf-table hf-payment-table"><table aria-labelledby={`${id}-history`}>
        <thead><tr>{["Período", "Ventas", "% pago", "Pago", "Estado", "Acción"].map((label) =>
          <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{shown.map((row) => {
          const movement = movementByPayment.get(row.id);
          const paidDate = row.paid_at && (movement ? date(movement.day) : new Date(row.paid_at).toLocaleDateString("es-VE"));
          const state = row.paid_at ? "Pagado" : canPay(row) ? "Pendiente" : "Sin importe";
          return <tr key={row.id}>
            <td data-label="Período">{period(row)}</td>
            <td data-label="Ventas">{usd(row.net_sales)}</td>
            <td data-label="% pago">{paymentPercent(row)}</td>
            <td data-label="Pago"><strong>{usd(row.amount)}</strong></td>
            <td data-label="Estado"><span className="hf-payment-state" data-state={state}>{state}</span>
              {paidDate && <small>{paidDate}</small>}</td>
            <td data-label="Acción">{canPay(row) ? <button type="button" disabled={loading || busy}
              onClick={() => { setNotice(""); setConfirming(row); }}>Pagar</button> : row.paid_at ? <details>
              <summary>Detalles</summary>
              <PaymentFacts row={row} />
              <dl className="hf-payment-facts">
                <div><dt>Importe pagado</dt><dd>{usd(row.amount)}</dd></div>
                <div><dt>Fecha de pago</dt><dd>{paidDate}</dd></div>
                <div><dt>Movimiento financiero</dt><dd>{movement?.id ?? "—"}</dd></div>
              </dl>
            </details> : "—"}</td>
          </tr>;
        })}</tbody>
      </table></div>}
    </div>
    {confirming && createPortal(<dialog className="hf-dialog hf-finance-dialog" aria-labelledby={`${id}-confirm`}
      ref={(node) => { if (node && !node.open) node.showModal(); }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); closeConfirmation(); }}>
      <h2 id={`${id}-confirm`}>Confirmar pago</h2>
      <p>{person.name}</p>
      <PaymentFacts row={confirming} />
      <p><strong>Total a pagar {usd(confirming.amount)}</strong></p>
      {error && <p className="hf-notice" role="alert">{error}</p>}
      <div className="hf-actions">
        <button type="button" disabled={busy} onClick={closeConfirmation}>Cancelar</button>
        <button type="button" className="hf-primary" disabled={busy} onClick={confirm}>
          {busy ? "Registrando…" : "Confirmar pago"}
        </button>
      </div>
    </dialog>, document.body)}
  </dialog>;
}
