import { manualDropPhoto } from "./handler.ts";

const project = Deno.env.get("SUPABASE_URL");
const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
const key = Object.values(secrets).find(
  (value): value is string => typeof value === "string" && value.startsWith("sb_secret_"),
) ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve((request) => manualDropPhoto(request, project, key));
