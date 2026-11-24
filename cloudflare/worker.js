import { beginDirectory, directoryStatus, finishDirectory, syncDirectory } from "./agencykey-directory.js";
import { bridge, handleIntegrations, IntegrationError, storedAgencyKey, workerRpc } from "./integrations.js";
import { dropperPath, handleDropper } from "./dropper.js";

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

const agencyRoot = "https://app.agencykey.com/api";

const retryDelays = [1000, 3000];
const transientStatuses = new Set([502, 503, 504]);
const maxRateLimitWait = 10_000;

function retryAfterMs(value) {
  if (!value) return undefined;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

async function queryAgencyKey(apiKey, path, params, send, code, stage) {
  const url = `${agencyRoot}${path}?${new URLSearchParams(params)}`;
  let response;
  let retryAfter;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await send(url, {
        redirect: "manual", headers: { "x-public-api-key": apiKey, Accept: "application/json" },
      });
    } catch {
      throw new IntegrationError(502, `AgencyKey no respondió al consultar ${stage}`, `${code}-NETWORK`);
    }

    retryAfter = response.status === 429 ? retryAfterMs(response.headers.get("Retry-After")) : undefined;
    const delay = response.status === 429 ? retryAfter
      : code === "AK-NET-TRANSACTIONS" && transientStatuses.has(response.status) ? retryDelays[attempt] : undefined;
    if (attempt >= retryDelays.length || delay === undefined || delay > maxRateLimitWait) break;

    console.info("Reintentando AgencyKey", { code, upstreamStatus: response.status, attempt: attempt + 1 });
    await response.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (response.status === 429) {
    const retryAfterSeconds = retryAfter === undefined ? undefined : Math.ceil(retryAfter / 1000);
    const delayMessage = retryAfterSeconds > 0 ? ` Vuelve a intentar en ${retryAfterSeconds} s.` : "";
    const error = new IntegrationError(429, `AgencyKey alcanzó su límite de peticiones.${delayMessage}`, "AK-RATE-LIMIT");
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? " · Verifica los permisos de la clave" : "";
    const error = new IntegrationError(502, `AgencyKey respondió HTTP ${response.status} al consultar ${stage}${reason}`, `${code}-HTTP`);
    error.upstreamStatus = response.status;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new IntegrationError(502, `AgencyKey devolvió una respuesta no JSON al consultar ${stage}`, `${code}-JSON`);
  }
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

async function readTransactionsNet(key, creatorExternalId, bounds, send) {
  const { day, fromDate, toDate, params } = bounds;
  const path = `/v1/onlyfans/${creatorExternalId}/api2/v2/payouts/transactions`;
  const start = Date.parse(fromDate);
  const end = Date.parse(toDate);
  const seen = new Map();
  const markers = new Set();
  let marker;
  for (let page = 0; page < 5; page += 1) {
    const payload = await queryAgencyKey(key, path, {
      startDate: params.startDate, endDate: params.endDate, limit: 50,
      ...(marker ? { marker } : {}),
    }, send, "AK-NET-TRANSACTIONS", `las transacciones del ${day}`);
    const result = Array.isArray(payload?.list) ? payload : payload?.data;
    if (!Array.isArray(result?.list) || typeof result.hasMore !== "boolean") {
      throw new IntegrationError(502, `Las transacciones del ${day} no tienen el formato esperado`, "AK-NET-TRANSACTIONS-FORMAT");
    }
    for (const row of result.list) {
      const time = Date.parse(row?.createdAt ?? row?.date);
      if (!Number.isFinite(time)) {
        throw new IntegrationError(502, `Una transacción de la consulta del ${day} llegó sin fecha válida`, "AK-NET-TRANSACTIONS-DATE");
      }
      if (time < start || time > end) continue;
      const reversed = row.status === "undo" || Boolean(row.chargebackAt || row.chargebackId);
      const net = reversed ? 0 : money(row.net);
      const id = row.id;
      if (net === null || row.currency !== "USD" || (typeof id !== "string" && !Number.isSafeInteger(id)) || id === "") {
        throw new IntegrationError(502, `Una transacción del ${day} llegó sin neto, moneda o identificador válido`, "AK-NET-TRANSACTIONS-ROW");
      }
      const cents = Math.round(net * 100);
      const previous = seen.get(String(id));
      if (!Number.isSafeInteger(cents) || (previous && (previous.cents !== cents || previous.reversed !== reversed))) {
        throw new IntegrationError(502, `Una transacción del ${day} tiene un importe inconsistente`, "AK-NET-TRANSACTIONS-AMOUNT");
      }
      seen.set(String(id), { cents, reversed });
    }
    if (!result.hasMore) {
      const sales = [...seen.values()].filter((row) => !row.reversed);
      return { count: sales.length, net: sales.reduce((sum, row) => sum + row.cents, 0) / 100 };
    }
    const next = result.nextMarker;
    if ((typeof next !== "string" && !Number.isSafeInteger(next)) || next === "" || markers.has(String(next))) break;
    marker = String(next);
    markers.add(marker);
  }
  throw new IntegrationError(502, `La lectura de transacciones del ${day} quedó incompleta`, "AK-NET-TRANSACTIONS-PAGE");
}

function employeeNetTotals(report) {
  const totals = new Map();
  if (!Array.isArray(report?.data)) {
    throw new IntegrationError(502, "AgencyKey devolvió un reporte de ventas por empleado inválido", "AK-EMPLOYEE-SALES-FORMAT");
  }
  for (const { senderId, totalSalesSum } of report.data) {
    if (senderId === "__unknown__") continue;
    if (!isId(senderId) || !Number.isFinite(totalSalesSum) || totals.has(senderId)) {
      throw new IntegrationError(502, "AgencyKey devolvió ventas por empleado inválidas o repetidas", "AK-EMPLOYEE-SALES-ROW");
    }
    // El reporte devuelve ventas brutas. OnlyFans retiene el 20 %.
    const netCents = Math.round(Math.abs(totalSalesSum) * 80);
    totals.set(senderId, Math.sign(totalSalesSum) * netCents / 100);
  }
  return Object.fromEntries(totals);
}

export async function importNet(day, env, send = fetch, testOnly = false, instant = Date.now(), closeDay = false) {
  const zone = env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax";
  const currentDay = formatDay(instant, zone);
  day ??= previousDay(instant, zone).day;
  if (!isoDay(day)) throw new Error("Fecha de importación inválida");
  if (day > currentDay) return { day, future: true };
  const key = await storedAgencyKey(project, env, send);
  if (!key) return { skipped: true };

  const creators = new Map();
  for (let page = 1; ; page += 1) {
    const result = await queryAgencyKey(key, "/v1/onlyfans/creators", { page, limit: 100 }, send, "AK-MODELS", "los modelos");
    if (!Array.isArray(result?.data) || !Number.isInteger(result.pagination?.pages)) throw new IntegrationError(502, "AgencyKey devolvió un formato de modelos inesperado", "AK-MODELS-FORMAT");
    for (const row of result.data) {
      if (!isId(row.id) || !isName(row.name) || !Number.isSafeInteger(row.creatorExternalId) || creators.has(row.id)) {
        throw new IntegrationError(502, "AgencyKey devolvió un modelo inválido o repetido", "AK-MODELS-ROW");
      }
      creators.set(row.id, row);
    }
    if (page >= result.pagination.pages) break;
  }
  if (!creators.size) throw new IntegrationError(502, "AgencyKey no devolvió modelos accesibles", "AK-MODELS-EMPTY");

  const period = reportPeriod(day, zone);
  const fromDate = period.fromDate;
  const toDate = day === currentDay ? new Date(instant).toISOString() : period.toDate;
  const params = { startDate: fromDate.slice(0, 19).replace("T", " "),
    endDate: toDate.slice(0, 19).replace("T", " "), withTotal: "true" };
  const sales = [];
  const empty = [];
  let transactionModels = 0;
  const entries = [...creators.values()];
  for (let i = 0; i < entries.length; i += 5) {
    const batch = await Promise.allSettled(entries.slice(i, i + 5).map(async (row) => {
      const path = `/v1/onlyfans/${row.creatorExternalId}/api2/v2/earnings/chart`;
      const chart = await queryAgencyKey(key, path, { ...params, type: "total" }, send, "AK-NET-CHART", `el gráfico de ingresos del ${day}`);
      let net = readEarningsNet(chart);
      if (net === null) {
        const result = await readTransactionsNet(key, row.creatorExternalId, { day, fromDate, toDate, params }, send);
        if (result.count === 0) empty.push(row.id);
        transactionModels += 1;
        net = result.net;
      }
      return { creator_key: row.id, creator_name: row.name, net };
    }));
    const rateLimit = batch.find((result) => result.status === "rejected" && result.reason?.status === 429);
    if (rateLimit) throw rateLimit.reason;
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      sales.push(result.value);
    }
  }
  if (empty.length) {
    const report = await queryAgencyKey(key, "/v1/public/crm/reports/creators",
      { fromDate, toDate }, send, "AK-CRM", "el reporte CRM de contraste");
    const byCreator = new Map();
    for (const row of Array.isArray(report?.data) ? report.data : []) {
      const count = money(row?.totalSalesCount);
      const total = money(row?.totalSalesSum);
      if (!isId(row?.creatorId) || count === null || total === null || byCreator.has(row.creatorId)) {
        byCreator.clear();
        break;
      }
      byCreator.set(row.creatorId, count !== 0 || total !== 0);
    }
    // The CRM can omit models without attributed sales. Require a valid report
    // before using absence to corroborate an empty, fully paginated ledger.
    const completeReport = byCreator.size > 0 || Array.isArray(report?.data) && report.data.length === 0;
    const unconfirmed = empty.filter((id) => !completeReport || byCreator.get(id) === true).length;
    if (unconfirmed) {
      throw new IntegrationError(502, `El gráfico y las transacciones no confirmaron el neto para ${unconfirmed} de ${entries.length} modelos · Día ${day} · Ventana UTC ${fromDate} a ${toDate}`, "AK-NET-EMPTY");
    }
  }
  const employeeReport = await queryAgencyKey(key, "/v1/public/crm/reports/employees",
    { fromDate, toDate }, send, "AK-EMPLOYEE-SALES", "las ventas atribuidas a empleados");
  const employeeNet = employeeNetTotals(employeeReport);
  if (!testOnly) {
    const payload = { p_day: day, p_sales: sales, p_attributions: null, p_employee_net: employeeNet };
    if (closeDay) await workerRpc("hers_payroll_worker", project, env, "import", payload, send);
    else await bridge(project, env, "import", payload, send);
  }
  return { day, creators: sales.length, attributions: Object.keys(employeeNet).length, ...(testOnly ? { transactionModels,
    netTotal: sales.reduce((sum, row) => sum + Math.round(row.net * 100), 0) / 100 } : {}) };
}

