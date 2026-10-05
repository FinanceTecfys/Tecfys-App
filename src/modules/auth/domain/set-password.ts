/**
 * "Set your password" from an emailed link (invitation or recovery). Pure, so
 * the link parsing, the input rules and the messages are unit-tested.
 *
 * The email links to SET_PASSWORD_PATH?token_hash=...&type=invite (see
 * supabase/templates). Opening the link only shows the form: the token is
 * verified when the form is submitted, together with the new password, so a
 * mail scanner that pre-opens links cannot spend the single-use token.
 */
import { z } from "zod";
import { SET_PASSWORD_PATH } from "@/lib/auth/routes";

export const MIN_PASSWORD_LENGTH = 10;
// bcrypt, used by Supabase Auth, ignores everything past 72 bytes.
export const MAX_PASSWORD_LENGTH = 72;

/** The emailed links this page accepts. */
export const LINK_TYPES = ["invite", "recovery"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface PasswordLink {
  tokenHash: string;
  type: LinkType;
}

const tokenHash = z.string().regex(/^[A-Za-z0-9_-]{16,256}$/);

const first = (v: string | string[] | undefined | null) => (typeof v === "string" ? v : undefined);

/** The token carried by the page URL; null when it is missing or malformed. */
export function parsePasswordLink(params: { token_hash?: string | string[] | null; type?: string | string[] | null }): PasswordLink | null {
  const parsed = z.object({ tokenHash, type: z.enum(LINK_TYPES) }).safeParse({ tokenHash: first(params.token_hash), type: first(params.type) });
  return parsed.success ? parsed.data : null;
}

/** The link an email must carry (mirrors the templates in supabase/templates). */
export const passwordLinkPath = ({ tokenHash: hash, type }: PasswordLink): string =>
  `${SET_PASSWORD_PATH}?${new URLSearchParams({ token_hash: hash, type })}`;

export const SET_PASSWORD_MESSAGES = {
  tooShort: `La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  tooLong: `La contraseña no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`,
  mismatch: "Las dos contraseñas no coinciden.",
  invalidLink: "El enlace no es válido, ya se ha usado o ha caducado. Pide a un administrador de Tecfys que te envíe una invitación nueva.",
  weak: "Supabase ha rechazado la contraseña por débil. Prueba con una más larga o más variada.",
  rateLimited: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  unavailable: "No se pudo guardar la contraseña. Inténtalo de nuevo.",
} as const;

export const setPasswordSchema = z
  .object({
    token_hash: tokenHash.optional(),
    type: z.enum(LINK_TYPES).optional(),
    /** Set by the form after the token was verified but the password was rejected: retry on the open session. */
    verified: z.literal("1").optional(),
    password: z.string().min(MIN_PASSWORD_LENGTH, SET_PASSWORD_MESSAGES.tooShort).max(MAX_PASSWORD_LENGTH, SET_PASSWORD_MESSAGES.tooLong),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.password !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: SET_PASSWORD_MESSAGES.mismatch });
    if (!v.verified && (!v.token_hash || !v.type)) ctx.addIssue({ code: "custom", path: ["token_hash"], message: SET_PASSWORD_MESSAGES.invalidLink });
  });

/**
 * What the submit does first: "verify" spends the emailed token (which opens
 * the session), "session" reuses the session a previous attempt opened.
 */
export function setPasswordStep(input: { token_hash?: string; type?: LinkType; verified?: "1" }): { step: "verify"; link: PasswordLink } | { step: "session" } {
  if (!input.verified && input.token_hash && input.type) return { step: "verify", link: { tokenHash: input.token_hash, type: input.type } };
  return { step: "session" };
}

/** Message for a failed token verification: never says why, the link is simply not usable. */
export function verifyErrorMessage(error: { status?: number; code?: string }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit") return SET_PASSWORD_MESSAGES.rateLimited;
  if (error.status !== undefined && error.status >= 500) return SET_PASSWORD_MESSAGES.unavailable;
  return SET_PASSWORD_MESSAGES.invalidLink;
}

/** Message for a rejected password update. */
export function updateErrorMessage(error: { status?: number; code?: string }): string {
  if (error.code === "weak_password") return SET_PASSWORD_MESSAGES.weak;
  if (error.status === 429 || error.code === "over_request_rate_limit") return SET_PASSWORD_MESSAGES.rateLimited;
  return SET_PASSWORD_MESSAGES.unavailable;
}

export interface SetPasswordState {
  error: string | null;
  /** The token is spent and the session is open: the next submit must not verify again. */
  verified: boolean;
}
