import "server-only";
import { db } from "@/lib/supabase/server";

export async function listDistributors({ activeOnly = false } = {}) {
  let q = db().from("distributors").select("id, name, cif, email, active").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function listAssetTypes({ activeOnly = false } = {}) {
  let q = db().from("asset_types").select("id, name, cluster, active").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function listContractTypes() {
  const { data, error } = await db().from("contract_types").select("code, label, billing_lag_months").order("code");
  if (error) throw error;
  return data;
}

export type Distributor = Awaited<ReturnType<typeof listDistributors>>[number];
export type AssetType = Awaited<ReturnType<typeof listAssetTypes>>[number];
export type ContractType = Awaited<ReturnType<typeof listContractTypes>>[number];
