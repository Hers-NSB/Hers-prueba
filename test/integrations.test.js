import test from "node:test";
import assert from "node:assert/strict";
import { bridgeToken, handleIntegrations, storedAgencyKey } from "../cloudflare/integrations.js";

const base = "https://example.test/api/admin/integrations";
const project = "https://supabase.example.test";
const env = {
  HERS_INTEGRATIONS_SECRET: Buffer.alloc(32, 1).toString("base64"),
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};
const auth = { Authorization: "Bearer test-session" };
const user = "00000000-0000-4000-8000-000000000001";
const noSync = () => assert.fail("La sincronización no debía ejecutarse");

test("rechaza visitantes, chatters y sesiones que solo tienen rol en user_metadata", async () => {
  const anonymous = await handleIntegrations(new Request(base), project, env, noSync, () => assert.fail());
  assert.equal(anonymous.status, 401);
  const chatter = await handleIntegrations(new Request(base, { headers: auth }), project, env, noSync,
    async (url) => {
      assert.equal(url, `${project}/auth/v1/user`);
      return Response.json({ id: user, app_metadata: { role: "chatter" }, user_metadata: { role: "admin" } });
    });
  assert.equal(chatter.status, 403);
});

test("envía la credencial cifrada a Supabase y el Worker puede recuperarla para sincronizar", async () => {
  const value = "test-credential-without-live-access";
  let encrypted;
  const req = new Request(`${base}/credential`, {
    method: "PUT", headers: auth, body: JSON.stringify({ service: "agencykey", kind: "api-key", value }),
  });
  const saved = await handleIntegrations(req, project, env, noSync, async (url, options) => {
    if (url.endsWith("/user")) return Response.json({ id: user, app_metadata: { role: "admin" } });
    const { p_action, p_token, p_data } = JSON.parse(options.body);
    assert.equal(p_action, "save");
    assert.equal(p_token, await bridgeToken(env.HERS_INTEGRATIONS_SECRET));
    assert.equal(p_data.updated_by, user);
    assert.ok(!options.body.includes(value));
    encrypted = p_data.ciphertext;
    return Response.json({ saved: true });
  });
  assert.deepEqual(await saved.json(), { saved: true });
  assert.equal(saved.headers.get("Cache-Control"), "no-store");

  const returned = await storedAgencyKey(project, env, async () => Response.json({ ciphertext: encrypted }));
  assert.equal(returned, value);
  await assert.rejects(storedAgencyKey(project, { ...env, HERS_INTEGRATIONS_SECRET: Buffer.alloc(32, 2).toString("base64") },
    async () => Response.json({ ciphertext: encrypted })));
});

test("distingue probar conexión y sincronizar y bloquea orígenes ajenos", async () => {
  const mock = async () => Response.json({ id: user, app_metadata: { role: "admin" } });
  const run = (testOnly) => ({ testOnly, day: "2026-11-19", creators: 1, attributions: 1 });
  for (const [action, expected] of [["test", true], ["sync", false]]) {
    const res = await handleIntegrations(new Request(`${base}/${action}`, { method: "POST", headers: auth }),
      project, env, run, mock);
    assert.equal((await res.json()).testOnly, expected);
  }
  const blocked = await handleIntegrations(new Request(`${base}/sync`, {
    method: "POST", headers: { ...auth, Origin: "https://unrelated.test" },
  }), project, env, noSync, () => assert.fail());
  assert.equal(blocked.status, 403);
});

test("devuelve el código y una referencia que se puede leer desde el panel existente", async () => {
  const response = await handleIntegrations(new Request(base, { headers: auth }), project, env, noSync,
    async (url) => url.endsWith("/user") ? Response.json({ id: user, app_metadata: { role: "admin" } })
      : new Response("contenido interno que no debe llegar al panel", { status: 404 }));
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.code, "SB-CON-RPC");
  assert.equal(result.reference, response.headers.get("X-HERS-Request-ID"));
  assert.equal(result.error, `[SB-CON-RPC] Supabase rechazó la operación de Conectores (HTTP 404) · Ref. ${result.reference}`);
});
