import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TecfysLogo } from "@/components/brand/tecfys-logo";
import { Alert } from "@/components/ui/alert";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { SetPasswordForm } from "@/modules/auth/components/set-password-form";
import { parsePasswordLink } from "@/modules/auth/domain/set-password";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.setPassword"))("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Public page (allow-listed in the proxy like /login): where the invitation
 * email lands. It only shows the form; the emailed token is verified when the
 * form is submitted (modules/auth/actions.ts setPassword), so opening the link
 * - or a mail scanner pre-opening it - does not spend it.
 */
export default async function SetPasswordPage({ searchParams }: PageProps<"/auth/set-password">) {
  const link = parsePasswordLink(await searchParams);
  const t = await getTranslations("auth.setPassword");
  const tBrand = await getTranslations("common.brand");

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <TecfysLogo size={88} title={null} />
          <h1 className="mt-5 text-xl font-bold tracking-wide text-slate-100">TECFYS</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-mint-500/70">{tBrand("tagline")}</p>
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">{link?.type === "recovery" ? t("titleRecovery") : t("titleInvite")}</h2>
          {link ? (
            <>
              <p className="mb-5 text-xs text-slate-400">{t("intro")}</p>
              <SetPasswordForm link={link} />
            </>
          ) : (
            <div className="space-y-4">
              <Alert tone="warning" title={t("invalidLinkTitle")}>{t("errors.invalidLink")}</Alert>
              <p className="text-xs text-slate-400">
                <Link href={LOGIN_PATH} className="text-mint-400 hover:underline">{t("goToLogin")}</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
