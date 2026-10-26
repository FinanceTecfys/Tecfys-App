import { z } from "zod";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The public origin of this deployment: https://app.tecfys.com (production),
 * https://staging.tecfys.com (staging), http://127.0.0.1:3000 (local). Emailed
 * links (invitation, password recovery) are built on it, never on the request
 * host. An origin only - no path, query or trailing slash - and https except on
 * a local host. Normalised to the bare origin.
 */
const siteUrl = z.string({ error: "is missing" }).transform((raw, ctx) => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    ctx.addIssue({ code: "custom", message: "must be an absolute URL such as https://app.tecfys.com" });
    return z.NEVER;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    ctx.addIssue({ code: "custom", message: "must use https (http only for localhost / 127.0.0.1)" });
    return z.NEVER;
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    ctx.addIssue({ code: "custom", message: "must be an origin only, without path, query or credentials" });
    return z.NEVER;
  }
  return url.origin;
});

const schema = z.object({
  SUPABASE_URL: z.url({ error: "is missing or not a URL" }),
  SUPABASE_SECRET_KEY: z.string({ error: "is missing - copy it from `supabase status` / Project Settings > API Keys" }),
  // Publishable (anon) key: only used for Supabase Auth sessions, never for table access.
  SUPABASE_PUBLISHABLE_KEY: z.string({ error: "is missing - copy it from `supabase status` / Project Settings > API Keys" }),
  SITE_URL: siteUrl,
  SIGNATURIT_API_URL: z.url().optional(),
  SIGNATURIT_TOKEN: z.string().optional(),
  // Holded API v2 key (Holded -> Ajustes -> API). Server-only: never sent to the browser or stored in the DB.
  HOLDED_API_KEY: z.string().optional(),
  // Informa D&B API v2. Server-only: the credentials and the session are never sent to the browser or stored in the DB.
  // The URL must be https *.informa.es (checked by the Informa client, which refuses any other host).
  INFORMA_API_URL: z.string().optional(),
  INFORMA_USERNAME: z.string().optional(),
  // Portal password: the app logs in (POST /login) and renews the session by itself.
  INFORMA_PASSWORD: z.string().optional(),
  // Optional: a session to try first. Not needed; replaced automatically when missing or expired.
  INFORMA_SESSION: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

/** Every variable the server reads; .env.example lists exactly these. */
export const SERVER_ENV_KEYS = Object.keys(schema.shape) as (keyof ServerEnv)[];

/**
 * Validate an environment. An empty value counts as unset (a blank line copied
 * from .env.example). Throws ONE error naming every missing or invalid variable:
 * names and reasons only, never a value - they are secrets.
 */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const present = Object.fromEntries(SERVER_ENV_KEYS.flatMap((key) => (source[key]?.trim() ? [[key, source[key]]] : [])));
  const result = schema.safeParse(present);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")} ${issue.message}`);
  throw new Error(`Invalid server environment (see .env.example / docs/DEPLOYMENT.md):\n${problems.join("\n")}`);
}

let cached: ServerEnv | null = null;

/** Server-side environment, validated at server start (src/instrumentation.ts) and cached. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
