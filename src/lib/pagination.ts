/**
 * Listing pagination, pure so it is unit-tested: the page sizes a listing
 * offers, the parsing of ?page= / ?pageSize= and the numbered buttons
 * (1 2 3 4 5 … 91) the footer renders.
 */

export const PAGE_SIZES = [50, 100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

type Param = string | string[] | undefined | null;
const first = (value: Param) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Only the offered sizes are accepted; anything else is the default. */
export function parsePageSize(value: Param): PageSize {
  const raw = first(value).trim();
  return PAGE_SIZES.find((size) => String(size) === raw) ?? DEFAULT_PAGE_SIZE;
}

/** A positive whole page number; anything else is page 1. The upper bound is applied by paginate(). */
export function parsePage(value: Param): number {
  const raw = first(value).trim();
  if (!/^\d{1,9}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

export type PageItem =
  | { type: "page"; page: number; current: boolean }
  /** Pages left out before ("start") or after ("end") the window around the current one. */
  | { type: "ellipsis"; key: "start" | "end" };

/** Up to this many pages every number is shown; beyond it the middle collapses. */
const MAX_BUTTONS = 7;

/**
 * The page buttons: first and last always, the current page with its
 * neighbours, and an ellipsis wherever at least two pages are skipped.
 */
export function pageItems(pages: number, current: number): PageItem[] {
  const page = (p: number): PageItem => ({ type: "page", page: p, current: p === current });
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => page(from + i));
  if (pages <= MAX_BUTTONS) return range(1, pages);
  if (current <= 4) return [...range(1, 5), { type: "ellipsis", key: "end" }, page(pages)];
  if (current >= pages - 3) return [page(1), { type: "ellipsis", key: "start" }, ...range(pages - 4, pages)];
  return [page(1), { type: "ellipsis", key: "start" }, ...range(current - 1, current + 1), { type: "ellipsis", key: "end" }, page(pages)];
}

export interface Pagination {
  /** Current page, clamped to 1..pages. */
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  /** 1-based position of the first and last row of the page; both 0 when there are no rows. */
  from: number;
  to: number;
  /** Slice bounds over the full row list. */
  start: number;
  end: number;
  items: PageItem[];
}

/** Everything the footer and the row slice need, from the row count, the page size and the requested page. */
export function paginate(total: number, pageSize: number, current: number): Pagination {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : DEFAULT_PAGE_SIZE;
  const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Number.isFinite(current) ? Math.min(pages, Math.max(1, Math.floor(current))) : 1;
  const start = (page - 1) * size;
  const end = Math.min(count, start + size);
  return { page, pageSize: size, pages, total: count, from: count === 0 ? 0 : start + 1, to: end, start, end, items: pageItems(pages, page) };
}
