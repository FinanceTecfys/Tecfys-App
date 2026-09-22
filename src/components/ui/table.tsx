import { cn } from "@/lib/utils";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, children, right }: { className?: string; children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-ink-700 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400",
        right ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  className,
  children,
  right,
  mono,
  title,
}: {
  className?: string;
  children?: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  /** Tooltip, e.g. the full value behind a truncated cell. */
  title?: string;
}) {
  return (
    <td title={title} className={cn("whitespace-nowrap border-b border-ink-800 px-3 py-2 text-slate-200", right && "text-right", mono && "num", className)}>
      {children}
    </td>
  );
}
