import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  EXPORT_COLUMNS,
  exportTotals,
  filterLoanBook,
  isLoanBookSort,
  type LoanBookSource,
  sortLoanBook,
  toLoanBookRow,
} from "../loan-book-view";
import { buildSchedule, type ContractInput, principalOutstandingAt } from "../schedule";
import { monthKeyOfDate } from "../month-key";

const asOf = new Date(Date.UTC(2026, 8, 15));

function source(over: Partial<LoanBookSource["row"]> = {}, input: Partial<ContractInput> = {}): LoanBookSource {
  const row = {
    id: "id-1",
    contract_number: "LB-16535",
    loan_book_ref: "16535",
    contract_type: "Renting F",
    country: "ES",
    signing_date: "2023-06-15",
    duration_months: 24,
    installment: 340,
    cancel_date: null as string | null,
    additional_status: null as string | null,
    settlement_amount: null as number | string | null,
    workflow_status: "signed",
    company: { name: "BLUEGROUND ESPANA", cif: "B12345678" },
    distributor: { name: "Nicton" },
    ...over,
  };
  const schedule = buildSchedule(
    {
      signingDate: row.signing_date,
      billingLagMonths: 1,
      durationMonths: row.duration_months,
      installment: Number(row.installment),
      residualValue: 340,
      purchaseValue: 7000,
      expoAdjustment: 0,
      cancelDate: row.cancel_date,
      settlementAmount: row.settlement_amount === null ? null : Number(row.settlement_amount),
      residualWaived: false,
      amortizeOverRealLife: false,
      ...input,
    },
    asOf,
  );
  return { row, schedule, outstanding: principalOutstandingAt(schedule, monthKeyOfDate(asOf)) ?? 0 };
}

describe("toLoanBookRow", () => {
  it("maps the contract and carries the engine's figures", () => {
    const r = toLoanBookRow(source());
    expect(r).toMatchObject({
      contractNumber: "LB-16535",
      loanBookRef: "16535",
      client: "BLUEGROUND ESPANA",
      country: "ES",
      distributor: "Nicton",
      durationMonths: 24,
      installment: 340,
    });
    expect(r.cost).toBeCloseTo(7000, 6);
    expect(r.lifecycleStatus).toBe("Extended");
  });

  it("shows the extension only while the contract runs past its term without a cancellation", () => {
    // Signed 15-Jun-2023, 24 months: at 15-Sep-2026 DATEDIF gives 39 complete months, so V = 40.
    expect(toLoanBookRow(source()).extensionMonths).toBe(16);
    // Same contract cancelled: the extension column is not meaningful any more.
    expect(toLoanBookRow(source({ cancel_date: "2025-06-30" })).extensionMonths).toBeNull();
    // A contract inside its term has none.
    expect(toLoanBookRow(source({ signing_date: "2026-01-15", duration_months: 36 })).extensionMonths).toBeNull();
  });

  it("hides lifecycle and outstanding for contracts that are not signed", () => {
    const r = toLoanBookRow(source({ workflow_status: "draft" }));
    expect(r.lifecycleStatus).toBeNull();
    expect(r.outstanding).toBeNull();
  });

  it("carries the settlement amount", () => {
    expect(toLoanBookRow(source({ cancel_date: "2025-06-30", additional_status: "CAP", settlement_amount: "1800" })).settlementAmount).toBe(1800);
  });
});

describe("filter and sort", () => {
  const rows = [
    toLoanBookRow(source({ id: "a", contract_number: "LB-1", company: { name: "Alfa SL", cif: "B1" }, signing_date: "2024-01-10" })),
    toLoanBookRow(source({ id: "b", contract_number: "LB-2", company: { name: "Beta SA", cif: "B2" }, country: "PT", signing_date: "2025-05-10", cancel_date: "2026-01-15" })),
    toLoanBookRow(source({ id: "c", contract_number: "LB-3", company: { name: "Gamma SL", cif: "B3" }, workflow_status: "draft", signing_date: "2026-02-10" })),
  ];

  it("searches across contract, client, CIF, distributor and country", () => {
    expect(filterLoanBook(rows, { q: "beta" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterLoanBook(rows, { q: "PT" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterLoanBook(rows, { q: "LB-3" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterLoanBook(rows, {}).length).toBe(3);
  });

  it("filters by lifecycle status and by draft", () => {
    expect(filterLoanBook(rows, { status: "Finished" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterLoanBook(rows, { status: "draft" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("sorts, and ties break on the contract number", () => {
    expect(sortLoanBook(rows, "signing_asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sortLoanBook(rows, "signing_desc").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortLoanBook(rows, "client").map((r) => r.id)).toEqual(["a", "b", "c"]);
    // Drafts have no outstanding: they sort last.
    expect(sortLoanBook(rows, "outstanding_desc").at(-1)!.id).toBe("c");
    expect(isLoanBookSort("client")).toBe(true);
    expect(isLoanBookSort("nope")).toBe(false);
    expect(isLoanBookSort(undefined)).toBe(false);
    expect(sortLoanBook(rows, DEFAULT_SORT)).toHaveLength(3);
  });

  it("does not mutate the input array", () => {
    const order = rows.map((r) => r.id);
    sortLoanBook(rows, "client");
    expect(rows.map((r) => r.id)).toEqual(order);
  });
});

describe("export columns", () => {
  it("every column has a unique key and produces a value of its declared type", () => {
    const keys = EXPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    const row = toLoanBookRow(source({ cancel_date: "2025-06-30", additional_status: "CAP", settlement_amount: 1800 }));
    for (const column of EXPORT_COLUMNS) {
      const v = column.value(row);
      if (v === null) continue;
      if (column.type === "number" || column.type === "money" || column.type === "percent") {
        expect(typeof v, `${column.key} should be numeric`).toBe("number");
      } else {
        expect(typeof v, `${column.key} should be text`).toBe("string");
      }
    }
  });

  it("maps the headers and the values an analyst expects", () => {
    const row = toLoanBookRow(source({ cancel_date: "2025-06-30", additional_status: "Gesico" }));
    const cells = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c.header, c.value(row)]));
    expect(cells["Contrato"]).toBe("LB-16535");
    expect(cells["País"]).toBe("ES");
    expect(cells["Cancelación"]).toBe("2025-06-30");
    expect(cells["Estado adicional"]).toBe("Gesico");
    expect(cells["Estado"]).toBe("Finished");
    expect(cells["Liquidación"]).toBeNull();
  });

  it("totals only the money columns", () => {
    const rows = [
      toLoanBookRow(source({ id: "a" })),
      toLoanBookRow(source({ id: "b", cancel_date: "2025-06-30", additional_status: "CAC", settlement_amount: 500 })),
    ];
    const totals = exportTotals(rows);
    expect(totals.cost).toBeCloseTo(14000, 6);
    expect(totals.settlementAmount).toBe(500);
    expect(totals.outstanding).toBeCloseTo((rows[0].outstanding ?? 0) + (rows[1].outstanding ?? 0), 6);
    expect(Object.keys(totals)).toEqual(["cost", "outstanding", "settlementAmount"]);
  });
});
