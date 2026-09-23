"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, Label } from "@/components/ui/field";
import { signIn } from "../actions";
import type { SignInState } from "../domain/sign-in";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null, email: "" });
  const invalid = state.error !== null;

  return (
    <form action={action} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          defaultValue={state.email}
          key={state.email}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "login-error" : undefined}
          className={inputClass}
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "login-error" : undefined}
          className={inputClass}
        />
      </div>
      <p id="login-error" role="alert" aria-live="assertive" className="min-h-4 text-sm text-red-300">
        {state.error}
      </p>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
