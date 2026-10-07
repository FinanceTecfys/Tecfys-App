import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole } from "@/lib/auth/permissions";
import type { UserProfile } from "@/lib/auth/guard";
import type { Database } from "./database.types";

/**
 * A user's app profile (role, partner distributor, active, preferences), read with a
 * service-role client: profiles has RLS on and no policies. Shared by the
 * proxy and the server guards, so it takes the client instead of importing
 * the server-only db().
 */
export async function readProfile(client: SupabaseClient<Database>, userId: string): Promise<UserProfile | null> {
  const { data, error } = await client.from("profiles").select("role, partner_distributor_id, active, language, theme").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Could not read the user's role: ${error.message}`);
  if (!data || !isRole(data.role)) return null;
  return { role: data.role, partnerDistributorId: data.partner_distributor_id, active: data.active, language: data.language, theme: data.theme };
}
