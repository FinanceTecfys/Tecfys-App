import { z } from "zod";

/**
 * Only Holded hosts may be configured: the API key is sent to this URL, so an
 * arbitrary URL typed in Settings would leak it.
 */
export const isHoldedHost = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "holded.com" || u.hostname.endsWith(".holded.com")) && !u.username && !u.password;
  } catch {
    return false;
  }
};

export const erpSettingsSchema = z.object({
  holded_base_url: z
    .string()
    .trim()
    .transform((v) => v.replace(/\/+$/, ""))
    .refine(isHoldedHost, "validation.erp.holdedUrl"),
  include_credit_notes: z.boolean(),
  sync_lookback_days: z.coerce.number().int("validation.erp.wholeDays").min(0, "validation.erp.min0").max(365, "validation.erp.max365"),
});

export type ErpSettingsInput = z.input<typeof erpSettingsSchema>;
