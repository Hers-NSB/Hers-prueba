import test from "node:test";
import assert from "node:assert/strict";
import { dailyFinance, financeBreakdown, netSales, ONLYFANS, summarize } from "../src/panel/finanzas/finance.js";
import { importAgencyKey, importNet, normalizeReports, previousDay } from "../cloudflare/worker.js";

const creator = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const creators = { data: [{ creatorId: creator, creatorName: "Modelo", totalSalesSum: 25.50 }] };
const employees = { data: [{ senderId: member, senderName: "Integrante", totalSalesSum: 12.51,
  creatorBreakdown: [{ creatorId: creator, totalSalesSum: 12.51 }] }] };

test("calcula utilidad operativa y resultado después de inversión con centavos", () => {
  const totals = summarize({
    movements: [{ kind: "income", amount: "40.00", gross: "100.00", net: "80.00" },
      { kind: "expense", amount: "10.12" }, { kind: "investment", amount: "5.47" }],
    sales: [{ gross: "25.00", net: "20.00" }, { crm_total: "25.50" }],
    commissions: [{ attributed: "25.05", commission: "2.51" }, { attributed: "10.00", commission: null }],
  });
  assert.deepEqual(totals, { gross: 125, net: 100, agency: 40, expense: 10.12, investment: 5.47,
    commissions: 2.51, profit: 27.37, afterInvestment: 21.90, withoutRate: 1, withoutNet: 1 });
});

test("usa el día del reporte incluso en el cambio de horario de Halifax", () => {
  assert.deepEqual(previousDay(Date.parse("2026-03-09T10:00:00Z"), "America/Halifax"), {
    day: "2026-03-08", fromDate: "2026-03-08T04:00:00.000Z", toDate: "2026-03-09T02:59:59.999Z",
  });
});

test("valida el desglose y conserva el total CRM sin etiquetarlo bruto o neto", () => {
  assert.deepEqual(normalizeReports(creators, employees), {
    sales: [{ creator_key: creator, creator_name: "Modelo", crm_total: 25.50 }],
    attributions: [{ creator_key: creator, member_key: member, member_name: "Integrante", attributed: 12.51 }],
  });
  assert.throws(() => normalizeReports(creators, { data: [{ ...employees.data[0], creatorBreakdown: [] }] }), /no coincide/);
  assert.throws(() => normalizeReports(creators, { data: [...employees.data, ...employees.data] }), /repetida/);
});

test("usa GET en AgencyKey y envía un único lote transaccional a Supabase", async () => {
  const calls = [];
  const result = await importAgencyKey(Date.parse("2026-11-20T11:00:00Z"),
    { AGENCYKEY_API_KEY: "fixture", SUPABASE_SYNC_KEY: "sb_secret_fixture" }, async (url, options) => {
      calls.push([url, options]);
      if (url.includes("/creators?")) return Response.json(creators);
      if (url.includes("/employees?")) return Response.json(employees);
      return new Response(null, { status: 204 });
    });
  assert.deepEqual(result, { day: "2026-11-19", creators: 1, attributions: 1 });
  assert.deepEqual(calls.map(([, options]) => options.method), ["GET", "GET", "POST"]);
  assert.equal(calls[0][1].headers["x-public-api-key"], "fixture");
  assert.equal(JSON.parse(calls[2][1].body).p_attributions[0].attributed, 12.51);
  assert.ok(!("x-public-api-key" in calls[2][1].headers));
});

test("omite la importación con secretos ausentes y no persiste reportes fallidos", async () => {
  const instant = Date.parse("2026-11-20T11:00:00Z");
  const rejectCall = async () => assert.fail("No debe haber peticiones sin secretos");
  assert.deepEqual(await importAgencyKey(instant, {}, rejectCall), { skipped: true });
  const env = { AGENCYKEY_API_KEY: "fixture", SUPABASE_SYNC_KEY: "sb_secret_fixture" };
  await assert.rejects(importAgencyKey(instant, env, async (url) => {
    assert.ok(url.startsWith("https://app.agencykey.com/"));
    return new Response(null, { status: 403 });
  }), /HTTP 403/);
});


test("usa fechas registradas y conserva la diferencia entre cero y dato ausente", () => {
  const data = {
    movements: [{ day: "2026-11-18", kind: "expense", amount: "10.12" }],
    sales: [{ day: "2026-11-19", net: "0.00" }, { day: "2026-11-21", gross: "100", crm_total: "100" }],
    commissions: [{ day: "2026-11-19", attributed: "8.00", commission: null }],
  };
  assert.deepEqual(dailyFinance(data), [
    { date: Date.parse("2026-11-18"), income: null, expenses: 10.12, profit: -10.12, provisional: false, net: null },
    { date: Date.parse("2026-11-19"), income: null, expenses: null, profit: null, provisional: true, net: 0 },
    { date: Date.parse("2026-11-21"), income: null, expenses: null, profit: null, provisional: false, net: null },
  ]);
  assert.equal(netSales([{ gross: 100, net: 80 }, { crm_total: 250 }]), 80);
});

