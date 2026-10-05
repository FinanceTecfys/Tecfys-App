"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";
import { erpSettingsSchema, type ErpSettingsInput } from "./domain/settings";
import type { SyncCounts } from "./domain/sync-plan";
import { appHoldedClient, isHoldedConfigured } from "./holded/server";
import { readErpSettings, supabaseHoldedRepository } from "./repository";
import { runApiSync } from "./sync";

export type ErpResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const NO_KEY = "Falta HOLDED_API_KEY en el entorno del servidor (.env.local)";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Pull sales invoices and credit notes from Holded and upsert them by Num. */
export async function syncHolded(): Promise<ErpResult<{ counts: SyncCounts; messages: string[] }>> {
  const user = await requireRole("erp.sync");
  if (!isHoldedConfigured()) return { ok: false, error: NO_KEY };
  try {
    const settings = await readErpSettings(db());
    const result = await runApiSync({
      repo: supabaseHoldedRepository(db()),
      client: appHoldedClient(settings.holded_base_url),
      triggeredBy: user.email ?? user.id,
    });
    revalidatePath("/erp");
    return result.ok ? { ok: true, data: { counts: result.counts, messages: result.messages } } : { ok: false, error: result.error };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** "Probar conexión": one authenticated, one-item call to the invoice list. */
export async function testHoldedConnection(): Promise<ErpResult<{ ms: number }>> {
  await requireRole("settings.access");
  if (!isHoldedConfigured()) return { ok: false, error: NO_KEY };
  try {
    const settings = await readErpSettings(db());
    const started = Date.now();
    await appHoldedClient(settings.holded_base_url).ping();
    return { ok: true, data: { ms: Date.now() - started } };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export async function saveErpSettings(input: ErpSettingsInput): Promise<ErpResult> {
  await requireRole("settings.access");
  const parsed = erpSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { error } = await db().from("erp_settings").upsert({ id: true, ...parsed.data }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
