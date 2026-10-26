/**
 * Create the first owner (finance@tecfys.com) on a fresh Supabase project.
 *
 *   npm run bootstrap:owner -- --dry-run     (only says what it would do)
 *   npm run bootstrap:owner                  (does it)
 *   npm run bootstrap:owner -- --resend      (re-sends a pending invitation)
 *
 * Reads the same variables as the app (src/lib/env.ts): .env.local, unless they
 * are already set in the shell - shell values win, so a cloud run sets
 * SUPABASE_URL / SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY / SITE_URL of the
 * target first (docs/DEPLOYMENT.md).
 *
 * Safe to run any number of times: it invites the owner only when the Auth user
 * does not exist (the seed_owner_profile trigger then writes the owner profile),
 * writes or reactivates the profile only when it is missing or inactive, and
 * otherwise reports "done". It never changes another user's role.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { parseServerEnv } from "../src/lib/env";
import { OWNER_EMAIL } from "../src/lib/auth/permissions";
import { planOwnerBootstrap } from "../src/modules/users/domain/owner-bootstrap";

config({ path: ".env.local" });

const PER_PAGE = 200;
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const env = parseServerEnv(process.env);
  const dryRun = flag("dry-run");
  const sb = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`Target project ${new URL(env.SUPABASE_URL).host}; invitation links to ${env.SITE_URL}${dryRun ? "  [dry run]" : ""}`);

  const findUser = async () => {
    for (let page = 1; ; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw error;
      const user = data.users.find((u) => u.email?.toLowerCase() === OWNER_EMAIL);
      if (user || data.users.length < PER_PAGE) return user ?? null;
    }
  };
  const readProfile = async (userId: string) => {
    const { data, error } = await sb.from("profiles").select("user_id, role, active").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  };

  const user = await findUser();
  const { data: owner, error: ownerError } = await sb.from("profiles").select("user_id").eq("role", "owner").maybeSingle();
  if (ownerError) throw ownerError;
  const step = planOwnerBootstrap({ user, profile: user ? await readProfile(user.id) : null, ownerUserId: owner?.user_id ?? null });

  switch (step.kind) {
    case "conflict":
      throw new Error(`Not bootstrapping ${OWNER_EMAIL}: ${step.reason}.`);
    case "done":
      if (step.invitePending && flag("resend")) {
        if (!dryRun) {
          const { error } = await sb.auth.admin.inviteUserByEmail(OWNER_EMAIL, { redirectTo: env.SITE_URL });
          if (error) throw error;
        }
        console.log(`Invitation to ${OWNER_EMAIL} re-sent.`);
      } else {
        console.log(`Done already: ${OWNER_EMAIL} is the active owner (${step.userId}).`);
        if (step.invitePending) console.log("The invitation is still pending (no password set yet). Re-send it with --resend.");
      }
      return;
    case "invite": {
      console.log(`Inviting ${OWNER_EMAIL}...`);
      if (dryRun) return;
      const { data, error } = await sb.auth.admin.inviteUserByEmail(OWNER_EMAIL, { redirectTo: env.SITE_URL });
      if (error) throw error;
      // The trigger normally wrote the profile; cover a project where it did not.
      if (!(await readProfile(data.user.id))) {
        const { error: insertError } = await sb.from("profiles").insert({ user_id: data.user.id, role: "owner" });
        if (insertError) throw insertError;
      }
      console.log(`Invitation sent to ${OWNER_EMAIL}; the owner sets a password from the email link.`);
      return;
    }
    case "create-profile": {
      console.log(`Writing the owner profile of the existing user ${step.userId}...`);
      if (dryRun) return;
      const { error } = await sb.from("profiles").insert({ user_id: step.userId, role: "owner" });
      if (error) throw error;
      console.log("Owner profile written.");
      return;
    }
    case "activate": {
      console.log(`Reactivating the owner profile of ${step.userId}...`);
      if (dryRun) return;
      const { error } = await sb.from("profiles").update({ active: true }).eq("user_id", step.userId);
      if (error) throw error;
      console.log("Owner profile reactivated.");
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
