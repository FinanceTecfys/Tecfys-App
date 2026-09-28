/**
 * Import the Holded sales export (sheet "Holded", header row 5) into the local
 * Supabase database - the fallback while the Holded API key is not available.
 *
 *   npm run import:holded -- "C:\path\Holded_data_base_API.xlsx"
 *
 * Same target shape and same upsert-by-Num as the API sync, so it is
 * idempotent: re-importing the file creates nothing and updates nothing.
 * The workbook holds client data: keep it out of the repo.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { supabaseHoldedRepository } from "../src/modules/erp/repository";
import { runExcelImport } from "../src/modules/erp/sync";
import { readHoldedWorkbook } from "./lib/holded-workbook";

config({ path: ".env.local" });

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: npm run import:holded -- "<path to Holded xlsx>"');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing in .env.local");
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } });

  const results = await readHoldedWorkbook(path);
  console.log(`Read ${results.length} rows from the Holded sheet`);
  const result = await runExcelImport({ repo: supabaseHoldedRepository(sb), results, triggeredBy: "cli:import-holded" });
  const { fetched, created, updated, skipped, invalid } = result.counts;
  console.log(`Rows ${fetched} · created ${created} · updated ${updated} · unchanged ${skipped} · rejected ${invalid}`);
  for (const m of result.messages) console.log(`  - ${m}`);
  if (!result.ok) throw new Error(result.error);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
