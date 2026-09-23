import { describe, expect, it } from "vitest";
import {
  asOfForMonth,
  clientKeyOf,
  filterLoanBook,
  groupKeyOf,
  hasLoanBookFilters,
  LOAN_SIZE_BUCKETS,
  type LoanBookQuery,
  type LoanBookRowView,
  loanBookFilterOptions,
  loanBookSearch,
  loanSizeBucketOf,
  NONE_KEY,
  parseLoanBookQuery,
  sortLoanBook,
  toSearchParams,
} from "../loan-book-view";

const row = (over: Partial<LoanBookRowView> = {}): LoanBookRowView => ({
  id: "id", contractNumber: "LB-1", loanBookRef: "1", client: "Alfa SL", cif: "B1", country: "ES",
  distributor: "Nicton", assetType: "Laptops", assetCluster: "IT", contractType: "Renting",
  signingDate: "2025-01-10", durationMonths: 36, extensionMonths: null, installment: 100, cost: 3000,
  expectedAnnualIrr: 0.2, workflowStatus: "signed", lifecycleStatus: "Active", cancelDate: null,
  additionalStatus: null, settlementAmount: null, outstanding: 1000, defaultAmount: null, ...over,
});

const ids = (rows: LoanBookRowView[]) => rows.map((r) => r.id);

describe("loanSizeBucketOf", () => {
  it("puts each positive balance in exactly one bucket: lower bound in, upper bound out", () => {
    const cases: [number, string][] = [
      [0.01, "lt1k"], [999.99, "lt1k"],
      [1000, "1k5k"], [4999.99, "1k5k"],
      [5000, "5k10k"], [9999.99, "5k10k"],
      [10000, "10k20k"], [20000, "20k50k"], [49999.99, "20k50k"],
      [50000, "gt50k"], [1e9, "gt50k"],
    ];
    for (const [amount, key] of cases) expect(loanSizeBucketOf(amount)?.key, String(amount)).toBe(key);
  });

  it("has no bucket for nothing outstanding", () => {
    for (const amount of [0, -0.01, -5000, null, Number.NaN]) expect(loanSizeBucketOf(amount)).toBeNull();
  });

  it("buckets are contiguous", () => {
    for (let i = 1; i < LOAN_SIZE_BUCKETS.length; i++) expect(LOAN_SIZE_BUCKETS[i].min).toBe(LOAN_SIZE_BUCKETS[i - 1].max);
  });
});

describe("filterLoanBook predicates", () => {
  const rows = [
    row({ id: "a", client: "Alfa SL", cif: "B1", country: "ES", distributor: "Nicton", assetCluster: "IT", outstanding: 999.99 }),
    row({ id: "b", client: "Alfa SL", cif: "B1", country: "es ", distributor: "nicton", assetCluster: "it", outstanding: 1000 }),
    row({ id: "c", client: "Beta SA", cif: "B2", country: "PT", distributor: null, assetCluster: "Hospitality", outstanding: 5000 }),
    row({ id: "d", client: "Sin CIF", cif: null, country: null, distributor: "Acquanima", assetCluster: null, outstanding: 0,
      lifecycleStatus: "Finished", cancelDate: "2025-06-20", defaultAmount: -812.5 }),
    row({ id: "e", client: "Beta SA", cif: "B2", country: "PT", outstanding: -3,
      cancelDate: "2025-06-02", defaultAmount: null }),
    row({ id: "f", client: "Gamma", cif: "B3", outstanding: 0, cancelDate: "2025-07-01", defaultAmount: -10 }),
    row({ id: "draft", client: "Alfa SL", cif: "B1", workflowStatus: "draft", lifecycleStatus: null, outstanding: null }),
  ];

  it("client: by CIF, and by name when there is no CIF", () => {
    expect(ids(filterLoanBook(rows, { client: "B1" }))).toEqual(["a", "b", "draft"]);
    expect(ids(filterLoanBook(rows, { client: "Sin CIF" }))).toEqual(["d"]);
    expect(clientKeyOf({ cif: null, client: "Sin CIF" })).toBe("Sin CIF");
  });

  it("country / distributor / cluster: case- and space-insensitive keys, any of several values, and the empty group", () => {
    expect(ids(filterLoanBook(rows, { country: ["es"] }))).toEqual(["a", "b", "f", "draft"]);
    expect(ids(filterLoanBook(rows, { country: ["pt", NONE_KEY] }))).toEqual(["c", "d", "e"]);
    expect(ids(filterLoanBook(rows, { distributor: ["nicton"] }))).toEqual(["a", "b", "e", "f", "draft"]);
    expect(ids(filterLoanBook(rows, { distributor: [NONE_KEY] }))).toEqual(["c"]);
    expect(ids(filterLoanBook(rows, { cluster: ["it"] }))).toEqual(["a", "b", "e", "f", "draft"]);
    expect(ids(filterLoanBook(rows, { cluster: [NONE_KEY] }))).toEqual(["d"]);
    expect(groupKeyOf("  ES ")).toBe("es");
    expect(groupKeyOf("   ")).toBe(NONE_KEY);
    expect(groupKeyOf(null)).toBe(NONE_KEY);
  });

  it("size: by the outstanding balance, at the bucket edges", () => {
    expect(ids(filterLoanBook(rows, { size: "lt1k" }))).toEqual(["a"]);
    expect(ids(filterLoanBook(rows, { size: "1k5k" }))).toEqual(["b"]);
    expect(ids(filterLoanBook(rows, { size: "5k10k" }))).toEqual(["c"]);
    expect(ids(filterLoanBook(rows, { size: "gt50k" }))).toEqual([]);
  });

  it("defaulted: written off (BD < 0) with the cancellation in that month", () => {
    expect(ids(filterLoanBook(rows, { defaulted: "2025-06" }))).toEqual(["d"]); // e cancelled in June but recovered its cost
    expect(ids(filterLoanBook(rows, { defaulted: "2025-07" }))).toEqual(["f"]);
    expect(ids(filterLoanBook(rows, { defaulted: "2025-05" }))).toEqual([]);
  });

  it("pending: only principal outstanding above zero (no drafts, no finished, no negative)", () => {
    expect(ids(filterLoanBook(rows, { pending: true }))).toEqual(["a", "b", "c"]);
  });

  it("combines with each other and with the search, status and sort", () => {
    expect(ids(filterLoanBook(rows, { client: "B1", pending: true, country: ["es"] }))).toEqual(["a", "b"]);
    expect(ids(filterLoanBook(rows, { client: "B1", status: "draft" }))).toEqual(["draft"]);
    expect(ids(filterLoanBook(rows, { q: "beta", country: ["pt"], pending: true }))).toEqual(["c"]);
    const sorted = sortLoanBook(filterLoanBook(rows, { distributor: ["nicton"], pending: true }), "outstanding_desc");
    expect(ids(sorted)).toEqual(["b", "a"]);
  });

  it("no filters keeps every row", () => {
    expect(filterLoanBook(rows, {})).toHaveLength(rows.length);
    expect(filterLoanBook(rows, { country: [], distributor: [], cluster: [] })).toHaveLength(rows.length);
  });
});

