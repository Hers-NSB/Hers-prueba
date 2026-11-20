export const ONLYFANS = "00000000-0000-4000-8000-000000000001";
export const kinds = { income: "Ingreso", expense: "Gasto", investment: "Inversión" };

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
  let withoutPlatformAmounts = 0;
  for (const row of sales) {
    if (row.gross == null || row.net == null) withoutPlatformAmounts += 1;
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
  return { ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / 100])), withoutRate, withoutPlatformAmounts };
}
