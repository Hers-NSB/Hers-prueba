import { percentage, shareRecipient } from "./distribution";

const percent = new Intl.NumberFormat("es-VE", { style: "percent", maximumFractionDigits: 2 });
const formatShare = (value) => percent.format(Number(value) / 100);

export default function Distribution({ data: { members, creators, rates, distributionPlans } }) {
  const names = new Map([
    ...members.map(({ id, name }) => [`chatter:${id}`, name]),
    ...creators.map(({ id, name }) => [`model:${id}`, name]),
  ]);
  const plans = distributionPlans.filter(({ shares }) => Object.keys(shares).some((id) => names.has(id)));
  if (!rates.length && !plans.length) return null;
  return <details className="hf-section hf-distribution-version">
    <summary>Historial del reparto</summary>
    <ul>
      {[...rates].reverse().map((rate) => <li key={rate.id}>
        {rate.effective_on} · {names.get(shareRecipient(rate))} · {formatShare(rate.percent)}
        {rate.creator_ids.length > 0 && ` · ${rate.creator_ids.map((id) => names.get(`model:${id}`)).join(", ")}`}
      </li>)}
      {[...plans].reverse().map(({ effective_on, revision, shares }) => <li key={`${effective_on}-${revision}`}>
        {effective_on} · Revisión {revision}
        <ul>{Object.entries(shares).filter(([id]) => names.has(id)).map(([id, units]) =>
          <li key={id}>{names.get(id)} · {formatShare(percentage(units))}</li>)}</ul>
      </li>)}
    </ul>
  </details>;
}
