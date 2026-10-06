import { cn } from "@/lib/utils";

/**
 * Compact filter bar for listings (loan book, pipeline): a GET form whose
 * controls sit in a responsive grid - one column on a phone, up to six on a
 * wide screen - instead of one control per row, with a slim line underneath
 * for the result summary and the actions.
 *
 * Layout only: each control keeps its own name, default value and aria-label,
 * so the query string the form submits is whatever the page defines. The grid
 * cell sizes the control (inputClass is w-full); do not add width classes.
 */
export function FilterBar({
  children,
  summary,
  actions,
  className,
}: {
  children: React.ReactNode;
  /** Left of the bottom line: active-filter chips, result count. */
  summary?: React.ReactNode;
  /** Right of the bottom line: submit, clear. */
  actions: React.ReactNode;
  className?: string;
}) {
  return (
    <form role="search" className={cn("border-b border-ink-700 p-4", className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{children}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">{summary}</div>
        <div className="ml-auto flex items-center gap-3">{actions}</div>
      </div>
    </form>
  );
}

/** One control of the bar. `wide` takes two columns where the grid has them (search boxes, long selects). */
export function FilterCell({ wide, className, children }: { wide?: boolean; className?: string; children: React.ReactNode }) {
  return <div className={cn("min-w-0", wide && "sm:col-span-2", className)}>{children}</div>;
}

/** A labelled control boxed like an input: a checkbox, or an input with a visible prefix. */
export const filterBoxClass =
  "flex h-full min-h-[38px] items-center gap-2 rounded-md border border-ink-700 bg-ink-800 px-3 text-sm text-slate-300 transition focus-within:border-mint-500";

/** An active filter shown as a removable chip, sized like the control it replaces. */
export const filterChipClass =
  "flex h-full min-h-[38px] items-center justify-between gap-2 rounded-md border border-mint-500/50 px-3 text-sm text-mint-400";

export const filterSubmitClass =
  "rounded-md border border-ink-600 px-4 py-2 text-sm text-slate-200 transition hover:border-mint-500/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500";
