import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1, "SUPABASE_SECRET_KEY is missing - copy it from `supabase status`"),
  SIGNATURIT_API_URL: z.url().optional(),
  SIGNATURIT_TOKEN: z.string().optional(),
});

let cached: z.infer<typeof schema> | null = null;

/** Server-side environment, validated on first use. */
export function serverEnv() {
  cached ??= schema.parse(process.env);
  return cached;
}
