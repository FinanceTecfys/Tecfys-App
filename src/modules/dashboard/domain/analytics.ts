/**
 * Dashboard analytics: period resolution, point-in-time concentration figures
 * and the monthly series behind the charts.
 *
 * Pure and read-only: it aggregates what the engine already produced (the loan
 * book view rows and the portfolio months) and never recomputes contract maths.
 *
 * Conventions:
 *  - IRR evolution: expected IRR of the contracts live in the month, weighted by
 *    asset value, annualised - PortfolioMonth.weightedAnnualIrr. The workbook's
 *    "IRR" tab keeps a hard-coded series by signing cohort with no formula left,
 *    so it cannot be reproduced; this is the definition agreed for the app.
 *  - Default evolution: the workbook's own live definitions - the monthly
 *    write-off (Summary row 22) and the cumulative loss rate over principal
 *    originated (Summary row 45).
 */
import type { LoanBookRowView } from "@/modules/contracts/domain/loan-book-view";
import { type MonthKey, monthKey, monthKeyOfDate, yearMonthOf } from "@/modules/contracts/domain/month-key";
import type { PortfolioMonth } from "@/modules/contracts/domain/portfolio";

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export const PERIOD_PRESETS = {
  last12: { label: "Últimos 12 meses", months: 12 },
  last24: { label: "Últimos 2 años", months: 24 },
  custom: { label: "Rango personalizado", months: 0 },
} as const;

export type PeriodPreset = keyof typeof PERIOD_PRESETS;

export interface PeriodSelection {
  preset?: string;
  /** "YYYY-MM" month inputs, used by the custom preset. */
  from?: string;
  to?: string;
}

export interface Period {
  preset: PeriodPreset;
  fromKey: MonthKey;
  toKey: MonthKey;
  /** Month inputs echoed back to the form. */
  fromInput: string;
  toInput: string;
  label: string;
}

export const isPeriodPreset = (v: string | undefined): v is PeriodPreset => v !== undefined && v in PERIOD_PRESETS;

/** "2026-09" -> month key; null when absent or malformed. */
export function parseMonthInput(value: string | undefined | null): MonthKey | null {
  const m = value?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return monthKey(Number(m[1]), month);
}

export function monthKeyToInput(key: MonthKey): string {
  const { year, month } = yearMonthOf(key);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Resolve the selected period. Presets always end in the current month; a
 * custom range falls back to the 12-month preset when a bound is missing, and
 * swaps the bounds if they arrive inverted.
 */
export function resolvePeriod(selection: PeriodSelection, today: Date): Period {
  const currentKey = monthKeyOfDate(today);
  const preset: PeriodPreset = isPeriodPreset(selection.preset) ? selection.preset : "last12";

  let fromKey: MonthKey;
  let toKey: MonthKey;
  if (preset === "custom") {
    const parsedFrom = parseMonthInput(selection.from);
    const parsedTo = parseMonthInput(selection.to);
    fromKey = parsedFrom ?? currentKey - (PERIOD_PRESETS.last12.months - 1);
    toKey = parsedTo ?? currentKey;
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  } else {
    toKey = currentKey;
    fromKey = currentKey - (PERIOD_PRESETS[preset].months - 1);
  }

  return {
    preset,
    fromKey,
    toKey,
    fromInput: monthKeyToInput(fromKey),
    toInput: monthKeyToInput(toKey),
    label: PERIOD_PRESETS[preset].label,
  };
}

// ---------------------------------------------------------------------------
// Point-in-time aggregations (as of the period's end month)
// ---------------------------------------------------------------------------

export interface AggregateSlice {
  key: string;
  label: string;
  amount: number;
  count: number;
  /** Share of the total outstanding of the aggregation. */
  share: number;
}

const positiveOutstanding = (r: LoanBookRowView) => Math.max(0, r.outstanding ?? 0);

function withShares(slices: Omit<AggregateSlice, "share">[]): AggregateSlice[] {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  return slices.map((s) => ({ ...s, share: total > 0 ? s.amount / total : 0 }));
}

/** Concentration: outstanding by client, biggest first. */
export function topClientsByOutstanding(rows: readonly LoanBookRowView[], limit = 20): AggregateSlice[] {
  const byClient = new Map<string, { label: string; amount: number; count: number }>();
  for (const r of rows) {
    const amount = positiveOutstanding(r);
    if (amount <= 0) continue;
    // CIF identifies the client; the name is what the chart shows.
    const key = r.cif ?? r.client;
    const entry = byClient.get(key) ?? { label: r.client, amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    byClient.set(key, entry);
  }
  const all = [...byClient.entries()].map(([key, v]) => ({ key, ...v }));
  const total = all.reduce((s, x) => s + x.amount, 0);
  return all
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "es"))
    .slice(0, limit)
    .map((s) => ({ ...s, share: total > 0 ? s.amount / total : 0 }));
}

