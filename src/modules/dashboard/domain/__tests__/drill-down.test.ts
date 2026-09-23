/**
 * Chart <-> loan book consistency: every dashboard segment drills into a
 * loan-book query whose rows add up to exactly what the segment shows. The
 * book is built with the real engine, and each query goes through the URL
 * (serialize -> parse) the way the dashboard link reaches the loan book.
 */
import { describe, expect, it } from "vitest";
import {
  filterLoanBook,
  type LoanBookQuery,
  type LoanBookRowView,
  type LoanBookSource,
  loanBookSearch,
  parseLoanBookQuery,
  toLoanBookRow,
} from "@/modules/contracts/domain/loan-book-view";
import { monthKeyOfDate } from "@/modules/contracts/domain/month-key";
import { buildPortfolio } from "@/modules/contracts/domain/portfolio";
import { buildSchedule, principalOutstandingAt } from "@/modules/contracts/domain/schedule";
import {
  type AggregateSlice,
  defaultDrillDownQuery,
  type DrillDimension,
  drillDownQuery,
  groupOutstanding,
  outstandingByLoanSize,
  topClientsByOutstanding,
} from "../analytics";

const COUNTRIES = ["ES", "PT", "IT", "FR", "DE", "NL", "BE", "IE", null];
const DISTRIBUTORS = ["Nicton", "Acquanima", "Directo", null, "nicton "];
const CLUSTERS = ["IT", "Hospitality Machinery", "Vehicles", null];
const COSTS = [600, 999.99, 1000, 2500, 4999.99, 5000, 8000, 12000, 25000, 60000, 150000];

/** A deterministic mixed book: sizes across every bucket, defaults in several months, a draft. */
function buildBook(asOf: Date): { source: LoanBookSource; signed: boolean }[] {
  const book: { source: LoanBookSource; signed: boolean }[] = [];
  for (let i = 0; i < 44; i++) {
    const cost = COSTS[i % COSTS.length];
    const duration = [24, 36, 48][i % 3];
    const signingDate = `${2023 + (i % 3)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
    // Every 5th contract is cancelled a few months in, so it is written off.
    const cancelDate = i % 5 === 0 ? `2025-${String((i % 9) + 2).padStart(2, "0")}-15` : null;
    const signed = i !== 7;
    const input = {
      signingDate,
      billingLagMonths: i % 4 === 0 ? 1 : 0,
      durationMonths: duration,
      installment: Math.round(((cost * 1.25) / duration) * 100) / 100,
      residualValue: i % 2 ? cost * 0.05 : null,
      purchaseValue: cost,
      expoAdjustment: 0,
      cancelDate: cancelDate && cancelDate > signingDate ? cancelDate : null,
      residualWaived: false,
      amortizeOverRealLife: false,
    };
    const schedule = buildSchedule(input, asOf);
    const clientNo = i % 13;
    book.push({
      signed,
      source: {
        row: {
          id: `c${i}`,
          contract_number: `LB-${String(i).padStart(4, "0")}`,
          loan_book_ref: String(i),
          contract_type: input.billingLagMonths ? "Renting F" : "Renting",
          country: COUNTRIES[i % COUNTRIES.length],
          signing_date: signingDate,
          duration_months: duration,
          installment: input.installment,
          cancel_date: input.cancelDate,
          additional_status: null,
          settlement_amount: null,
          workflow_status: signed ? "signed" : "draft",
          // Client 12 has no CIF: it is keyed by name.
          company: { name: `Cliente ${clientNo}`, cif: clientNo === 12 ? (null as unknown as string) : `B${clientNo}` },
          distributor: DISTRIBUTORS[i % DISTRIBUTORS.length] === null ? null : { name: DISTRIBUTORS[i % DISTRIBUTORS.length]! },
          asset_type: CLUSTERS[i % CLUSTERS.length] === null ? null : { name: `Tipo ${i % 6}`, cluster: CLUSTERS[i % CLUSTERS.length]! },
        },
        schedule,
        outstanding: principalOutstandingAt(schedule, monthKeyOfDate(asOf)) ?? 0,
      },
    });
  }
  return book;
}

/** The dashboard link -> URL -> loan-book query, as the browser carries it. */
const viaUrl = (query: LoanBookQuery) => parseLoanBookQuery(new URLSearchParams(loanBookSearch(query)));

const outstandingOf = (rows: LoanBookRowView[]) => rows.reduce((s, r) => s + (r.outstanding ?? 0), 0);

describe.each([
  ["today", new Date(Date.UTC(2026, 8, 22))],
  ["a past period end", new Date(Date.UTC(2025, 11, 31))],
])("chart segments reconcile with their drill-down (as of %s)", (_label, asOf) => {
  const book = buildBook(asOf);
  // The dashboard reads signed contracts only; the loan book lists drafts too.
  const chartRows = book.filter((b) => b.signed).map((b) => toLoanBookRow(b.source));
  const loanBookRows = book.map((b) => toLoanBookRow(b.source));
  const withBalance = chartRows.filter((r) => (r.outstanding ?? 0) > 0);

  function expectReconciles(dimension: DrillDimension, slices: AggregateSlice[]) {
    expect(slices.length).toBeGreaterThan(0);
    for (const slice of slices) {
      const rows = filterLoanBook(loanBookRows, viaUrl(drillDownQuery(dimension, slice)));
      expect(rows.length, `${dimension} ${slice.label} count`).toBe(slice.count);
      expect(outstandingOf(rows), `${dimension} ${slice.label} amount`).toBeCloseTo(slice.amount, 6);
    }
    // Together the segments cover every contract with a balance, once.
    expect(slices.reduce((s, x) => s + x.count, 0)).toBe(withBalance.length);
  }

  it("top clients", () => {
    const top = topClientsByOutstanding(chartRows, 100);
    expect(top.some((s) => s.key === "Cliente 12")).toBe(true);
    expectReconciles("client", top);
  });

  it("loan-size buckets", () => {
    const buckets = outstandingByLoanSize(chartRows);
    expect(buckets.filter((b) => b.count > 0).length).toBeGreaterThan(3);
    expectReconciles("size", buckets);
  });

  it.each(["assetCluster", "country", "distributor"] as const)("%s donut, including 'Otros' and 'Sin informar'", (dimension) => {
    const slices = groupOutstanding(chartRows, dimension, { limit: 3 });
    expect(slices.at(-1)?.key).toBe("__other__");
    expectReconciles(dimension, slices);
  });

  it("monthly default bars", () => {
    const months = buildPortfolio(book.filter((b) => b.signed).map((b) => b.source.schedule));
    expect(months.filter((m) => m.defaults > 0).length).toBeGreaterThan(2);
    for (const m of months) {
      const rows = filterLoanBook(loanBookRows, viaUrl(defaultDrillDownQuery(m.key)));
      const written = -rows.reduce((s, r) => s + (r.defaultAmount ?? 0), 0);
      // Write-offs under half a cent are not shown as defaults in the loan book.
      expect(written, `default ${m.key}`).toBeCloseTo(m.defaults, 2);
      expect(rows.every((r) => r.workflowStatus === "signed")).toBe(true);
    }
  });
});
