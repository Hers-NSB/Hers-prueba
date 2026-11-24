import callApi from "../integrations/connectorApi";

export default function dropperApi(path, method, payload, signal) {
  return callApi(path, method, payload, signal, "/api/admin/dropper/api");
}
