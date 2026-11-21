import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistribution, calculateModelDistribution, effectivePlan, shareUnits, totalShares } from "../src/panel/finanzas/distribution.js";

test("reparte la suma de todos los modelos con el plan vigente de cada fecha", () => {
  const plans = [
    { effective_on: "2026-11-20", revision: 1, shares: { hers: 2_500 } },
    { effective_on: "2026-11-20", revision: 2, shares: { hers: 5_000, dropper: 2_500 } },
    { effective_on: "2026-11-22", revision: 1, shares: { dropper: 10_000 } },
  ];
  const result = calculateDistribution([
    { day: "2026-11-19", net: "20.00" },
    { day: "2026-11-20", net: "5.15" },
    { day: "2026-11-20", net: "4.85" },
    { day: "2026-11-22", net: "10.00" },
    { day: "2026-11-22", crm_total: "100", net: null },
  ], plans);
  assert.equal(effectivePlan(plans, "2026-11-21").revision, 2);
  assert.equal(result.total, 40);
  assert.equal(result.payouts.get("hers"), 27.5);
  assert.equal(result.payouts.get("dropper"), 12.5);
});

test("conserva los centavos con varios beneficiarios y devoluciones", () => {
  const plans = [{ effective_on: "2026-11-20", shares: { a: 3333, b: 3333, c: 3334 } }];
  const sales = [{ day: "2026-11-20", net: 0.02 }, { day: "2026-11-21", net: -0.01 }];
  const result = calculateDistribution(sales, plans);
  assert.deepEqual(result.payouts, new Map([["c", 0], ["a", 0.01], ["b", 0], ["hers", 0]]));
  assert.equal(result.total, 0.01);
  assert.equal(totalShares({ a: shareUnits("33.33"), b: shareUnits("66.67") }), 10_000);
  assert.equal(calculateDistribution([], plans).total, null);
});


test("la bóveda recibe las cuotas sin asignar y las de empleados retirados a partir de su baja", () => {
  const shares = { "chatter:person": 6000, hers: 1500 };
  const sales = [{ day: "2026-11-19", net: 100 }, { day: "2026-11-20", net: 100 }];
  const result = calculateDistribution(sales, [{ effective_on: "2026-11-19", shares }],
    [{ id: "person", archived_on: "2026-11-20" }]);
  assert.equal(result.payouts.get("chatter:person"), 60);
  assert.equal(result.payouts.get("hers"), 140);
});

test("calcula cada porcentaje sobre el neto de los modelos asignados y respeta su vigencia", () => {
  const first = "2026-11-01";
  const second = "2026-11-02";
  const third = "2026-11-03";
  const sales = [
    { day: first, creator_id: "A", net: "100.00" },
    { day: second, creator_id: "A", net: "120.00" },
    { day: second, creator_id: "B", net: "200.00" },
    { day: third, creator_id: "A", net: "80.00" },
    { day: third, creator_id: "B", net: "-12.35" },
  ];
  const plans = [{ effective_on: first, shares: { "chatter:Amy": 1000 } }];
  const members = [{ id: "Amy" }, { id: "Bea", archived_on: third }];
  const rates = [
    { effective_on: second, member_id: "Amy", creator_ids: ["A"], percent: "20.00" },
    { effective_on: second, member_id: "Bea", creator_ids: ["A", "B"], percent: "10.00" },
    { effective_on: second, creator_id: "B", creator_ids: [], percent: "50.00" },
    { effective_on: third, member_id: "Amy", creator_ids: ["B"], percent: "10.00" },
  ];
  const result = calculateModelDistribution(sales, plans, members, rates);
  assert.equal(result.total, 487.65);
  assert.equal(result.payouts.get("chatter:Amy"), 32.76);
  assert.equal(result.payouts.get("chatter:Bea"), 32);
  assert.equal(result.payouts.get("model:B"), 93.82);
  assert.equal(result.payouts.get("hers"), 329.07);
  assert.deepEqual([...result.agencyByDay.values()], [90, 164, 75.07]);
});

test("paga al chatter sobre todas sus ventas atribuidas y conserva la base de otros roles", () => {
  const day = "2026-11-24";
  const sales = [{ day, creator_id: "A", net: "1000.00" }, { day, creator_id: "B", net: "500.00" }];
  const members = [{ id: "chatter", agencykey_id: "ak-chatter" }, { id: "lead" }];
  const rates = [
    { effective_on: day, member_id: "chatter", basis: "employee_sales", creator_ids: [], percent: "10.00" },
    { effective_on: day, member_id: "lead", basis: "model_sales", creator_ids: ["B"], percent: "10.00" },
    { effective_on: day, creator_id: "A", basis: "model_sales", creator_ids: [], percent: "40.00" },
  ];

  const result = calculateModelDistribution(sales, [], members, rates, [], [{ day, totals: { "ak-chatter": 320 } }]);
  assert.equal(result.payouts.get("chatter:chatter"), 32);
  assert.equal(result.payouts.get("chatter:lead"), 50);
  assert.equal(result.payouts.get("model:A"), 400);
  assert.equal(result.payouts.get("hers"), 1018);

  const missing = calculateModelDistribution(sales, [], members, rates);
  assert.ok(missing.pendingDays.has(day));
  assert.equal(missing.payouts.has("chatter:chatter"), false);
  assert.equal(missing.payouts.has("hers"), false);

  const zero = calculateModelDistribution(sales, [], members, rates, [], [{ day, totals: {} }]);
  assert.equal(zero.payouts.get("chatter:chatter"), 0);
  assert.equal(zero.payouts.get("hers"), 1050);
});
