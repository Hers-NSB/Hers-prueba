import test from "node:test";
import assert from "node:assert/strict";
import { summarize } from "../src/panel/finanzas/finance.js";
import { importAgencyKey, normalizeReports, previousDay } from "../cloudflare/worker.js";

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
    commissions: 2.51, profit: 27.37, afterInvestment: 21.90, withoutRate: 1, withoutPlatformAmounts: 1 });
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
