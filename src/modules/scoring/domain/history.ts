/**
 * A company's scorings over time, pure so the ordering rule is unit-tested.
 * Scorings are immutable snapshots; the company's CURRENT rating is the one of
 * its most recent scoring: by the report's own date, then by when the scoring
 * was made (a scoring typed by hand has no report date and counts by the day it
 * was made).
 */

export interface ScoringHistoryEntry {
  id: string;
  rating: string;
  status: string;
  totalScore: number;
  reportSource: "pdf" | "api" | null;
  /** The report's own date (yyyy-mm-dd), when it has one. */
  reportDate: string | null;
  /** When the scoring was made (ISO timestamp). */
  createdAt: string;
}

/** The day a scoring speaks for: its report's date, else the day it was made. */
export const effectiveDate = (s: Pick<ScoringHistoryEntry, "reportDate" | "createdAt">): string => s.reportDate ?? s.createdAt.slice(0, 10);

/** Most recent first: by effective date, then by creation time. */
export function orderScoringHistory<T extends ScoringHistoryEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** The scoring that carries the company's current rating; null when it has none. */
export function currentScoring<T extends ScoringHistoryEntry>(entries: readonly T[]): T | null {
  return orderScoringHistory(entries)[0] ?? null;
}
