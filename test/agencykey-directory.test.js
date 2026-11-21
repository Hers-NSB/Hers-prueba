import assert from "node:assert/strict";
import test from "node:test";
import { beginDirectory, finishDirectory, readAgencyDirectory } from "../cloudflare/agencykey-directory.js";

const owner = "a0000000-0000-4000-8000-000000000001";
const employee = "a0000000-0000-4000-8000-000000000002";
const model = "a0000000-0000-4000-8000-000000000003";
const members = [
  { id: owner, username: "Dirección", roles: [{ name: "Owner" }], status: "ACTIVE" },
  { id: employee, username: "Operaciones", roles: [{ name: "Team Leader" }], status: "INACTIVE" },
];
const creators = [{ id: model, name: "Modelo de prueba" }];

function mockMcp(url, options, badPage = false) {
  assert.equal(url, "https://app.agencykey.com/mcp");
  const { method, id, params } = JSON.parse(options.body);
  assert.equal(options.headers.Authorization, "Bearer test-access");
  if (method === "initialize") {
    return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18" } },
      { headers: { "Mcp-Session-Id": "test-session" } });
  }
  assert.equal(options.headers["Mcp-Session-Id"], "test-session");
  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  assert.equal(method, "tools/call");
  const { page } = params.arguments;
  const [data, total, pages] = params.name === "users_list_team_members" ? [[members[page - 1]], 2, 2] : [creators, 1, 1];
  const text = JSON.stringify({ data, pagination: { page, total: badPage && page > 1 ? 3 : total, pages } });
  const message = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
  return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
}

test("lee todas las páginas del directorio y conserva roles y estados", async () => {
  const snapshot = await readAgencyDirectory("test-access", mockMcp);
  assert.deepEqual(snapshot, {
    employees: [
      { id: owner, name: "Dirección", role: "Owner", active: true },
      { id: employee, name: "Operaciones", role: "Team Leader", active: false },
    ],
    creators: [{ id: model, name: "Modelo de prueba", role: "Modelo" }],
  });
  await assert.rejects(readAgencyDirectory("test-access", (url, options) => mockMcp(url, options, true)), /directorio completo/);
});

test("OAuth verifica el estado y la prueba PKCE antes de guardar el token cifrado", async () => {
  const project = "https://example.supabase.co";
  const app = "https://hers.example";
  const route = "/api/admin/integrations/agencykey-directory";
  const env = { HERS_INTEGRATIONS_SECRET: btoa("0123456789abcdef0123456789abcdef"), SUPABASE_PUBLISHABLE_KEY: "test" };
  const begin = await beginDirectory(new Request(app + route + "/connect"), owner, env, async (url, options) => {
    assert.equal(url, "https://app.agencykey.com/oauth/register");
    assert.equal(options.redirect, "manual");
    assert.deepEqual(JSON.parse(options.body).redirect_uris, [app + route + "/callback"]);
    return Response.json({ client_id: "test-client" });
  });
  const { authorize } = await begin.json();
  const query = new URL(authorize).searchParams;
  const cookie = begin.headers.get("Set-Cookie").split(";")[0];
  assert.match(begin.headers.get("Set-Cookie"), /Secure; HttpOnly; SameSite=Lax/);
  assert.equal(query.get("code_challenge_method"), "S256");

  const callback = (state) => new Request(app + route + "/callback?code=test-code&state=" + state, { headers: { Cookie: cookie } });
  const bad = await finishDirectory(callback("otro-estado"), project, env, () => assert.fail("Se abrió una sesión OAuth inválida"));
  assert.match(await bad.text(), /connected:false/);

  let saved = false;
  const result = await finishDirectory(callback(query.get("state")), project, env, async (url, options) => {
    if (url === "https://app.agencykey.com/oauth/token") {
      assert.equal(options.body.get("code"), "test-code");
      const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(options.body.get("code_verifier")));
      assert.equal(Buffer.from(challenge).toString("base64url"), query.get("code_challenge"));
      return Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 });
    }
    if (url.startsWith(project)) {
      const { p_action, p_data } = JSON.parse(options.body);
      assert.equal(p_action, "connect");
      assert.equal(p_data.user, owner);
      assert.match(p_data.connection, /^v1\./);
      assert.doesNotMatch(p_data.connection, /test-access|test-refresh/);
      assert.equal(p_data.snapshot.employees.length, 2);
      saved = true;
      return Response.json({ saved: true });
    }
    return mockMcp(url, options);
  });
  assert.equal(saved, true);
  assert.match(await result.text(), /connected:true/);
  assert.match(result.headers.get("Set-Cookie"), /Max-Age=0/);
});
