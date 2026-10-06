import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PageItem } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const cell = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm transition";
const link = "border-ink-600 text-slate-300 hover:border-mint-500/60 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500";

/**
 * Numbered pages (1 2 3 4 5 … 91) with previous / next. Plain links, so the
 * page lives in the URL and works with the keyboard and without JavaScript.
 * The buttons come from paginate() in src/lib/pagination.ts.
 */
export function Pagination({
  items,
  page,
  pages,
  hrefFor,
  className,
}: {
  items: PageItem[];
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const step = (target: number, label: string, icon: React.ReactNode) =>
    target >= 1 && target <= pages ? (
      <Link href={hrefFor(target)} aria-label={label} title={label} className={cn(cell, link)}>{icon}</Link>
    ) : (
      <span aria-hidden className={cn(cell, "border-ink-700 text-slate-600")}>{icon}</span>
    );

  return (
    <nav aria-label="Paginación" className={className}>
      <ul className="flex flex-wrap items-center gap-1">
        <li>{step(page - 1, "Página anterior", <ChevronLeft className="h-4 w-4" aria-hidden />)}</li>
        {items.map((item) =>
          item.type === "ellipsis" ? (
            <li key={item.key} aria-hidden className="num px-1 text-slate-500">…</li>
          ) : (
            <li key={item.page}>
              {item.current ? (
                <span aria-current="page" aria-label={`Página ${item.page}, actual`} className={cn(cell, "num border-mint-500 bg-mint-500/10 font-semibold text-mint-400")}>
                  {item.page}
                </span>
              ) : (
                <Link href={hrefFor(item.page)} aria-label={`Página ${item.page}`} className={cn(cell, link, "num")}>{item.page}</Link>
              )}
            </li>
          ),
        )}
        <li>{step(page + 1, "Página siguiente", <ChevronRight className="h-4 w-4" aria-hidden />)}</li>
      </ul>
    </nav>
  );
}
