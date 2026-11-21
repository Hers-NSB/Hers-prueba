export const ONLYFANS = "00000000-0000-4000-8000-000000000001";
export const kinds = { income: "Ingreso", expense: "Inversión", investment: "Inversión" };

const money = new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD" });
export const usd = (value) => value == null ? "—" : money.format(value);
export const dateKey = (date) =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

export function monthRange(offset = 0) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + offset;
  return { from: dateKey(new Date(year, month, 1)), to: dateKey(new Date(year, month + 1, 0)) };
}

export function periodPresets(current) {
  const [year, month] = current.split("-").map(Number);
  const key = (day, offset = 0) => new Date(Date.UTC(year, month - 1 + offset, day)).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(current) - 86_400_000).toISOString().slice(0, 10);
  const last = key(0, 1);
  return [
    ["Hoy", current, current],
    ["Ayer", yesterday, yesterday],
    ["Del 1-15", key(1), key(15)],
    ["Del 16-Final de mes", key(16), last],
    ["Mes", key(1), last],
    ["Mes anterior", key(1, -1), key(0)],
  ];
}

const cents = (amount) => Math.round(Number(amount) * 100);
export function summarize({ movements, sales, commissions }) {
  const totals = { gross: 0, net: 0, agency: 0, expense: 0, investment: 0, commissions: 0 };
  for (const row of movements) {
    if (row.kind === "income") {
      totals.gross += cents(row.gross);
      totals.net += cents(row.net);
      totals.agency += cents(row.amount);
    } else {
      totals[row.kind] += cents(row.amount);
    }
  }
  let withoutNet = 0;
  for (const row of sales) {
    if (row.net == null) withoutNet += 1;
    if (row.gross != null) totals.gross += cents(row.gross);
    if (row.net != null) totals.net += cents(row.net);
  }
  let withoutRate = 0;
  for (const row of commissions) {
    if (row.commission == null && Number(row.attributed) !== 0) withoutRate += 1;
    totals.commissions += cents(row.commission);
  }
  totals.profit = totals.agency - totals.commissions - totals.expense;
  totals.afterInvestment = totals.profit - totals.investment;
  return { ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / 100])), withoutRate, withoutNet };
}

export function dailyFinance({ movements, sales, commissions }, agencyByDay = new Map()) {
  const days = new Map();
  for (const [type, rows] of Object.entries({ movements, sales, commissions })) {
    for (const row of rows) {
      if (!days.has(row.day)) days.set(row.day, { movements: [], sales: [], commissions: [] });
      days.get(row.day)[type].push(row);
    }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => {
    const totals = summarize(rows);
    const vault = agencyByDay.get(day);
    const manualIncome = metricIf(rows.movements, "income", totals.agency);
    return {
      date: Date.parse(day),
      income: manualIncome == null && vault == null ? null : ((manualIncome ?? 0) + (vault ?? 0)),
      expenses: investmentTotal(rows.movements, totals),
      profit: hasOperatingAmounts(rows) || vault != null ? totals.afterInvestment + (vault ?? 0) : null,
      provisional: totals.withoutRate > 0,
      net: netSales(rows.sales, rows.movements),
    };
  });
}

export function hasOperatingAmounts({ movements, commissions }) {
  return movements.length > 0 || commissions.some((row) => row.commission != null);
}

export function investmentTotal(rows, totals) {
  return rows.some((row) => row.kind !== "income") ? totals.expense + totals.investment : null;
}

export function metricIf(rows, kind, value) {
  return rows.some((row) => row.kind === kind) ? value : null;
}

export function netSales(sales, movements = []) {
  const reported = [...sales, ...movements.filter((row) => row.kind === "income")]
    .filter((row) => row.net != null);
  return reported.length ? reported.reduce((sum, row) => sum + cents(row.net), 0) / 100 : null;
}

export function financeBreakdown({ movements, sales }, dimension) {
  const group = new Map();
  const add = (id, metric, value) => {
    const row = group.get(id) ?? { id, income: null, expenses: null, net: null };
    row[metric] = (row[metric] ?? 0) + cents(value);
    group.set(id, row);
  };
  for (const row of movements) {
    const id = dimension === "model" ? row.creator_id : row.platform_id;
    if (row.kind === "income") {
      add(id, "income", row.amount);
      if (row.net != null) add(id, "net", row.net);
    }
    if (row.kind !== "income") add(id, "expenses", row.amount);
  }
  for (const row of sales) {
    if (row.net != null) add(dimension === "model" ? row.creator_id : ONLYFANS, "net", row.net);
  }
  return [...group.values()].map(({ id, income, expenses, net }) => ({
    id, income: income == null ? null : income / 100, expenses: expenses == null ? null : expenses / 100,
    net: net == null ? null : net / 100,
  }));
}
