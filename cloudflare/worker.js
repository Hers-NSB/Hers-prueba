const api = "https://app.agencykey.com/api/v1/public/crm/reports";
const project = "https://glpevkghlzzuwkxojpvc.supabase.co";
const dayMs = 86_400_000;

function formatDay(instant, zone) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function previousDay(instant, zone) {
  const current = Date.parse(`${formatDay(instant, zone)}T00:00:00Z`);
  const day = new Date(current - dayMs).toISOString().slice(0, 10);
  // Locate local midnight across daylight-saving transitions.
  const midnight = (key) => {
    const approx = Date.parse(`${key}T00:00:00Z`);
    let left = approx - dayMs;
    let right = approx + dayMs;
    while (right - left > 1) {
      const middle = Math.floor((left + right) / 2);
      if (formatDay(middle, zone) < key) left = middle;
      else right = middle;
    }
    return right;
  };
  return {
    day,
    fromDate: new Date(midnight(day)).toISOString(),
    toDate: new Date(midnight(formatDay(instant, zone)) - 1).toISOString(),
  };
}

const isName = (value) => typeof value === "string" && value.trim().length > 0;
const isId = (value) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function normalizeReports(created, employees) {
  if (!Array.isArray(created?.data) || !Array.isArray(employees?.data)) {
    throw new Error("Formato de reporte de AgencyKey inesperado");
  }
  const sales = new Map();
  for (const row of created.data) {
    if (!isId(row.creatorId) || !isName(row.creatorName || row.creatorUsername) ||
        !Number.isFinite(row.totalSalesSum) || sales.has(row.creatorId)) {
      throw new Error("Fila de ventas de AgencyKey inválida o repetida");
    }
    sales.set(row.creatorId, { creator_key: row.creatorId, creator_name: row.creatorName || row.creatorUsername,
      crm_total: row.totalSalesSum });
  }

  const attributions = [];
  const members = new Set();
  for (const row of employees.data) {
    if (row.senderId === "__unknown__") continue;
    if (!isId(row.senderId) || !isName(row.senderName) || !Number.isFinite(row.totalSalesSum) || members.has(row.senderId)) {
      throw new Error("Fila de integrante de AgencyKey inválida o repetida");
    }
    members.add(row.senderId);
    if (row.creatorBreakdown == null && row.totalSalesSum === 0) continue;
    if (!Array.isArray(row.creatorBreakdown)) throw new Error("Falta el desglose de ventas por modelo");
    const creators = new Set();
    for (const model of row.creatorBreakdown) {
      if (!sales.has(model.creatorId) || !Number.isFinite(model.totalSalesSum) || creators.has(model.creatorId)) {
        throw new Error("Desglose de ventas de AgencyKey inválido o repetido");
      }
      creators.add(model.creatorId);
      attributions.push({ creator_key: model.creatorId, member_key: row.senderId,
        member_name: row.senderName, attributed: model.totalSalesSum });
    }
    const inCents = (amount) => Math.round(amount * 100);
    const breakdown = row.creatorBreakdown.reduce((sum, item) => sum + inCents(item.totalSalesSum), 0);
    if (Math.abs(breakdown - inCents(row.totalSalesSum)) > row.creatorBreakdown.length) {
      throw new Error("El desglose de ventas atribuidas no coincide con el total del integrante");
    }
  }
  return { sales: [...sales.values()], attributions };
}

export async function importAgencyKey(instant, env, send = fetch) {
  if (!env.AGENCYKEY_API_KEY || !env.SUPABASE_SYNC_KEY) {
    console.warn("AgencyKey: faltan los secretos de ejecución");
    return { skipped: true };
  }
  const { day, ...period } = previousDay(instant, env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax");
  const getReport = async (report, options = {}) => {
    const response = await send(`${api}/${report}?${new URLSearchParams({ ...period, ...options })}`, {
      method: "GET",
      redirect: "error",
      headers: { "x-public-api-key": env.AGENCYKEY_API_KEY, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`AgencyKey ${report}: HTTP ${response.status}`);
    return response.json();
  };
  const [creators, members] = await Promise.all([
    getReport("creators"), getReport("employees", { includeCreatorBreakdown: "true" }),
  ]);
  const { sales, attributions } = normalizeReports(creators, members);
  const key = env.SUPABASE_SYNC_KEY;
  const response = await send(`${project}/rest/v1/rpc/finance_import_agencykey`, {
    method: "POST",
    redirect: "error",
    headers: { apikey: key, "Content-Type": "application/json",
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({ p_day: day, p_sales: sales, p_attributions: attributions }),
  });
  if (!response.ok) throw new Error(`Supabase finance_import_agencykey: HTTP ${response.status}`);
  return { day, creators: sales.length, attributions: attributions.length };
}

export default {
  async scheduled(event, env) {
    const result = await importAgencyKey(event.scheduledTime, env);
    if (!result.skipped) console.log("AgencyKey: importación correcta", result);
  },
};
