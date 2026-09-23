/**
 * Login input and the messages shown back. Pure, so the "never reveal whether
 * the email exists" rule is unit-tested: every credential-related failure maps
 * to the same message.
 */
import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
  next: z.string().optional(),
});

export const SIGN_IN_MESSAGES = {
  invalid: "Email o contraseña incorrectos.",
  rateLimited: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  unavailable: "No se pudo iniciar sesión. Inténtalo de nuevo más tarde.",
} as const;

/**
 * Map a Supabase Auth error to what the user sees. Unknown users, wrong
 * passwords, unconfirmed or banned accounts all read the same, so the screen
 * never tells whether an account exists.
 */
export function signInErrorMessage(error: { status?: number; code?: string } | null | undefined): string {
  if (!error) return SIGN_IN_MESSAGES.invalid;
  if (error.status === 429 || error.code === "over_request_rate_limit") return SIGN_IN_MESSAGES.rateLimited;
  if (error.status !== undefined && error.status >= 500) return SIGN_IN_MESSAGES.unavailable;
  return SIGN_IN_MESSAGES.invalid;
}

export interface SignInState {
  error: string | null;
  /** Echoed back so the email field keeps its value after a failure (never the password). */
  email: string;
}
