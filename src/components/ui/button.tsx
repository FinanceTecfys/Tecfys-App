import Link from "next/link";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-mint-500 text-ink-950 hover:bg-mint-400 font-semibold",
  secondary: "border border-ink-600 text-slate-200 hover:border-mint-500/60 hover:text-white",
  ghost: "text-slate-400 hover:bg-ink-800 hover:text-slate-100",
  danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
} as const;

type Variant = keyof typeof variants;
const base =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={cn(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], className)} {...props} />;
}
