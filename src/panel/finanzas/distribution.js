const fullShare = 10_000;
export const percentage = (units) => units / 100;
export const shareUnits = (percent) => Math.round(Number(percent) * 100);
export const totalShares = (shares) => Object.values(shares).reduce((sum, units) => sum + units, 0);

export function effectivePlan(plans, day) {
  return plans.findLast((plan) => plan.effective_on <= day);
}

function allocateCents(amount, shares) {
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = amount * sign;
  const remainder = fullShare - totalShares(shares);
  const parts = Object.entries({ ...shares, hers: (shares.hers ?? 0) + remainder }).sort(([a], [b]) => a.localeCompare(b));
  const payouts = parts.map(([id, units]) => {
    const numerator = magnitude * BigInt(units);
    return { id, amount: numerator / BigInt(fullShare), fraction: numerator % BigInt(fullShare) };
  });
  payouts.sort((a, b) => Number(b.fraction - a.fraction));
  const pennies = Number(magnitude - payouts.reduce((sum, row) => sum + row.amount, 0n));
  return payouts.map(({ id, amount }, i) => [id, (amount + (i < pennies ? 1n : 0n)) * sign]);
}

function exactCents(amount) {
  const [whole, fraction = ""] = String(amount).split(".");
  const unsigned = BigInt(whole.replace(/^-/, "")) * 100n + BigInt(fraction.padEnd(2, "0"));
  return whole.startsWith("-") ? -unsigned : unsigned;
}

export function calculateDistribution(sales, plans, members = []) {
  const days = new Map();
  for (const { day, net } of sales) {
    if (net != null) days.set(day, (days.get(day) ?? 0n) + exactCents(net));
  }
  const archived = new Map(members.filter(({ archived_on }) => archived_on).map(({ id, archived_on }) => [`chatter:${id}`, archived_on]));
  const payouts = new Map();
  const agencyByDay = new Map();
  let total = 0n;
  for (const [day, amount] of days) {
    total += amount;
    const shares = Object.fromEntries(Object.entries(effectivePlan(plans, day)?.shares ?? {})
      .filter(([id]) => !archived.has(id) || day < archived.get(id)));
    for (const [id, payout] of allocateCents(amount, shares)) {
      payouts.set(id, (payouts.get(id) ?? 0n) + payout);
      if (id === "hers") agencyByDay.set(day, Number(payout) / 100);
    }
  }
  return {
    total: days.size ? Number(total) / 100 : null,
    agencyByDay,
    payouts: new Map([...payouts].map(([id, amount]) => [id, Number(amount) / 100])),
  };
}

export const shareRecipient = ({ member_id, creator_id }) => member_id ? `chatter:${member_id}` : `model:${creator_id}`;

export function effectiveShare(rates, recipient, day) {
  return rates.findLast((rate) => shareRecipient(rate) === recipient && rate.effective_on <= day);
}

export function calculateModelDistribution(sales, plans, members, rates, availability = []) {
  const firstDay = rates[0]?.effective_on;
  if (!firstDay) return calculateDistribution(sales, plans, members);
  const historic = calculateDistribution(sales.filter(({ day }) => day < firstDay), plans, members);
  const archived = new Map(members.map(({ id, archived_on }) => [id, archived_on]));
  const employment = Map.groupBy(availability, ({ member_id }) => member_id);
  const byRecipient = Map.groupBy(rates, shareRecipient);
  const payable = new Map();
  const agency = new Map();
  let total = 0n;
  let recorded = false;
  for (const { day, creator_id: creator, net } of sales) {
    if (day < firstDay || net == null) continue;
    recorded = true;
    const amount = exactCents(net);
    total += amount;
    let remaining = amount;
    for (const [recipient, versions] of byRecipient) {
      const rate = versions.findLast(({ effective_on }) => effective_on <= day);
      if (!rate?.percent) continue;
      if (rate.member_id) {
        const until = archived.get(rate.member_id);
        const latest = employment.get(rate.member_id)?.findLast(({ effective_on }) => effective_on <= day);
        if ((until && day >= until) || latest?.available === false || !rate.creator_ids.includes(creator)) continue;
      } else if (rate.creator_id !== creator) continue;
      const numerator = amount * BigInt(shareUnits(rate.percent));
      const rounding = numerator < 0n ? -5000n : 5000n;
      const payout = (numerator + rounding) / BigInt(fullShare);
      payable.set(recipient, (payable.get(recipient) ?? 0n) + payout);
      remaining -= payout;
    }
    agency.set(day, (agency.get(day) ?? 0n) + remaining);
    payable.set("hers", (payable.get("hers") ?? 0n) + remaining);
  }
  const payouts = new Map(historic.payouts);
  for (const [recipient, amount] of payable) {
    payouts.set(recipient, Number(exactCents(payouts.get(recipient) ?? 0) + amount) / 100);
  }
  return {
    total: recorded ? Number(exactCents(historic.total ?? 0) + total) / 100 : historic.total,
    payouts,
    agencyByDay: new Map([...historic.agencyByDay, ...Array.from(agency, ([day, amount]) => [day, Number(amount) / 100])]),
  };
}
