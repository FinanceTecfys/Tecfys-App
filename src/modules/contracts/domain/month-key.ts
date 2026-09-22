/**
 * Month keys, the workbook's calendar unit: year * 12 + month (month 1-12).
 * Every grid column in the Borrowing Base is addressed as `Y*12+M`, so the
 * same integer arithmetic is used here.
 */
export type MonthKey = number;

export const monthKey = (year: number, month: number): MonthKey => year * 12 + month;

export function monthKeyOfDate(date: Date | string): MonthKey {
  const d = typeof date === "string" ? parseIsoDate(date) : date;
  return monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

export function yearMonthOf(key: MonthKey): { year: number; month: number } {
  const month = ((key - 1) % 12) + 1;
  return { year: (key - month) / 12, month };
}

export function monthKeyLabel(key: MonthKey): string {
  const { year, month } = yearMonthOf(key);
  return `${String(month).padStart(2, "0")}/${year}`;
}

/** Parse "YYYY-MM-DD" as a UTC date so month arithmetic never shifts by timezone. */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d || 1));
}

/** Excel DATEDIF(start, end, "m"): complete months between two dates (0 if end < start). */
export function completeMonthsBetween(start: Date | string, end: Date | string): number {
  const a = typeof start === "string" ? parseIsoDate(start) : start;
  const b = typeof end === "string" ? parseIsoDate(end) : end;
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
    - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  return Math.max(0, months);
}
