import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  accent,
  interactive,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
  /**
   * Opt-in hover lift (border + surface, eased) for the KPI cards of a listing.
   * Feedback only: no pointer cursor and no focus stop, because the card is not
   * a control. Off by default, so every other Stat renders exactly as before.
   */
  interactive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-700 bg-ink-900 px-5 py-4",
        interactive && "transition-colors duration-200 ease-out hover:border-ink-500 hover:bg-ink-800 motion-reduce:transition-none",
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={cn("num mt-2 text-2xl font-semibold tracking-tight", accent ? "text-mint-400" : "text-slate-100")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
