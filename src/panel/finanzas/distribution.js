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

export const isChatter = (role) => /(^|,) *chatters? *(,|$)/i.test(role ?? "");

function commissionCents(amount, percent) {
  const numerator = amount * BigInt(shareUnits(percent));
  const rounding = numerator < 0n ? -5000n : 5000n;
  return (numerator + rounding) / BigInt(fullShare);
}

export function calculateModelDistribution(sales, plans, members, rates, availability = [], employeeNet = []) {
  const firstDay = rates[0]?.effective_on;
  if (!firstDay) return calculateDistribution(sales, plans, members);
  const historic = calculateDistribution(sales.filter(({ day }) => day < firstDay), plans, members);
  const staff = new Map(members.map((member) => [member.id, member]));
  const employment = Map.groupBy(availability, ({ member_id }) => member_id);
  const byRecipient = Map.groupBy(rates, shareRecipient);
  const netByDay = new Map(employeeNet.map(({ day, totals }) => [day, totals]));
  const days = Map.groupBy(sales.filter(({ day, net }) => day >= firstDay && net != null), ({ day }) => day);
  const payable = new Map();
  const agencyByDay = new Map(historic.agencyByDay);
  const pendingDays = new Set();
  const pendingRecipients = new Set();
  let total = 0n;

  const addPayout = (recipient, payout) => payable.set(recipient, (payable.get(recipient) ?? 0n) + payout);

  for (const [day, dailySales] of days) {
    const amounts = new Map(dailySales.map(({ creator_id, net }) => [creator_id, exactCents(net)]));
    const net = [...amounts.values()].reduce((sum, amount) => sum + amount, 0n);
    const employeeTotals = netByDay.get(day);
    total += net;
    let remaining = net;

    for (const [recipient, versions] of byRecipient) {
      const rate = versions.findLast(({ effective_on }) => effective_on <= day);
      if (!Number(rate?.percent)) continue;
      const member = staff.get(rate.member_id);
      const status = employment.get(rate.member_id)?.findLast(({ effective_on }) => effective_on <= day);
      if ((member?.archived_on && day >= member.archived_on) || status?.available === false) continue;

      let payout;
      if (rate.basis === "employee_sales") {
        if (!employeeTotals || !member?.agencykey_id) {
          pendingDays.add(day);
          pendingRecipients.add(recipient);
          continue;
        }
        payout = commissionCents(exactCents(employeeTotals[member.agencykey_id] ?? 0), rate.percent);
      } else {
        const creators = rate.member_id ? rate.creator_ids : [rate.creator_id];
        const applicable = creators.filter((creator) => amounts.has(creator));
        if (!applicable.length) continue;
        payout = applicable.reduce((sum, creator) => sum + commissionCents(amounts.get(creator), rate.percent), 0n);
      }
      addPayout(recipient, payout);
      remaining -= payout;
    }
    if (!pendingDays.has(day)) {
      addPayout("hers", remaining);
      agencyByDay.set(day, Number(remaining) / 100);
    }
  }

  const payouts = new Map(historic.payouts);
  for (const [recipient, amount] of payable) {
    payouts.set(recipient, Number(exactCents(payouts.get(recipient) ?? 0) + amount) / 100);
  }
  if (pendingDays.size) payouts.delete("hers");
  for (const recipient of pendingRecipients) payouts.delete(recipient);
  return {
    total: days.size ? Number(exactCents(historic.total ?? 0) + total) / 100 : historic.total,
    payouts, agencyByDay, pendingDays, pendingRecipients,
  };
}
