import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker.js";

const origin = "https://hers.example";
const root = `${origin}/api/admin/dropper`;

test("Dropper routes only forward the embedded views and authorized API requests", async () => {
  const requests = [];
  const env = { DROPPER: { async fetch(request) {
    requests.push(request);
    return new Response("from Dropper", { status: 202 });
  } } };
  const call = (path, init) => worker.fetch(new Request(root + path, init), env);

  assert.equal((await call("/unknown")).status, 404);
  assert.equal((await call("/view/bots", { method: "POST" })).status, 405);
  assert.equal((await call("/api/profiles")).status, 401);
  assert.equal((await call("/api/access", { method: "POST", headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal(requests.length, 0);

  assert.equal((await call("/view/bots?unneeded=1", { headers: { Cookie: "private" } })).status, 202);
  assert.equal(requests[0].url, `${origin}/embed/bots`);
  assert.equal(requests[0].headers.get("Cookie"), null);

  const headers = { Authorization: "Bearer test-admin", Origin: origin, "If-Match": "3",
    "Content-Type": "application/json", Cookie: "private" };
  assert.equal((await call("/api/access", { method: "POST", headers, body: '{"code":"test-new-code"}' })).status, 202);
  assert.equal(requests[1].url, `${origin}/v1/hers-admin/access`);
  assert.equal(requests[1].headers.get("Authorization"), "Bearer test-admin");
  assert.equal(requests[1].headers.get("Cookie"), null);
  assert.deepEqual(await requests[1].json(), { code: "test-new-code" });

  await call("/api/drops?date=2026-11-16", { headers });
  assert.equal(requests[2].url, `${origin}/v1/hers-admin/drops?date=2026-11-16`);
});

test("missing or unavailable Dropper is reported without using the public page fallback", async () => {
  const request = new Request(`${root}/view/operations`);
  assert.equal((await worker.fetch(request, {})).status, 503);
  const env = { DROPPER: { fetch() { throw new Error("private upstream error"); } } };
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private upstream error/);
});