export default {
  async scheduled(event, env) {
    const report_zone = env.AGENCYKEY_REPORT_TIMEZONE || "America/Halifax";
    const scheduled = new Date(event.scheduledTime);
    if (scheduled.getUTCHours() === 6 && scheduled.getUTCMinutes() === 5) {
      try {
        await syncDirectory(project, env);
      } catch (error) {
        if (error.code !== "AK-DIRECTORY-CONNECT") console.warn("Directorio de AgencyKey", error.code || error.name);
      }
    }
    const next = await workerRpc("hers_payroll_worker", project, env, "next", { report_zone }, fetch);
    if (!next.day) return;
    const importDay = async (day) => {
      const result = await importNet(day, env, fetch, false, event.scheduledTime, true);
      if (result.skipped || result.future) throw new Error("No se pudo completar el día de pagos de AgencyKey");
    };
    try {
      await importDay(next.day);
    } catch (error) {
      if (error.code !== "AK-NET-TRANSACTIONS-HTTP" || !transientStatuses.has(error.upstreamStatus)) throw error;
      console.warn("Importación pendiente de AgencyKey", { day: next.day, code: error.code, upstreamStatus: error.upstreamStatus });
      const later = await workerRpc("hers_payroll_worker", project, env, "next", { report_zone, after_day: next.day }, fetch);
      if (!later.day || later.day <= next.day) throw error;
      await importDay(later.day);
    }
  },
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith(dropperPath)) return handleDropper(request, env.DROPPER);
    if (path === "/restablecer-contrasena" || path === "/restablecer-contrasena/") {
      return new Response("El acceso de HERS se gestiona desde Supabase", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (path === "/api/admin/integrations" || path.startsWith("/api/admin/integrations/")) {
      return handleIntegrations(request, project, env, (testOnly, day) => importNet(day, env, fetch, testOnly), fetch,
        { begin: beginDirectory, finish: finishDirectory, status: directoryStatus, sync: syncDirectory });
    }
    return env.ASSETS.fetch(request);
  },
};