describe("filter options", () => {
  it("lists each key once, labelled with the first spelling seen, sorted", () => {
    const options = loanBookFilterOptions([
      row({ country: "ES", distributor: "Nicton", client: "Beta SA", cif: "B2" }),
      row({ country: "es", distributor: null, client: "Alfa SL", cif: "B1" }),
      row({ country: null, distributor: "nicton", client: "Sin CIF", cif: null }),
    ]);
    expect(options.country).toEqual([{ value: "es", label: "ES" }, { value: NONE_KEY, label: "Sin informar" }]);
    expect(options.distributor).toEqual([{ value: "nicton", label: "Nicton" }, { value: NONE_KEY, label: "Sin informar" }]);
    expect(options.client).toEqual([
      { value: "B1", label: "Alfa SL (B1)" },
      { value: "B2", label: "Beta SA (B2)" },
      { value: "Sin CIF", label: "Sin CIF" },
    ]);
  });
});

describe("query string", () => {
  const full: LoanBookQuery = {
    q: "alfa", status: "Active", client: "B1", country: ["es", "pt"], distributor: [NONE_KEY], cluster: ["it"],
    size: "1k5k", defaulted: "2025-06", pending: true, sort: "outstanding_desc", asof: "2025-06",
  };

  it("round-trips every filter, keeping repeated values", () => {
    const back = parseLoanBookQuery(new URLSearchParams(loanBookSearch(full)));
    expect(back).toEqual(full);
    expect(loanBookSearch(full, { page: "2" })).toContain("page=2");
  });

  it("omits what is not set and parses an empty query to no filters", () => {
    expect(loanBookSearch({ sort: "signing_desc" })).toBe("sort=signing_desc");
    const empty = parseLoanBookQuery(new URLSearchParams(""));
    expect(hasLoanBookFilters(empty)).toBe(false);
    // What the GET form submits when every control is left blank.
    const blank = parseLoanBookQuery(new URLSearchParams("q=&status=&client=&country=&size=&defaulted=&sort=client"));
    expect(hasLoanBookFilters(blank)).toBe(false);
    expect(blank.sort).toBe("client");
  });

  it("drops malformed values instead of guessing", () => {
    const bad = parseLoanBookQuery(new URLSearchParams("size=2k&defaulted=2025-13&asof=25-06&sort=nope&pending=yes&country=es&country=es"));
    expect(bad).toMatchObject({ size: undefined, defaulted: undefined, asof: undefined, sort: undefined, pending: false, country: ["es"] });
  });

  it("reads Next's searchParams record, including repeated params", () => {
    const sp = toSearchParams({ country: ["es", "pt"], client: "B1", page: undefined });
    expect(parseLoanBookQuery(sp)).toMatchObject({ country: ["es", "pt"], client: "B1" });
  });
});

describe("asOfForMonth", () => {
  const now = new Date(Date.UTC(2026, 8, 22));
  it("is the month's last day for a past month, and today otherwise", () => {
    expect(asOfForMonth("2025-06", now).toISOString().slice(0, 10)).toBe("2025-06-30");
    expect(asOfForMonth("2024-02", now).toISOString().slice(0, 10)).toBe("2024-02-29");
    expect(asOfForMonth("2026-09", now)).toBe(now);
    expect(asOfForMonth("2027-01", now)).toBe(now);
    expect(asOfForMonth(undefined, now)).toBe(now);
    expect(asOfForMonth("junk", now)).toBe(now);
  });
});
