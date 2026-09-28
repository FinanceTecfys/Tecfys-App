/**
 * Sync Holded sales invoices and credit notes (API v2) into the local Supabase
 * database - the terminal twin of "Sincronizar con Holded" in /erp.
 *
 *   npm run sync:holded                      incremental (full on the first run)
 *   npm run sync:holded -- --full            re-read everything
 *   npm run sync:holded -- --from 2026-08-01 [--to 2026-08-31]
 *
 * Needs HOLDED_API_KEY in .env.local. Upserts by Num: re-running never duplicates.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { createHoldedClient } from "../src/modules/erp/holded/client";
import { readErpSettings, supabaseHoldedRepository } from "../src/modules/erp/repository";
import { runApiSync } from "../src/modules/erp/sync";

config({ path: ".env.local" });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseArgs(argv: string[]) {
  const out: { full: boolean; from: string | null; to: string | null } = { full: false, from: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") out.full = true;
    else if (a === "--from" || a === "--to") {
      const v = argv[++i];
      if (!v || !DAY.test(v)) throw new Error(`${a} expects a date YYYY-MM-DD`);
      out[a === "--from" ? "from" : "to"] = v;
    } else throw new Error(`Unknown argument ${a}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing in .env.local");
  const apiKey = process.env.HOLDED_API_KEY?.trim();
  if (!apiKey) throw new Error("HOLDED_API_KEY missing in .env.local (Holded -> Ajustes -> API)");
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } });

  const settings = await readErpSettings(sb);
  const result = await runApiSync({
    repo: supabaseHoldedRepository(sb),
    client: createHoldedClient({ apiKey, baseUrl: settings.holded_base_url }),
    triggeredBy: "cli:sync-holded",
    full: args.full,
    range: args.from || args.to ? { start: args.from, end: args.to } : undefined,
  });
  if (result.ok && result.window) {
    const w = result.window;
    console.log(`Window (${w.mode}): ${w.start ?? "beginning"} -> ${w.end ?? "today"}`);
  }
  const { fetched, created, updated, skipped, invalid } = result.counts;
  console.log(`Fetched ${fetched} · created ${created} · updated ${updated} · unchanged ${skipped} · rejected ${invalid}`);
  for (const m of result.messages) console.log(`  - ${m}`);
  if (!result.ok) throw new Error(result.error);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
