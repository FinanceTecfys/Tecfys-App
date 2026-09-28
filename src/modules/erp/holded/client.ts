/**
 * Typed client for the Holded API v2 (https://www.holded.com/developers).
 *
 *   Base URL  https://api.holded.com   (configurable in erp_settings)
 *   Auth      Authorization: Bearer <HOLDED_API_KEY>
 *   Lists     { items: [...], has_more: boolean, cursor: string | null }
 *             ?limit=<= 100 &cursor=<opaque cursor from the previous page>
 *   Limits    429 with Retry-After (seconds) and X-RateLimit-* headers;
 *             two windows (per minute and per month).
 *   Errors    application/problem+json { type, title, status, detail }
 *
 * Deliberately free of `server-only` and of env access so the CLI script and
 * the tests can build it; the app builds it through holded/server.ts. The key
 * is passed in and never logged or returned.
 */
import type { HoldedDocType } from "../domain/invoice";
import { holdedApiPageSchema } from "../domain/map-api";

export const HOLDED_DEFAULT_BASE_URL = "https://api.holded.com";
export const HOLDED_PAGE_LIMIT = 100;

const DOC_PATHS: Record<HoldedDocType, string> = {
  invoice: "/api/v2/invoices",
  creditnote: "/api/v2/credit-notes",
};

export class HoldedApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "HoldedApiError";
  }
}

export interface HoldedClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries on 429 / 5xx / network errors before giving up. */
  maxRetries?: number;
  /** Longest Retry-After we are willing to wait inside one request. */
  maxRetryWaitSeconds?: number;
}

export interface ListDocumentsOptions {
  /** Inclusive issue-date bounds, "YYYY-MM-DD". */
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
}

export interface HoldedClient {
  /** Every page of a document list, following the cursor. */
  listDocuments(docType: HoldedDocType, opts?: ListDocumentsOptions): AsyncGenerator<unknown[], void, void>;
  /**
   * Every item of a lookup list (payment methods, projects, accounting
   * accounts). `paginated: false` for lists without cursor/limit params
   * (/api/v2/accounting-accounts returns the whole chart in one response).
   */
  listAll(path: string, opts?: { paginated?: boolean }): Promise<unknown[]>;
  /** Cheapest authenticated call: one invoice. */
  ping(): Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const STATUS_MESSAGES: Record<number, string> = {
  400: "Holded rejected the request parameters",
  401: "Holded rejected the API key (invalid or missing). Check HOLDED_API_KEY",
  403: "The Holded API key lacks permission for this resource (needs sales:invoices.read)",
  404: "Holded endpoint not found. Check the base URL",
};

async function problemDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown; title?: unknown; message?: unknown; info?: unknown };
    const detail = body.detail ?? body.message ?? body.info ?? body.title;
    return typeof detail === "string" && detail.trim() ? detail.trim() : null;
  } catch {
    return null;
  }
}

function retryAfterSeconds(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return secs;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, Math.ceil(reset - Date.now() / 1000));
  return null;
}

/** "2026-08-01" -> "2026-08-01T00:00:00+00:00" (start) / "...T23:59:59+00:00" (end): the API wants RFC 3339. */
export const rfc3339Day = (day: string, edge: "start" | "end") => `${day.slice(0, 10)}T${edge === "start" ? "00:00:00" : "23:59:59"}+00:00`;

export function createHoldedClient(options: HoldedClientOptions): HoldedClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new HoldedApiError("HOLDED_API_KEY is not configured", null);
  const baseUrl = (options.baseUrl ?? HOLDED_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 4;
  const maxWait = options.maxRetryWaitSeconds ?? 90;

  async function getJson(path: string, params: Record<string, string | number | null | undefined> = {}): Promise<unknown> {
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
      } catch (e) {
        if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw new HoldedApiError(`Could not reach Holded (${e instanceof Error ? e.message : String(e)})`, null);
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new HoldedApiError(`Holded returned a non-JSON response for ${path}`, res.status);
        }
      }
      if (res.status === 429) {
        const wait = retryAfterSeconds(res) ?? 2 ** attempt * 5;
        if (attempt < maxRetries && wait <= maxWait) { await sleep(wait * 1000); continue; }
        const window = res.headers.get("x-ratelimit-window");
        throw new HoldedApiError(
          `Holded rate limit reached${window ? ` (${window} window)` : ""}. Retry in ${wait}s${window === "month" ? " or next month" : ""}`,
          429,
          wait,
        );
      }
      if (res.status >= 500 && attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
      const detail = await problemDetail(res);
      const base = STATUS_MESSAGES[res.status] ?? `Holded API error ${res.status}`;
      throw new HoldedApiError(detail ? `${base}: ${detail}` : base, res.status);
    }
  }

  async function* paginate(path: string, params: Record<string, string | number | null | undefined>): AsyncGenerator<unknown[], void, void> {
    let cursor: string | null | undefined;
    const seen = new Set<string>();
    do {
      const body = await getJson(path, { ...params, cursor });
      const page = holdedApiPageSchema.safeParse(body);
      if (!page.success) throw new HoldedApiError(`Unexpected list response from ${path} (no "items" array)`, null);
      yield page.data.items;
      cursor = page.data.has_more ? page.data.cursor : null;
      if (cursor) {
        if (seen.has(cursor)) throw new HoldedApiError(`Holded returned the same cursor twice for ${path}`, null);
        seen.add(cursor);
      }
    } while (cursor);
  }

  return {
    listDocuments(docType, opts = {}) {
      return paginate(DOC_PATHS[docType], {
        limit: Math.min(opts.limit ?? HOLDED_PAGE_LIMIT, HOLDED_PAGE_LIMIT),
        sort: "date",
        start_date: opts.startDate ? rfc3339Day(opts.startDate, "start") : null,
        end_date: opts.endDate ? rfc3339Day(opts.endDate, "end") : null,
      });
    },
    async listAll(path, { paginated = true } = {}) {
      if (!paginated) {
        const page = holdedApiPageSchema.safeParse(await getJson(path));
        if (!page.success) throw new HoldedApiError(`Unexpected list response from ${path} (no "items" array)`, null);
        return page.data.items;
      }
      const out: unknown[] = [];
      for await (const items of paginate(path, { limit: HOLDED_PAGE_LIMIT })) out.push(...items);
      return out;
    },
    async ping() {
      await getJson(DOC_PATHS.invoice, { limit: 1 });
    },
  };
}
