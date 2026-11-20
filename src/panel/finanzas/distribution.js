const fullShare = 10_000;
export const percentage = (units) => units / 100;
export const shareUnits = (percent) => Math.round(Number(percent) * 100);
export const totalShares = (shares) => Object.values(shares).reduce((sum, units) => sum + units, 0);

export function effectivePlan(plans, day) {
  return plans.findLast((plan) => plan.effective_on <= day);
}

export function distributionRecipients({ members, creators }) {
  return [
    ...members.map(({ id, name }) => ({ id: `chatter:${id}`, name, role: "Chatter" })),
    ...creators.map(({ id, name }) => ({ id: `model:${id}`, name, role: "Modelo" })),
    { id: "dropper", name: "Dropper", role: "Dropper" },
    { id: "hers", name: "Agencia HERS", role: "Agencia" },
  ];
}

function allocateCents(amount, shares) {
  const sign = amount < 0n ? -1n : 1n;
  const magnitude = amount * sign;
  const remainder = fullShare - totalShares(shares);
  const parts = Object.entries(shares).sort(([a], [b]) => a.localeCompare(b));
  parts.push(["unassigned", remainder]);
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

export function calculateDistribution(sales, plans) {
  const days = new Map();
  for (const { day, crm_total } of sales) {
    if (crm_total != null) days.set(day, (days.get(day) ?? 0n) + exactCents(crm_total));
  }
  const payouts = new Map();
  let total = 0n;
  for (const [day, amount] of days) {
    total += amount;
    for (const [id, payout] of allocateCents(amount, effectivePlan(plans, day)?.shares ?? {})) {
      payouts.set(id, (payouts.get(id) ?? 0n) + payout);
    }
  }
  return {
    total: days.size ? Number(total) / 100 : null,
    unassigned: days.size ? Number(payouts.get("unassigned")) / 100 : null,
    payouts: new Map([...payouts].filter(([id]) => id !== "unassigned").map(([id, amount]) => [id, Number(amount) / 100])),
  };
}
