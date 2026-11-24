import { supabase } from "../../lib/supabase";

const pageSize = 500;

export async function readRows(table, ordering, signal, filter = (query) => query, columns = "*") {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    let query = filter(supabase.from(table).select(columns));
    for (const column of ordering) query = query.order(column);
    query = query.range(start, start + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function readPayroll(signal) {
  const { data, error } = await supabase.rpc("finance_current_pay").abortSignal(signal);
  if (error) throw error;
  const { amounts: currentPay, sales: currentPaySales = {}, ...payPeriod } = data;
  return { currentPay, currentPaySales, payPeriod };
}

export function inPeriod({ from, to }) {
  return (query) => query.gte("day", from).lte("day", to);
}

export async function readOverviewTotals(signal) {
  const { data, error } = await supabase.rpc("finance_overview_totals").abortSignal(signal);
  if (error) throw error;
  return data;
}

export async function loadOverview(range, signal) {
  const dateFilter = inPeriod(range);
  const [movements, sales] = await Promise.all([
    readRows("finance_movements", ["day", "id"], signal, dateFilter),
    readRows("finance_agencykey_sales", ["day", "creator_id"], signal, dateFilter),
  ]);
  return { movements, sales };
}
