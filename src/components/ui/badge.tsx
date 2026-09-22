import { cn } from "@/lib/utils";

const tones = {
  mint: "text-mint-400 bg-mint-500/10 border-mint-500/40",
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/40",
  yellow: "text-yellow-300 bg-yellow-500/10 border-yellow-500/40",
  orange: "text-orange-300 bg-orange-500/10 border-orange-500/40",
  red: "text-red-300 bg-red-500/10 border-red-500/40",
  slate: "text-slate-300 bg-slate-500/10 border-slate-500/30",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "slate", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
