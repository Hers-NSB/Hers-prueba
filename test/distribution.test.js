import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistribution, effectivePlan, shareUnits, totalShares } from "../src/panel/finanzas/distribution.js";

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
