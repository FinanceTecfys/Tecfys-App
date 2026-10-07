"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen, ClipboardCheck, FilePlus2, LayoutDashboard, LogOut, type LucideIcon, Receipt, Settings, TrendingUp, Waypoints } from "lucide-react";
import { TecfysLogo } from "@/components/brand/tecfys-logo";
import { can, type Capability, homePathFor, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { signOut } from "@/modules/auth/actions";

// Each entry shows only to the roles holding its capability. Hiding is a
// convenience: the proxy and requireRole() are what actually deny a route.
// Settings is open to every role: each sees there the tabs it may use (a
// partner, only its own preferences). The labels are messages (nav.<label>).
const NAV = [
  { href: "/", label: "dashboard", icon: LayoutDashboard, capability: "dashboard.view" },
  { href: "/scoring", label: "scoring", icon: ClipboardCheck, capability: "scoring.view" },
  { href: "/contracts/new", label: "newOperation", icon: FilePlus2, capability: "operation.create" },
  { href: "/pipeline", label: "pipeline", icon: Waypoints, capability: "pipeline.view" },
  { href: "/contracts", label: "loanBook", icon: BookOpen, capability: "loanBook.view" },
  { href: "/portfolio", label: "portfolio", icon: TrendingUp, capability: "waterfall.view" },
  { href: "/erp", label: "erp", icon: Receipt, capability: "erp.view" },
  { href: "/settings", label: "settings", icon: Settings, capability: "preferences.manage" },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon; capability: Capability }[];

const matches = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

export function Sidebar({ userEmail, role }: { userEmail: string | null; role: Role }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const nav = NAV.filter((item) => can(role, item.capability));
  // The most specific entry wins: /contracts/new lights "Nueva operación", not "Loan book".
  const activeHref = nav.filter((item) => matches(pathname, item.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-950">
      <div className="border-b border-ink-700 px-5 py-5">
        <Link href={homePathFor(role)} className="flex items-center gap-2">
          <TecfysLogo size={32} title={null} />
          <span>
            <span className="block text-sm font-bold tracking-wide">TECFYS</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-mint-500/70">{tCommon("brand.tagline")}</span>
          </span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4" aria-label={t("ariaLabel")}>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === activeHref;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "border-mint-500/30 bg-mint-500/10 text-mint-400"
                  : "border-transparent text-slate-400 hover:bg-ink-800 hover:text-slate-100",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-mint-500" : "text-slate-500")} aria-hidden />
              {t(label)}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 border-t border-ink-700 px-4 py-4">
        <div>
          {userEmail && <p className="truncate text-xs text-slate-400" title={userEmail}>{userEmail}</p>}
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-mint-500/80">{tCommon(`roles.${role}`)}</p>
        </div>
        <form action={signOut}>
          <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-400 transition hover:bg-ink-800 hover:text-slate-100">
            <LogOut className="h-3.5 w-3.5" aria-hidden /> {t("signOut")}
          </button>
        </form>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">{t("environment")}</p>
      </div>
    </aside>
  );
}
