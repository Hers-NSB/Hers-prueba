import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { distributionRecipients, effectivePlan, percentage, shareUnits, totalShares } from "./distribution";
import { dateKey, usd } from "./finance";

const percent = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 });
const formatShare = (units) => `${percent.format(percentage(units))} %`;

export default function Distribution({ data, result, onSaved }) {
  const plans = data.distributionPlans;
  const [day, setDay] = useState(() => dateKey(new Date()));
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const recipients = distributionRecipients(data);
  const activeRecipients = recipients.filter(({ archived_on }) => !archived_on);
  const current = effectivePlan(plans, day);
  const exact = current?.effective_on === day ? current : null;
  const shares = draft ?? Object.fromEntries(activeRecipients.filter(({ id }) => current?.shares[id] != null).map(({ id }) => [id, current.shares[id]]));
  const assigned = totalShares(shares);
  const versions = [...plans].reverse();

  async function save(event) {
    event.preventDefault();
    if (!day || assigned > 10_000 || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const values = Object.fromEntries(Object.entries(shares).filter(([, units]) => units > 0));
      const { data: saved, error } = await supabase.from("finance_distribution_plans")
        .insert({ effective_on: day, revision: (exact?.revision ?? 0) + 1, shares: values }).select().single();
      if (error) throw error;
      setDraft(null);
      onSaved(saved);
      setNotice({ text: "Porcentajes guardados" });
    } catch (error) {
      setNotice({ error: true, text: error.code === "23505"
        ? "Hay una revisión más reciente para esa fecha. Actualiza Finanzas antes de guardar"
        : "No se pudieron guardar los porcentajes" });
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className="hf-section">
      <h2>Reparto de ventas de AgencyKey</h2>
      <p>Usa las ventas netas registradas de todos los modelos del período</p>
      <dl className="hf-financial-detail">
        <div><dt>Ventas netas del período</dt><dd>{usd(result.total)}</dd></div>
        <div><dt>Bóveda de Agencia HERS</dt><dd>{usd(result.payouts.get("hers"))}</dd></div>
      </dl>
      <form onSubmit={save}>
        <div className="hf-distribution-settings">
          <label>Vigente desde<input type="date" required value={day} disabled={saving}
            onChange={(event) => { setDay(event.target.value); setDraft(null); setNotice(null); }} /></label>
          <p>{formatShare(assigned)} asignado · {assigned > 10_000
            ? `${formatShare(assigned - 10_000)} por encima del límite`
            : `${formatShare(10_000 - assigned)} a la bóveda`}</p>
        </div>
        <div className="hf-table" tabIndex={0}><table>
          <thead><tr><th scope="col">Beneficiario</th><th scope="col">Rol</th><th scope="col">Porcentaje</th><th scope="col">Importe del período</th></tr></thead>
          <tbody>{activeRecipients.map(({ id, name, role }) => <tr key={id}>
            <th scope="row">{name}</th>
            <td>{role}</td>
            <td><input className="hf-share-input" type="number" min="0" max="100" step="0.01" inputMode="decimal"
              aria-label={`Porcentaje de ${name} (${role})`} value={shares[id] == null ? "" : percentage(shares[id])} disabled={saving}
              onChange={(event) => setDraft({ ...shares, [id]: shareUnits(event.target.value) })} /></td>
            <td>{usd(result.payouts.get(id))}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="hf-actions hf-distribution-actions">
          <button type="submit" className="hf-primary" disabled={!day || !draft || assigned > 10_000 || saving}>
            {saving ? "Guardando…" : "Guardar porcentajes"}
          </button>
        </div>
      </form>
      {notice && <p className="hf-notice" role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    </section>
    {versions.length > 0 && <section className="hf-section">
      <h2>Historial del reparto</h2>
      {versions.map((plan) => <details className="hf-distribution-version" key={`${plan.effective_on}-${plan.revision}`}>
        <summary>{plan.effective_on} · Revisión {plan.revision} · {formatShare(totalShares(plan.shares))} asignado</summary>
        <ul>{recipients.filter(({ id }) => plan.shares[id] != null).map(({ id, name }) =>
          <li key={id}>{name} · {formatShare(plan.shares[id])}</li>)}</ul>
      </details>)}
    </section>}
  </>;
}
