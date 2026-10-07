import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TecfysLogo } from "@/components/brand/tecfys-logo";
import { Alert } from "@/components/ui/alert";
import { NO_ACCESS_ERROR, safeNextPath } from "@/lib/auth/routes";
import { LoginForm } from "@/modules/auth/components/login-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.login"))("title") };
}

/**
 * Public page (with /auth/set-password). Accounts are invited from Settings: there is no sign-up.
 * No user yet, so the language is the one last chosen on this browser, else Spanish.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const target = typeof next === "string" ? safeNextPath(next) : "/";
  const t = await getTranslations("auth.login");
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
          <h2 className="mb-5 text-sm font-semibold text-slate-200">{t("title")}</h2>
          {error === NO_ACCESS_ERROR && (
            <div className="mb-5">
              <Alert tone="warning" title={t("noAccessTitle")}>
                {t("noAccessBody")}
              </Alert>
            </div>
          )}
          <LoginForm next={target === "/" ? undefined : target} />
        </div>
      </div>
    </main>
  );
}
