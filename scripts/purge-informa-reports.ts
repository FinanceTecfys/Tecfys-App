/**
 * Delete every stored Informa report and the informa-reports bucket itself.
 *
 *   npm run purge:informa-reports -- --dry-run   (counts only, deletes nothing)
 *   npm run purge:informa-reports
 *
 * Zero retention (migration 20261026000000): Tecfys does not keep Informa
 * reports. Supabase forbids SQL deletes on storage tables, so the bucket is
 * emptied and removed through the Storage API here. Run it once on every
 * project that ever had the bucket - including a fresh cloud project, where
 * migration 20261004000000 still creates it empty.
 *
 * Reads the same variables as the app (src/lib/env.ts): .env.local unless set in
 * the shell (shell values win). Safe to re-run: with the bucket gone it only
 * reports "nothing to purge". Touches no other bucket, and checks that
 * contract-attachments holds the same number of files before and after.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseServerEnv } from "../src/lib/env";

config({ path: ".env.local" });

const BUCKET = "informa-reports";
const KEEP = "contract-attachments";
const PAGE = 1000;
const REMOVE_BATCH = 100;

/** Every object path of a bucket, folders walked recursively. */
async function listAll(sb: SupabaseClient, bucket: string, prefix = ""): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder has no id; a file has one (and its size in metadata).
      if (entry.id === null) out.push(...(await listAll(sb, bucket, path)));
      else out.push({ path, size: Number(entry.metadata?.size ?? 0) });
    }
    if (data.length < PAGE) return out;
  }
}

async function main() {
  const env = parseServerEnv(process.env);
  const dryRun = process.argv.includes("--dry-run");
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`Target project ${new URL(env.SUPABASE_URL).host}${dryRun ? "  [dry run]" : ""}`);

  const keptBefore = (await listAll(sb, KEEP)).length;
  console.log(`${KEEP}: ${keptBefore} files (must stay untouched)`);

  const { data: bucket } = await sb.storage.getBucket(BUCKET);
  if (!bucket) {
    console.log(`${BUCKET}: bucket does not exist - nothing to purge.`);
    return;
  }

  const files = await listAll(sb, BUCKET);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  console.log(`${BUCKET}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  if (dryRun) {
    console.log(`Would delete ${files.length} files and the bucket ${BUCKET}.`);
    return;
  }

  let removed = 0;
  for (let i = 0; i < files.length; i += REMOVE_BATCH) {
    const { data, error } = await sb.storage.from(BUCKET).remove(files.slice(i, i + REMOVE_BATCH).map((f) => f.path));
    if (error) throw error;
    removed += data.length;
  }
  const { error: deleteError } = await sb.storage.deleteBucket(BUCKET);
  if (deleteError) throw deleteError;
  console.log(`Deleted ${removed} files and the bucket ${BUCKET}.`);

  const keptAfter = (await listAll(sb, KEEP)).length;
  console.log(`${KEEP}: ${keptAfter} files`);
  if (keptAfter !== keptBefore) throw new Error(`${KEEP} changed from ${keptBefore} to ${keptAfter} files - investigate`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
