/**
 * /erp query parameters and display helpers. Pure.
 */

/** Status labels Holded's export uses (and the API mapper produces). */
export const HOLDED_STATUSES = ["Paid", "Pending", "Partially paid", "Overdue", "Cancelled"] as const;
export type HoldedStatus = (typeof HOLDED_STATUSES)[number];

export const isHoldedStatus = (v: unknown): v is HoldedStatus => typeof v === "string" && (HOLDED_STATUSES as readonly string[]).includes(v);

export interface ErpQuery {
  q: string;
  status: HoldedStatus | null;
  page: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseErpQuery(sp: Record<string, string | string[] | undefined>): ErpQuery {
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const status = first(sp.status);
  const page = Math.floor(Number(first(sp.page)));
  return { q, status: isHoldedStatus(status) ? status : null, page: Number.isFinite(page) && page >= 1 ? page : 1 };
}

export function erpSearch(query: ErpQuery, patch: Partial<ErpQuery> = {}): string {
  const next = { ...query, ...patch };
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.status) p.set("status", next.status);
  if (next.page > 1) p.set("page", String(next.page));
  return p.toString();
}

/**
 * ilike pattern for the PostgREST `or` filter, or null for an empty search.
 * The value is double-quoted so , . ( ) : in the search ("S.L.") are literal
 * and cannot inject filters; " and \ are backslash-escaped inside the quotes,
 * and the wildcards % * (PostgREST reads * as %) are dropped.
 */
export function searchPattern(q: string): string | null {
  const cleaned = q.replace(/[%*]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? `"%${cleaned.replace(/["\\]/g, (c) => `\\${c}`)}%"` : null;
}

export const STATUS_TONES: Record<string, "emerald" | "yellow" | "orange" | "red" | "slate"> = {
  Paid: "emerald",
  Pending: "yellow",
  "Partially paid": "orange",
  Overdue: "red",
  Cancelled: "slate",
};
