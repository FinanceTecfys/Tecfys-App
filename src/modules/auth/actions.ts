"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { HOME_PATH, LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { authClient } from "@/lib/supabase/auth";
import { SET_PASSWORD_MESSAGES, type SetPasswordState, setPasswordSchema, setPasswordStep, updateErrorMessage, verifyErrorMessage } from "./domain/set-password";
import { signInErrorKey, signInSchema, type SignInState } from "./domain/sign-in";

/** Email + password login. The session lands in cookies; then into the app. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const raw = Object.fromEntries(formData);
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  // No user yet: the language is the one last chosen on this browser, else Spanish.
  const t = await getTranslations("auth.login.errors");
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { error: t(signInErrorKey(null)), email };

  const { error } = await (await authClient()).auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: t(signInErrorKey(error)), email };

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  await (await authClient()).auth.signOut();
  redirect(LOGIN_PATH);
}

/**
 * Accept an invitation (or a recovery link): verify the emailed token, which
 * opens the session of the invited user in the cookies, and set the password
 * they typed. Runs without a role by design - it is how a user gets in the
 * first time. The password is validated BEFORE the single-use token is spent.
 * Afterwards the proxy sends the user to the home page of the role assigned
 * when they were invited.
 */
export async function setPassword(prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const parsed = setPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message, verified: prev.verified };
  const auth = (await authClient()).auth;

  const next = setPasswordStep(parsed.data);
  if (next.step === "verify") {
    // Whoever was signed in on this browser is replaced by the owner of the link.
    const { error } = await auth.verifyOtp({ token_hash: next.link.tokenHash, type: next.link.type });
    if (error) return { error: verifyErrorMessage(error), verified: false };
  } else {
    const { data } = await auth.getClaims();
    if (!data?.claims?.sub) return { error: SET_PASSWORD_MESSAGES.invalidLink, verified: false };
  }

  const { error } = await auth.updateUser({ password: parsed.data.password });
  // The token is spent but the session is open: the form retries on it.
  if (error) return { error: updateErrorMessage(error), verified: true };

  redirect(HOME_PATH);
}
