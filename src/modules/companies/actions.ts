"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslate } from "@/i18n/server";
import { requireRole } from "@/lib/supabase/auth";
import { db } from "@/lib/supabase/server";

export type DecideChangeResult = { ok: true; status: "applied" | "rejected" } | { ok: false; error: string };

const decideSchema = z.object({ id: z.uuid(), approve: z.boolean() });

/**
 * Approve or reject ONE pending company change (owner / admin). Approving
 * applies the proposed value to the company; both record who decided and when.
 * One database function, so the company and the change row move together.
 */
export async function decideCompanyChange(input: { id: string; approve: boolean }): Promise<DecideChangeResult> {
  const user = await requireRole("companyChanges.review");
  const translate = await getTranslate();
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: translate("companies.review.errors.notFound") };

  const { data, error } = await db().rpc("decide_company_change", { p_change_id: parsed.data.id, p_approve: parsed.data.approve, p_actor: user.id });
  if (error) return { ok: false, error: error.message };
  if (data === "not_found") return { ok: false, error: translate("companies.review.errors.notFound") };
  if (data === "not_pending") return { ok: false, error: translate("companies.review.errors.alreadyDecided") };
  if (data !== "applied" && data !== "rejected") return { ok: false, error: translate("companies.review.errors.failed") };

  revalidatePath("/settings");
  return { ok: true, status: data };
}
