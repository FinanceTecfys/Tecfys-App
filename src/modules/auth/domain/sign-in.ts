/**
 * Login input and the errors shown back. Pure, so the "never reveal whether
 * the email exists" rule is unit-tested: every credential-related failure maps
 * to the same error.
 *
 * An error is a message key (auth.login.errors.<key>): the server action
 * translates it into the active language before it reaches the form.
 */
import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
  next: z.string().optional(),
});

export const SIGN_IN_ERRORS = ["invalid", "rateLimited", "unavailable"] as const;
export type SignInError = (typeof SIGN_IN_ERRORS)[number];

/**
 * Map a Supabase Auth error to what the user is told. Unknown users, wrong
 * passwords, unconfirmed or banned accounts all read the same, so the screen
 * never tells whether an account exists.
 */
export function signInErrorKey(error: { status?: number; code?: string } | null | undefined): SignInError {
  if (!error) return "invalid";
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rateLimited";
  if (error.status !== undefined && error.status >= 500) return "unavailable";
  return "invalid";
}

export interface SignInState {
  /** Already translated by the server action. */
  error: string | null;
  /** Echoed back so the email field keeps its value after a failure (never the password). */
  email: string;
}
