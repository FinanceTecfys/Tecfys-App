"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { requireRole } from "@/lib/supabase/auth";
import type { Messages } from "@/i18n/types";
import { db } from "@/lib/supabase/server";

export type CatalogResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Validation messages are keys of settings.catalog.errors; each action translates them for the user. */
type CatalogError = keyof Messages["settings"]["catalog"]["errors"];
const key = (k: CatalogError) => k;

const distributorSchema = z.object({
  name: z.string().trim().min(2, key("nameTooShort")),
  cif: z.string().trim().optional().transform((v) => v || null),
  email: z.union([z.email(key("emailInvalid")), z.literal("")]).optional().transform((v) => v || null),
});

const assetTypeSchema = z.object({
  name: z.string().trim().min(2, key("nameTooShort")),
  cluster: z.string().trim().min(1, key("clusterRequired")),
});

const UNIQUE_VIOLATION = "23505";

export async function createDistributor(input: z.input<typeof distributorSchema>): Promise<CatalogResult<{ id: string; name: string }>> {
  await requireRole("settings.access");
  const t = await getTranslations("settings.catalog.errors");
  const parsed = distributorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t(parsed.error.issues[0].message as CatalogError) };
  const { data, error } = await db().from("distributors").insert(parsed.data).select("id, name").single();
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? t("distributorExists") : error.message };
  revalidatePath("/settings");
  return { ok: true, data };
}

export async function createAssetType(input: z.input<typeof assetTypeSchema>): Promise<CatalogResult<{ id: string; name: string }>> {
  await requireRole("settings.access");
  const t = await getTranslations("settings.catalog.errors");
  const parsed = assetTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t(parsed.error.issues[0].message as CatalogError) };
  const { data, error } = await db().from("asset_types").insert(parsed.data).select("id, name").single();
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? t("assetTypeExists") : error.message };
  revalidatePath("/settings");
  return { ok: true, data };
}

export async function setDistributorActive(id: string, active: boolean): Promise<CatalogResult> {
  await requireRole("settings.access");
  const { error } = await db().from("distributors").update({ active }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function setAssetTypeActive(id: string, active: boolean): Promise<CatalogResult> {
  await requireRole("settings.access");
  const { error } = await db().from("asset_types").update({ active }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