export const LOAN_SIZE_BUCKETS = [
  { key: "lt1k", label: "<1k", min: 0, max: 1000 },
  { key: "1k5k", label: "1k–5k", min: 1000, max: 5000 },
  { key: "5k10k", label: "5k–10k", min: 5000, max: 10000 },
  { key: "10k20k", label: "10k–20k", min: 10000, max: 20000 },
  { key: "20k50k", label: "20k–50k", min: 20000, max: 50000 },
  { key: "gt50k", label: ">50k", min: 50000, max: Number.POSITIVE_INFINITY },
] as const;

/** Outstanding by size of each contract's own outstanding balance. */
export function outstandingByLoanSize(rows: readonly LoanBookRowView[]): AggregateSlice[] {
  const totals = LOAN_SIZE_BUCKETS.map((b) => ({ key: b.key, label: b.label, amount: 0, count: 0 }));
  for (const r of rows) {
    const amount = positiveOutstanding(r);
    if (amount <= 0) continue;
    // Upper bound excluded, so each contract falls in exactly one bucket.
    const idx = LOAN_SIZE_BUCKETS.findIndex((b) => amount >= b.min && amount < b.max);
    if (idx === -1) continue;
    totals[idx].amount += amount;
    totals[idx].count += 1;
  }
  return withShares(totals);
}

export type GroupDimension = "assetCluster" | "assetType" | "country" | "distributor";

export interface GroupOptions {
  /** Slices kept before folding the tail into "Otros". */
  limit?: number;
  emptyLabel?: string;
  otherLabel?: string;
}

/**
 * Outstanding grouped by one dimension, biggest first, with the tail folded
 * into a single "Otros" slice (the palette is assigned in fixed order and never
 * cycled, so the number of slices has to stay bounded).
 */
export function groupOutstanding(
  rows: readonly LoanBookRowView[],
  dimension: GroupDimension,
  { limit = 6, emptyLabel = "Sin informar", otherLabel = "Otros" }: GroupOptions = {},
): AggregateSlice[] {
  const groups = new Map<string, { label: string; amount: number; count: number }>();
  for (const r of rows) {
    const amount = positiveOutstanding(r);
    if (amount <= 0) continue;
    const raw = r[dimension];
    const label = raw?.trim() || emptyLabel;
    const key = label.toLowerCase();
    const entry = groups.get(key) ?? { label, amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    groups.set(key, entry);
  }
  const sorted = [...groups.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "es"));

  if (sorted.length <= limit) return withShares(sorted);
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  head.push({
    key: "__other__",
    label: otherLabel,
    amount: tail.reduce((s, x) => s + x.amount, 0),
    count: tail.reduce((s, x) => s + x.count, 0),
  });
  return withShares(head);
}

// ---------------------------------------------------------------------------
// Monthly series
// ---------------------------------------------------------------------------

export interface IrrPoint {
  key: MonthKey;
  label: string;
  annualIrr: number | null;
  liveContracts: number;
}

export interface DefaultPoint {
  key: MonthKey;
  label: string;
  /** Written off in the month (Summary row 22). */
  defaults: number;
  cumulativeDefaults: number;
  /** Summary row 45. */
  cumulativeLossRate: number | null;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function monthLabel(key: MonthKey): string {
  const { year, month } = yearMonthOf(key);
  return `${MONTHS[month - 1]}-${String(year).slice(2)}`;
}

/** The portfolio months inside the period, in order and with no gaps. */
export function monthsInPeriod(months: readonly PortfolioMonth[], period: Period): PortfolioMonth[] {
  return months.filter((m) => m.key >= period.fromKey && m.key <= period.toKey).sort((a, b) => a.key - b.key);
}

export function irrSeries(months: readonly PortfolioMonth[], period: Period): IrrPoint[] {
  return monthsInPeriod(months, period).map((m) => ({
    key: m.key,
    label: monthLabel(m.key),
    annualIrr: m.weightedAnnualIrr,
    liveContracts: m.liveContracts,
  }));
}

export function defaultSeries(months: readonly PortfolioMonth[], period: Period): DefaultPoint[] {
  return monthsInPeriod(months, period).map((m) => ({
    key: m.key,
    label: monthLabel(m.key),
    defaults: m.defaults,
    cumulativeDefaults: m.cumulativeDefaults,
    cumulativeLossRate: m.cumulativeLossRate,
  }));
}
