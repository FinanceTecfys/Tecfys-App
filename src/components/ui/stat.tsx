import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={cn("num mt-2 text-2xl font-semibold tracking-tight", accent ? "text-mint-400" : "text-slate-100")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
