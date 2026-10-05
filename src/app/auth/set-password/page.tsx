import type { Metadata } from "next";
import Link from "next/link";
import { TecfysLogo } from "@/components/brand/tecfys-logo";
import { Alert } from "@/components/ui/alert";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { SetPasswordForm } from "@/modules/auth/components/set-password-form";
import { parsePasswordLink, SET_PASSWORD_MESSAGES } from "@/modules/auth/domain/set-password";

export const metadata: Metadata = { title: "Crear contraseña", robots: { index: false, follow: false } };

/**
 * Public page (allow-listed in the proxy like /login): where the invitation
 * email lands. It only shows the form; the emailed token is verified when the
 * form is submitted (modules/auth/actions.ts setPassword), so opening the link
 * - or a mail scanner pre-opening it - does not spend it.
 */
export default async function SetPasswordPage({ searchParams }: PageProps<"/auth/set-password">) {
  const link = parsePasswordLink(await searchParams);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <TecfysLogo size={88} title={null} />
          <h1 className="mt-5 text-xl font-bold tracking-wide text-slate-100">TECFYS</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-mint-500/70">Renting platform</p>
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{link?.type === "recovery" ? "Nueva contraseña" : "Crea tu contraseña"}</h2>
          {link ? (
            <>
              <p className="mb-5 text-xs text-slate-400">Elige la contraseña con la que entrarás en la plataforma a partir de ahora.</p>
              <SetPasswordForm link={link} />
            </>
          ) : (
            <div className="space-y-4">
              <Alert tone="warning" title="Enlace no válido">{SET_PASSWORD_MESSAGES.invalidLink}</Alert>
              <p className="text-xs text-slate-400">
                <Link href={LOGIN_PATH} className="text-mint-400 hover:underline">Ir a iniciar sesión</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
