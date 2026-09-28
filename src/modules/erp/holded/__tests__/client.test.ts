import { describe, expect, it, vi } from "vitest";
import { createHoldedClient, HoldedApiError, rfc3339Day } from "../client";

// The Holded API is mocked: these tests never reach api.holded.com.
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

function mockFetch(replies: Reply[]) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected extra request");
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const client = (replies: Reply[], extra: Partial<Parameters<typeof createHoldedClient>[0]> = {}) => {
  const m = mockFetch(replies);
  const sleep = vi.fn(async () => undefined);
  return { ...m, sleep, api: createHoldedClient({ apiKey: " test-key ", fetch: m.fetch, sleep, ...extra }) };
};

const collect = async (gen: AsyncGenerator<unknown[]>) => {
  const pages: unknown[][] = [];
  for await (const p of gen) pages.push(p);
  return pages;
};

describe("createHoldedClient", () => {
  it("refuses to build without an API key", () => {
    expect(() => createHoldedClient({ apiKey: "  " })).toThrow("HOLDED_API_KEY is not configured");
  });

  it("sends the Bearer key and follows the cursor through every page", async () => {
    const { api, calls } = client([
      { body: { items: [{ id: "1" }, { id: "2" }], has_more: true, cursor: "c1" } },
      { body: { items: [{ id: "3" }], has_more: false, cursor: null } },
    ]);
    const pages = await collect(api.listDocuments("invoice", { startDate: "2026-08-01", endDate: "2026-08-31" }));
    expect(pages).toEqual([[{ id: "1" }, { id: "2" }], [{ id: "3" }]]);
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.holded.com/api/v2/invoices");
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      limit: "100",
      sort: "date",
      start_date: "2026-08-01T00:00:00+00:00",
      end_date: "2026-08-31T23:59:59+00:00",
    });
    expect(calls[0].url.searchParams.has("cursor")).toBe(false);
    expect(calls[1].url.searchParams.get("cursor")).toBe("c1");
  });

  it("lists credit notes from their own endpoint, unbounded when no dates are given", async () => {
    const { api, calls } = client([{ body: { items: [], has_more: false } }], { baseUrl: "https://api.holded.com/" });
    expect(await collect(api.listDocuments("creditnote"))).toEqual([[]]);
    expect(calls[0].url.pathname).toBe("/api/v2/credit-notes");
    expect(calls[0].url.searchParams.has("start_date")).toBe(false);
  });

  it("stops on a repeated cursor instead of looping forever", async () => {
    const { api } = client([
      { body: { items: [1], has_more: true, cursor: "same" } },
      { body: { items: [2], has_more: true, cursor: "same" } },
    ]);
    await expect(collect(api.listDocuments("invoice"))).rejects.toThrow("same cursor twice");
  });

  it("explains an invalid key (401) with Holded's problem detail", async () => {
    const { api } = client([{ status: 401, body: { type: "x", title: "Unauthorized", status: 401, detail: "API key inválida" } }]);
    const err = await api.ping().catch((e) => e);
    expect(err).toBeInstanceOf(HoldedApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Holded rejected the API key (invalid or missing). Check HOLDED_API_KEY: API key inválida");
  });

  it("explains missing permissions (403)", async () => {
    const { api } = client([{ status: 403, body: {} }]);
    await expect(api.ping()).rejects.toThrow("needs sales:invoices.read");
  });

  it("waits Retry-After on 429 and retries", async () => {
    const { api, sleep, calls } = client([
      { status: 429, headers: { "retry-after": "7", "x-ratelimit-window": "minute" } },
      { body: { items: [], has_more: false } },
    ]);
    await api.ping();
    expect(sleep).toHaveBeenCalledWith(7000);
    expect(calls).toHaveLength(2);
  });

  it("gives up with a clear message when the rate limit persists or the wait is too long", async () => {
    const monthly = client([{ status: 429, headers: { "retry-after": "86400", "x-ratelimit-window": "month" } }]);
    const err = await monthly.api.ping().catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(86400);
    expect(err.message).toBe("Holded rate limit reached (month window). Retry in 86400s or next month");
    expect(monthly.sleep).not.toHaveBeenCalled();

    const persistent = client(Array.from({ length: 3 }, () => ({ status: 429, headers: { "retry-after": "1" } })), { maxRetries: 2 });
    await expect(persistent.api.ping()).rejects.toThrow("Holded rate limit reached");
    expect(persistent.calls).toHaveLength(3);
  });

  it("retries server errors and network failures with backoff", async () => {
    const { api, sleep } = client([{ status: 503 }, new TypeError("fetch failed"), { body: { items: [], has_more: false } }]);
    await api.ping();
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("reports an unreachable Holded after the retries", async () => {
    const { api } = client([new TypeError("getaddrinfo ENOTFOUND"), new TypeError("getaddrinfo ENOTFOUND")], { maxRetries: 1 });
    await expect(api.ping()).rejects.toThrow("Could not reach Holded (getaddrinfo ENOTFOUND)");
  });

  it("rejects a list response without items", async () => {
    const { api } = client([{ body: { data: [] } }]);
    await expect(collect(api.listDocuments("invoice"))).rejects.toThrow('no "items" array');
  });

  it("reads unpaginated lookups in one call and paginated ones fully", async () => {
    const { api, calls } = client([
      { body: { items: [{ id: "a1" }] } },
      { body: { items: [{ id: "p1" }], has_more: true, cursor: "n" } },
      { body: { items: [{ id: "p2" }], has_more: false, cursor: null } },
    ]);
    expect(await api.listAll("/api/v2/accounting-accounts", { paginated: false })).toEqual([{ id: "a1" }]);
    expect(calls[0].url.search).toBe("");
    expect(await api.listAll("/api/v2/projects")).toEqual([{ id: "p1" }, { id: "p2" }]);
  });
});

describe("rfc3339Day", () => {
  it("expands a day to the inclusive RFC 3339 bounds the API expects", () => {
    expect(rfc3339Day("2026-01-01", "start")).toBe("2026-01-01T00:00:00+00:00");
    expect(rfc3339Day("2026-12-31T05:00:00Z", "end")).toBe("2026-12-31T23:59:59+00:00");
  });
});
