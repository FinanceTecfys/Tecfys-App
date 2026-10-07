"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import { setPassword } from "../actions";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type PasswordLink, type SetPasswordState } from "../domain/set-password";

export function SetPasswordForm({ link }: { link: PasswordLink }) {
  const t = useTranslations("auth.setPassword");
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, { error: null, verified: false });
  const invalid = state.error !== null;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token_hash" value={link.tokenHash} />
      <input type="hidden" name="type" value={link.type} />
      {state.verified && <input type="hidden" name="verified" value="1" />}
      <div>
        <Label htmlFor="password">{t("newPassword")}</Label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          aria-invalid={invalid || undefined}
          aria-describedby="password-hint set-password-error"
          className={inputClass}
        />
        <p id="password-hint" className="mt-1 text-[11px] text-slate-500">{t("hint", { min: MIN_PASSWORD_LENGTH })}</p>
      </div>
      <div>
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "set-password-error" : undefined}
          className={inputClass}
        />
      </div>
      {/* The server action answers with the message already in the active language. */}
      <p id="set-password-error" role="alert" aria-live="assertive" className="min-h-4 text-sm text-red-300">
        {state.error}
      </p>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
