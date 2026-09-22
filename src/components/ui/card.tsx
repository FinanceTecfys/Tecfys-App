import { cn } from "@/lib/utils";

export function Card({
  title,
  subtitle,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-ink-700 bg-ink-900", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-ink-700 px-5 py-4">
          <div>
            {title && <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-mint-500/80">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}
