import { cn } from "@/lib/utils";

const tones = {
  info: "border-mint-500/30 bg-mint-500/5 text-mint-300",
  warning: "border-yellow-500/40 bg-yellow-500/5 text-yellow-200",
  error: "border-red-500/40 bg-red-500/5 text-red-200",
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "opacity-90")}>{children}</div>}
    </div>
  );
}
