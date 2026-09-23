"use server";

import { redirect } from "next/navigation";
import { LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { authClient } from "@/lib/supabase/auth";
import { signInErrorMessage, signInSchema, type SignInState } from "./domain/sign-in";

/** Email + password login. The session lands in cookies; then into the app. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const raw = Object.fromEntries(formData);
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) return { error: signInErrorMessage(null), email };

  const { error } = await (await authClient()).auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: signInErrorMessage(error), email };

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  await (await authClient()).auth.signOut();
  redirect(LOGIN_PATH);
}