test("agrupa ventas netas y movimientos por modelo y plataforma sin duplicar importes", () => {
  const data = {
    movements: [{ creator_id: creator, platform_id: "otra", kind: "income", amount: "0.10" },
      { creator_id: creator, platform_id: "otra", kind: "income", amount: "0.20" },
      { creator_id: null, platform_id: null, kind: "expense", amount: "3.00" }],
    sales: [{ creator_id: creator, net: "25.50" }],
  };
  assert.deepEqual(financeBreakdown(data, "model"), [
    { id: creator, income: .30, expenses: null, net: 25.50 },
    { id: null, income: null, expenses: 3, net: null },
  ]);
  assert.deepEqual(financeBreakdown(data, "platform"), [
    { id: "otra", income: .30, expenses: null, net: null },
    { id: null, income: null, expenses: 3, net: null },
    { id: ONLYFANS, income: null, expenses: null, net: 25.50 },
  ]);
});

test("importa solo el neto verificado y lo guarda en un lote sin reemplazar atribuciones", async () => {
  const env = { HERS_INTEGRATIONS_SECRET: Buffer.alloc(32).toString("base64"), SUPABASE_PUBLISHABLE_KEY: "fixture", AGENCYKEY_API_KEY: "fixture" };
  const calls = [];
  const result = await importNet("2026-11-19", env, async (url, options) => {
    calls.push([url, options]);
    if (url.includes("/v1/onlyfans/creators?")) return Response.json({
      data: [{ id: creator, name: "Modelo", creatorExternalId: 42 }], pagination: { pages: 1 },
    });
    if (url.includes("/42/api2/v2/earnings/chart?")) return Response.json({ data: { total: { total: "28.00", gross: 35 } } });
    return Response.json(null);
  }, false, Date.parse("2026-11-20T11:00:00Z"));
  assert.equal(result.creators, 1);
  const batch = JSON.parse(calls.at(-1)[1].body).p_data;
  assert.deepEqual(batch, { p_day: "2026-11-19", p_sales: [{ creator_key: creator, creator_name: "Modelo", net: 28 }], p_attributions: null });
  assert.equal(new URL(calls[2][0]).searchParams.get("startDate"), "2026-11-19 04:00:00");
  assert.deepEqual(await importNet("2026-11-21", env, () => assert.fail("No consultar en fechas futuras"),
    false, Date.parse("2026-11-20T11:00:00Z")), { day: "2026-11-21", future: true });
});

test("recurre a transacciones paginadas y bloquea ceros sin confirmar", async () => {
  const env = { HERS_INTEGRATIONS_SECRET: Buffer.alloc(32).toString("base64"), SUPABASE_PUBLISHABLE_KEY: "fixture", AGENCYKEY_API_KEY: "fixture" };
  const instant = Date.parse("2026-11-20T11:00:00Z");
  function send(rows) {
    return async (url, options) => {
      if (url.includes("/v1/onlyfans/creators?")) return Response.json({
        data: [{ id: creator, name: "Modelo", creatorExternalId: 42 }], pagination: { pages: 1 },
      });
      if (url.includes("/earnings/chart?")) return Response.json(new URL(url).searchParams.has("type") ? rows : []);
      if (url.includes("/payouts/transactions?")) {
        const later = new URL(url).searchParams.has("marker");
        const row = { id: "tx", createdAt: "2026-11-19T20:00:00Z", net: 28, amount: 35, currency: "USD", status: "loading" };
        if (!rows) return Response.json({ list: [], hasMore: false });
        const reversed = { ...row, id: "reversed", status: "undo", net: 12 };
        const chargeback = { ...row, id: "chargeback", chargebackAt: "2026-11-20T10:26:08Z", net: 3.6 };
        return Response.json({ list: later ? [row, reversed, chargeback, { ...row, id: "outside", createdAt: "2026-11-20T04:00:00Z" }] : [row],
          hasMore: !later, nextMarker: 123 });
      }
      if (url.includes("/crm/reports/creators?")) return Response.json({ data: [{ creatorId: creator, totalSalesCount: 1 }] });
      assert.equal(JSON.parse(options.body).p_action, "agencykey", "La prueba nunca escribe ventas");
      return Response.json(null);
    };
  }
  const result = await importNet("2026-11-19", env, send([{ type: "total", net: "28.00", gross: 35 }]), true, instant);
  assert.equal(result.creators, 1);
  const fallback = await importNet("2026-11-19", env, send([]), true, instant);
  assert.equal(fallback.transactionModels, 1);
  assert.equal(fallback.netTotal, 28);
  await assert.rejects(importNet("2026-11-19", env, send(null), true, instant), (error) => {
    assert.equal(error.code, "AK-NET-EMPTY");
    assert.match(error.message, /1 de 1 modelos.*Día 2026-11-19/);
    return true;
  });
});
