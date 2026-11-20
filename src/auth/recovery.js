export const recoveryPath = "/restablecer-contrasena";

export function readRecoveryTokens(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  return params.get("type") === "recovery" && access_token && refresh_token
    ? { access_token, refresh_token }
    : null;
}
