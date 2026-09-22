"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/supabase/server";

export type CatalogResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const distributorSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto"),
  cif: z.string().trim().optional().transform((v) => v || null),
  email: z.union([z.email("Email no válido"), z.literal("")]).optional().transform((v) => v || null),
});

const assetTypeSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto"),
  cluster: z.string().trim().min(1, "Selecciona un grupo"),
});

const UNIQUE_VIOLATION = "23505";

export async function createDistributor(input: z.input<typeof distributorSchema>): Promise<CatalogResult<{ id: string; name: string }>> {
  const parsed = distributorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { data, error } = await db().from("distributors").insert(parsed.data).select("id, name").single();
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? "Ya existe un distribuidor con ese nombre" : error.message };
  revalidatePath("/settings");
  return { ok: true, data };
}

export async function createAssetType(input: z.input<typeof assetTypeSchema>): Promise<CatalogResult<{ id: string; name: string }>> {
  const parsed = assetTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { data, error } = await db().from("asset_types").insert(parsed.data).select("id, name").single();
  if (error) return { ok: false, error: error.code === UNIQUE_VIOLATION ? "Ya existe un tipo de activo con ese nombre" : error.message };
  revalidatePath("/settings");
  return { ok: true, data };
}

export async function setDistributorActive(id: string, active: boolean): Promise<CatalogResult> {
  const { error } = await db().from("distributors").update({ active }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}

export async function setAssetTypeActive(id: string, active: boolean): Promise<CatalogResult> {
  const { error } = await db().from("asset_types").update({ active }).eq("id", z.uuid().parse(id));
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
