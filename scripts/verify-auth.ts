/**
 * Verify Supabase Auth against the RUNNING local stack, through the same
 * endpoint the app's login uses (POST /auth/v1/token?grant_type=password).
 *
 *   npm run verify:auth                                   (throwaway user, created and deleted)
 *   npm run verify:auth -- --email you@tecfys.com --password '...'   (an existing user)
 *
 * Fails when:
 *  - config.toml closes the email provider or opens public sign-up;
 *  - the running GoTrue does not match config.toml (the stack was not
 *    restarted after a config change - run `supabase stop && supabase start`);
 *  - public sign-up is accepted;
 *  - the password grant does not return an access_token for a valid user,
 *    or accepts a wrong password.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { authSwitchesFromConfig, authSwitchesFromSettings, REQUIRED_AUTH_SWITCHES } from "../src/lib/auth/supabase-config";

config({ path: ".env.local" });

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set in .env.local`);
  return value;
}
const url = requiredEnv("SUPABASE_URL");
const publishable = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const secret = requiredEnv("SUPABASE_SECRET_KEY");

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const auth = (path: string, key: string, init: RequestInit = {}) =>
  fetch(`${url}/auth/v1${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });

/** The app's login call: GoTrue's password grant with the publishable key. */
const passwordGrant = (email: string, password: string) =>
  auth("/token?grant_type=password", publishable, { method: "POST", body: JSON.stringify({ email, password }) });

async function main() {
  // 1. The committed configuration.
  const configured = authSwitchesFromConfig(readFileSync("supabase/config.toml", "utf8"));
  check("config.toml: public sign-up closed, email provider on", JSON.stringify(configured) === JSON.stringify(REQUIRED_AUTH_SWITCHES), JSON.stringify(configured));

  // 2. What the running GoTrue actually uses (catches a stack started before a config change).
  const settingsRes = await auth("/settings", publishable);
  const running = authSwitchesFromSettings(await settingsRes.json());
  check(
    "running GoTrue matches config.toml",
    settingsRes.ok && JSON.stringify(running) === JSON.stringify(configured),
    settingsRes.ok ? `running ${JSON.stringify(running)}; restart with supabase stop && supabase start if they differ` : `HTTP ${settingsRes.status}`,
  );

  // 3. Nobody can register themselves.
  const probe = `signup-probe-${Date.now()}@tecfys.test`;
  const signup = await auth("/signup", publishable, { method: "POST", body: JSON.stringify({ email: probe, password: `Pw-${Date.now()}-x9!` }) });
  const signupBody = (await signup.json().catch(() => ({}))) as { error_code?: string; code?: string | number; id?: string; user?: { id?: string } };
  check("public sign-up is rejected", !signup.ok, `HTTP ${signup.status} ${signupBody.error_code ?? signupBody.code ?? ""}`);
  const leaked = signupBody.user?.id ?? signupBody.id;
  if (leaked) await auth(`/admin/users/${leaked}`, secret, { method: "DELETE" });

  // 4. The real password grant, for an existing user or a throwaway one created by an admin.
  let email = arg("email");
  let password = arg("password");
  let throwawayId: string | undefined;
  if (!email || !password) {
    email = `verify-auth-${Date.now()}@tecfys.test`;
    password = `Pw-${Math.random().toString(36).slice(2)}-x9!`;
    const created = await auth("/admin/users", secret, { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
    throwawayId = ((await created.json()) as { id?: string }).id;
    check("admin can provision a user (sign-up closed)", created.ok && Boolean(throwawayId), `HTTP ${created.status}`);
  }
  try {
    const good = await passwordGrant(email, password);
    const body = (await good.json()) as { access_token?: string; error_code?: string; msg?: string };
    check(
      "POST /auth/v1/token?grant_type=password returns an access_token",
      good.ok && typeof body.access_token === "string" && body.access_token.length > 20,
      good.ok ? `user ${email}` : `HTTP ${good.status} ${body.error_code ?? ""} ${body.msg ?? ""}`,
    );

    const bad = await passwordGrant(email, `${password}-wrong`);
    const badBody = (await bad.json()) as { error_code?: string };
    check("a wrong password is refused as invalid credentials", bad.status === 400 && badBody.error_code === "invalid_credentials", `HTTP ${bad.status} ${badBody.error_code ?? ""}`);
  } finally {
    if (throwawayId) {
      const del = await auth(`/admin/users/${throwawayId}`, secret, { method: "DELETE" });
      check("throwaway user deleted", del.ok, `HTTP ${del.status}`);
    }
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll auth checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
