import test from "node:test";
import assert from "node:assert/strict";
import { readRecoveryTokens } from "../src/auth/recovery.js";

test("lee ambos tokens de un enlace de recuperación", () => {
  assert.deepEqual(readRecoveryTokens("#type=recovery&access_token=access&refresh_token=refresh"),
    { access_token: "access", refresh_token: "refresh" });
});

test("rechaza enlaces que no son de recuperación o tienen tokens incompletos", () => {
  for (const hash of ["", "#error_code=otp_expired", "#type=recovery&access_token=access",
    "#type=invite&access_token=access&refresh_token=refresh"]) {
    assert.equal(readRecoveryTokens(hash), null);
  }
});
