"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ClipboardCheck, LayoutDashboard, Settings, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/scoring", label: "Scoring", icon: ClipboardCheck },
  { href: "/contracts", label: "Loan book", icon: BookOpen },
  { href: "/portfolio", label: "Cartera / Waterfall", icon: TrendingUp },
  { href: "/settings", label: "Configuración", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-950">
      <div className="border-b border-ink-700 px-5 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-mint-500 text-sm font-black text-ink-950">T</span>
          <span>
            <span className="block text-sm font-bold tracking-wide">TECFYS</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-mint-500/70">Renting platform</span>
          </span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-4" aria-label="Principal">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
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
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-ink-700 px-4 py-4 text-[10px] uppercase tracking-wider text-slate-500">
        v0.1 · entorno local
      </div>
    </aside>
  );
}
