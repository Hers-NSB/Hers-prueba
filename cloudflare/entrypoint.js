import { WorkerEntrypoint } from "cloudflare:workers";
import { storedAgencyKey } from "./integrations.js";
import { project } from "./worker.js";

export { default } from "./worker.js";

export class DropperAgencyKey extends WorkerEntrypoint {
  async read() {
    return (await storedAgencyKey(project, this.env)) ?? null;
  }
}
