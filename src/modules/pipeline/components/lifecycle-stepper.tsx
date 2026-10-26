import { useTranslations } from "next-intl";
import { Ban, Check, Minus } from "lucide-react";
import { useTranslate } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { type Lifecycle, type LifecycleStep, STEP_STATE_LABELS, type StepState } from "../domain/lifecycle";

/**
 * A deal's lifecycle as a horizontal stepper. Presentation only: it renders
 * the steps lifecycleOf() computed, so it cannot disagree with the data.
 *
 *  - "full" (contract detail): labelled steps with a tooltip on hover / focus.
 *  - "compact" (pipeline rows): dots only; the native title is the tooltip,
 *    because a table cell clips anything positioned outside it.
 *
 * Each step is focusable (Tab) and announced with its state; the state is
 * never carried by colour alone (icon + text). Colours are the theme tokens
 * (ink / mint), so the bar follows the app theme.
 */

const MARKER: Record<StepState, string> = {
  done: "border-mint-500 bg-mint-500 text-ink-950",
  current: "border-mint-500 bg-mint-500/15 text-mint-400 ring-2 ring-mint-500/30",
  pending: "border-ink-500 bg-ink-900 text-slate-500",
  unavailable: "border-dashed border-ink-500 bg-transparent text-slate-600",
  stopped: "border-red-500/70 bg-red-500/15 text-red-300",
};

const LABEL: Record<StepState, string> = {
  done: "text-slate-200",
  current: "font-semibold text-mint-400",
  pending: "text-slate-500",
  unavailable: "text-slate-600",
  stopped: "font-semibold text-red-300",
};

/** The connector leading INTO a step is filled once that step has been reached. */
const reached = (state: StepState) => state === "done" || state === "current" || state === "stopped";

function Marker({ step, index, size }: { step: LifecycleStep; index: number; size: "sm" | "md" }) {
  const icon = size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border transition duration-150 group-hover:scale-110 group-hover:border-mint-400 group-focus-visible:scale-110",
        size === "sm" ? "h-4 w-4 text-[9px]" : "h-7 w-7 text-xs",
        MARKER[step.state],
      )}
    >
      {step.state === "done" ? <Check className={icon} strokeWidth={3} /> : step.state === "stopped" ? <Ban className={icon} /> : step.state === "unavailable" ? <Minus className={icon} /> : size === "md" ? index + 1 : null}
    </span>
  );
}


export function LifecycleStepper({ lifecycle, variant = "full", className }: { lifecycle: Lifecycle; variant?: "full" | "compact"; className?: string }) {
  const compact = variant === "compact";
  const t = useTranslations("pipeline.lifecycle");
  // The lifecycle carries message keys (labels, hints, states): they are translated here.
  const translate = useTranslate();
  const describe = (step: LifecycleStep) => t("describe", { step: translate(step.label), state: translate(STEP_STATE_LABELS[step.state]), hint: translate(step.hint) });
  return (
    <ol aria-label={t("ariaLabel", { label: translate(lifecycle.label) })} className={cn("flex", compact ? "items-center" : "items-start", className)}>
      {lifecycle.steps.map((step, i) => (
        <li key={step.key} aria-current={step.key === lifecycle.stage ? "step" : undefined} className={cn("flex", compact ? "items-center" : "min-w-0 items-start", !compact && i > 0 && "flex-1")}>
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                "shrink-0 rounded-full",
                compact ? "mx-0.5 h-0.5 w-3" : "mt-[13px] h-0.5 flex-1",
                reached(step.state) ? "bg-mint-500" : step.state === "unavailable" ? "bg-[repeating-linear-gradient(90deg,var(--color-ink-500)_0_3px,transparent_3px_6px)]" : "bg-ink-600",
              )}
            />
          )}
          <span
            tabIndex={0}
            title={compact ? describe(step) : undefined}
            className={cn(
              "group relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-mint-500",
              compact ? "flex cursor-default" : "flex w-24 shrink-0 cursor-default flex-col items-center gap-1.5 px-1 py-0.5 text-center hover:bg-ink-800",
            )}
          >
            <Marker step={step} index={i} size={compact ? "sm" : "md"} />
            {compact ? (
              <span className="sr-only">{describe(step)}</span>
            ) : (
              <>
                <span className={cn("text-[11px] leading-tight", LABEL[step.state])}>{translate(step.label)}</span>
                <span className="sr-only">{translate(STEP_STATE_LABELS[step.state])}.</span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 hidden w-48 -translate-x-1/2 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-left text-[11px] leading-snug text-slate-200 shadow-lg group-hover:block group-focus-visible:block"
                >
                  <span className="block font-semibold text-slate-100">{translate(STEP_STATE_LABELS[step.state])}</span>
                  {translate(step.hint)}
                </span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
