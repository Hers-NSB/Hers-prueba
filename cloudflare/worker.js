import { bridge, handleIntegrations, storedAgencyKey } from "./integrations.js";

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
  return { day, ...reportPeriod(day, zone) };
}

function reportPeriod(day, zone) {
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
    fromDate: new Date(midnight(day)).toISOString(),
    toDate: new Date(midnight(new Date(Date.parse(day) + dayMs).toISOString().slice(0, 10)) - 1).toISOString(),
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

export async function importAgencyKey(instant, env, send = fetch, testOnly = false) {
  const hasBridge = Boolean(env.HERS_INTEGRATIONS_SECRET && env.SUPABASE_PUBLISHABLE_KEY);
  const apiKey = hasBridge ? await storedAgencyKey(project, env, send) : env.AGENCYKEY_API_KEY;
  if (!apiKey || (!testOnly && !hasBridge && !env.SUPABASE_SYNC_KEY)) return { skipped: true };
  const { day, ...period } = previousDay(instant, env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax");
  const getReport = async (report, options = {}) => {
    const response = await send(`${api}/${report}?${new URLSearchParams({ ...period, ...options })}`, {
      method: "GET",
      redirect: "manual",
      headers: { "x-public-api-key": apiKey, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`AgencyKey ${report}: HTTP ${response.status}`);
    return response.json();
  };
  const [creators, members] = await Promise.all([
    getReport("creators"), getReport("employees", { includeCreatorBreakdown: "true" }),
  ]);
  const { sales, attributions } = normalizeReports(creators, members);
  const outcome = { day, creators: sales.length, attributions: attributions.length };
  if (testOnly) return outcome;
  const batch = { p_day: day, p_sales: sales, p_attributions: attributions };
  if (hasBridge) {
    await bridge(project, env, "import", batch, send);
    return outcome;
  }
  const key = env.SUPABASE_SYNC_KEY;
  const response = await send(`${project}/rest/v1/rpc/finance_import_agencykey`, {
    method: "POST",
    redirect: "manual",
    headers: { apikey: key, "Content-Type": "application/json",
      ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify(batch),
  });
  if (!response.ok) throw new Error(`Supabase finance_import_agencykey: HTTP ${response.status}`);
  return outcome;
}

const agencyRoot = "https://app.agencykey.com/api";

async function queryAgencyKey(apiKey, path, params, send) {
  const response = await send(`${agencyRoot}${path}?${new URLSearchParams(params)}`, {
    redirect: "manual", headers: { "x-public-api-key": apiKey, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`AgencyKey lectura: HTTP ${response.status}`);
  return response.json();
}

function isoDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function money(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}

function readEarningsNet(chart) {
  const list = Array.isArray(chart) ? chart : Array.isArray(chart?.data) ? chart.data : null;
  const totalRows = list?.filter((row) => [row?.type, row?.key, row?.name, row?.id].includes("total")) ?? [];
  const selected = totalRows.length === 1 ? totalRows[0] : null;
  const candidates = [chart?.total, chart?.data?.total, selected];
  for (const total of candidates) {
    const net = money(total?.net) ?? money(total?.total);
    if (net !== null) return net;
  }
  if (list?.length === 1) {
    const net = money(list[0]?.net);
    if (net !== null) return net;
  }
  return null;
}

function describeEarnings(chart) {
  const fields = (value) => {
    if (!value || typeof value !== "object") return value == null ? "ausente" : typeof value;
    return Object.keys(value).filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(key)).slice(0, 8).join(", ") || "objeto vacío";
  };
  const list = Array.isArray(chart) ? chart : Array.isArray(chart?.data) ? chart.data : null;
  if (list) return list.length ? `lista de ${list.length} · campos: ${fields(list[0])}` : "lista vacía";
  return `raíz: ${fields(chart)} · data: ${fields(chart?.data)} · total: ${fields(chart?.total ?? chart?.data?.total)}`;
}

export async function importNet(day, env, send = fetch, testOnly = false, instant = Date.now()) {
  const zone = env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax";
  const currentDay = formatDay(instant, zone);
  day ??= previousDay(instant, zone).day;
  if (!isoDay(day)) throw new Error("Fecha de importación inválida");
  if (day > currentDay) return { day, future: true };
  const key = await storedAgencyKey(project, env, send);
  if (!key) return { skipped: true };

  const creators = new Map();
  for (let page = 1; ; page += 1) {
    const result = await queryAgencyKey(key, "/v1/onlyfans/creators", { page, limit: 100 }, send);
    if (!Array.isArray(result.data) || !Number.isInteger(result.pagination?.pages)) throw new Error("Formato de modelos inesperado");
    for (const row of result.data) {
      if (!isId(row.id) || !isName(row.name) || !Number.isSafeInteger(row.creatorExternalId) || creators.has(row.id)) {
        throw new Error("Modelo de AgencyKey inválido o repetido");
      }
      creators.set(row.id, row);
    }
    if (page >= result.pagination.pages) break;
  }
  if (!creators.size) throw new Error("AgencyKey no devolvió modelos accesibles");

  const { fromDate, toDate } = reportPeriod(day, zone);
  const params = { startDate: fromDate.slice(0, 19).replace("T", " "),
    endDate: (day === currentDay ? new Date(instant).toISOString() : toDate).slice(0, 19).replace("T", " "), withTotal: "true" };
  const sales = [];
  const invalid = new Map();
  const entries = [...creators.values()];
  for (let i = 0; i < entries.length; i += 5) {
    const batch = await Promise.all(entries.slice(i, i + 5).map(async (row) => {
      const path = `/v1/onlyfans/${row.creatorExternalId}/api2/v2/earnings/chart`;
      const chart = await queryAgencyKey(key, path, params, send);
      let net = readEarningsNet(chart);
      if (net === null) {
        const totalChart = await queryAgencyKey(key, path, { ...params, type: "total" }, send);
        net = readEarningsNet(totalChart);
        if (net === null) {
          const original = describeEarnings(chart);
          const directed = describeEarnings(totalChart);
          const format = original === directed ? original : `${original} / total: ${directed}`;
          invalid.set(format, (invalid.get(format) ?? 0) + 1);
          return null;
        }
      }
      return { creator_key: row.id, creator_name: row.name, net };
    }));
    sales.push(...batch.filter(Boolean));
  }
  if (invalid.size) {
    const formats = [...invalid].map(([shape, count]) => `${count} × ${shape}`).join(" | ");
    throw new Error(`AgencyKey no devolvió un importe neto válido para ${entries.length - sales.length} de ${entries.length} modelos · ${formats}`);
  }
  if (!testOnly) await bridge(project, env, "import", { p_day: day, p_sales: sales, p_attributions: null }, send);
  return { day, creators: sales.length, attributions: 0 };
}

async function listEmployees(env, send = fetch, instant = Date.now()) {
  const key = await storedAgencyKey(project, env, send);
  if (!key) return { skipped: true };
  const zone = env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax";
  const day = formatDay(instant, zone);
  const start = new Date(Date.parse(day) - 29 * dayMs).toISOString().slice(0, 10);
  const result = await queryAgencyKey(key, "/v1/public/crm/reports/employees", {
    fromDate: reportPeriod(start, zone).fromDate, toDate: new Date(instant).toISOString(),
  }, send);
  if (!Array.isArray(result.data)) throw new Error("Formato de empleados inesperado");
  return { employees: result.data.filter(({ senderId, senderName }) => isId(senderId) && isName(senderName))
    .map(({ senderId, senderName }) => ({ id: senderId, name: senderName })) };
}

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/restablecer-contrasena" || path === "/restablecer-contrasena/") {
      return new Response("El acceso de HERS se gestiona desde Supabase", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (path === "/api/admin/integrations" || path.startsWith("/api/admin/integrations/")) {
      return handleIntegrations(request, project, env, (testOnly, day) => importNet(day, env, fetch, testOnly), fetch, () => listEmployees(env));
    }
    return env.ASSETS.fetch(request);
  },
};
