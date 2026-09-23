import type { Metadata } from "next";
import { TecfysLogo } from "@/components/brand/tecfys-logo";
import { safeNextPath } from "@/lib/auth/routes";
import { LoginForm } from "@/modules/auth/components/login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

/** The only public page. Accounts are provisioned in Supabase: there is no sign-up. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const target = typeof next === "string" ? safeNextPath(next) : "/";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <TecfysLogo size={88} title={null} />
          <h1 className="mt-5 text-xl font-bold tracking-wide text-slate-100">TECFYS</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-mint-500/70">Renting platform</p>
        </div>
        <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
          <h2 className="mb-5 text-sm font-semibold text-slate-200">Iniciar sesión</h2>
          <LoginForm next={target === "/" ? undefined : target} />
        </div>
      </div>
    </main>
  );
}
