import assert from "node:assert/strict";
import test from "node:test";
import { manualDropPhoto } from "../supabase/functions/manual-drop-photo/handler.ts";

const project = "https://project.example";
const path = "ed729395-a728-42c1-80b2-136013383b41/ed729395-a728-42c1-80b2-136013383b42.jpg";
const validToken = "a".repeat(64);
const makeRequest = (file, token) => new Request(`${project}/functions/v1/manual-drop-photo?${new URLSearchParams({ path: file })}`, {
  headers: token ? { "X-HERS-Photo-Token": token } : {},
});

test("Dropper photo access rejects missing credentials and paths outside the bucket", async () => {
  const unused = () => assert.fail("Request must fail before reading Supabase");
  assert.equal((await manualDropPhoto(makeRequest(path), project, "secret", unused)).status, 401);
  assert.equal((await manualDropPhoto(makeRequest("model-photos/../avatar.jpg", validToken), project, "secret", unused)).status, 400);
  const rejected = async (url) => {
    assert.equal(url, `${project}/rest/v1/rpc/manual_drop_photo_authorized`);
    return Response.json(false);
  };
  assert.equal((await manualDropPhoto(makeRequest(path, validToken), project, "secret", rejected)).status, 403);
});

test("Dropper photo access checks the credential before streaming a private image", async () => {
  const calls = [];
  const key = "sb_secret_test";
  const send = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.apikey, key);
    assert.equal(options.headers.Authorization, undefined);
    if (calls.length === 1) {
      assert.equal(url, `${project}/rest/v1/rpc/manual_drop_photo_authorized`);
      assert.deepEqual(JSON.parse(options.body), { p_token: validToken });
      return Response.json(true);
    }
    assert.equal(url, `${project}/storage/v1/object/authenticated/manual-drop-photos/${path}`);
    return new Response(Uint8Array.of(255, 216, 255), { headers: { "Content-Type": "image/jpeg" } });
  };
  const result = await manualDropPhoto(makeRequest(path, validToken), project, key, send);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), Uint8Array.of(255, 216, 255));
  assert.equal(calls.length, 2);
});
