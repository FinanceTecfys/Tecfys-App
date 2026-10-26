import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import {
  columnsStorageKey,
  DEFAULT_COLUMN_KEYS,
  isDefaultColumns,
  LOAN_BOOK_COLUMNS,
  type LoanBookTableSource,
  parseStoredColumns,
  serializeColumns,
  toggleColumn,
  toLoanBookTableRow,
} from "../loan-book-columns";
import { toLoanBookRow } from "../loan-book-view";
import { monthKeyOfDate } from "../month-key";
import { buildSchedule, principalOutstandingAt } from "../schedule";

const asOf = new Date(Date.UTC(2026, 8, 15));

function source(over: Partial<LoanBookTableSource["row"]> = {}): LoanBookTableSource {
  const row = {
    id: "id-1",
    contract_number: "LB-16535",
    loan_book_ref: "16535",
    contract_type: "Renting",
    country: "ES",
    signing_date: "2023-06-15",
    duration_months: 24,
    installment: 340,
    cancel_date: null as string | null,
    additional_status: null,
    settlement_amount: null,
    workflow_status: "signed",
    company: { name: "BLUEGROUND ESPANA", cif: "B12345678" },
    distributor: { name: "Nicton" },
    asset_type: { name: "Water Dispenser", cluster: "Hospitality Machinery" },
    rating: "BBB",
    tranche_lender: "Claret",
    has_guarantor: true,
    purchase_value: "7200.50" as number | string,
    expo_adjustment: "200.50" as number | string,
    residual_value: "340" as number | string | null,
    ...over,
  };
  const schedule = buildSchedule(
    {
      signingDate: row.signing_date,
      billingLagMonths: 0,
      durationMonths: row.duration_months,
      installment: Number(row.installment),
      residualValue: row.residual_value === null ? null : Number(row.residual_value),
      purchaseValue: Number(row.purchase_value),
      expoAdjustment: Number(row.expo_adjustment),
      cancelDate: row.cancel_date,
      residualWaived: false,
      amortizeOverRealLife: false,
    },
    asOf,
  );
  return { row, schedule, outstanding: principalOutstandingAt(schedule, monthKeyOfDate(asOf)) ?? 0 };
}

describe("toLoanBookTableRow", () => {
  it("keeps the loan-book row untouched and adds the optional fields from the stored inputs", () => {
    const s = source();
    const r = toLoanBookTableRow(s);
    expect(r).toMatchObject(toLoanBookRow(s));
    expect(r).toMatchObject({ rating: "BBB", trancheLender: "Claret", hasGuarantor: true, purchaseValue: 7200.5, expoAdjustment: 200.5, residualValue: 340 });
    // Cost is the engine's asset base: purchase value less the expo adjustment.
    expect(r.cost).toBeCloseTo(r.purchaseValue - r.expoAdjustment, 6);
  });

  it("reads the elapsed and real months from the engine, for signed contracts only", () => {
    const s = source();
    const extended = toLoanBookTableRow(s);
    expect(extended.elapsedMonths).toBe(s.schedule.elapsedMonths);
    expect(extended.realMonths).toBe(s.schedule.paymentHorizon);
    expect(extended.realMonths).toBe(extended.durationMonths + (extended.extensionMonths ?? 0));

    const cancelled = toLoanBookTableRow(source({ cancel_date: "2024-03-20" }));
    expect(cancelled.realMonths).toBe(10);

    const draft = toLoanBookTableRow(source({ workflow_status: "draft", residual_value: null }));
    expect(draft).toMatchObject({ elapsedMonths: null, realMonths: null, residualValue: null });
  });
});

describe("column registry", () => {
  const keys = LOAN_BOOK_COLUMNS.map((c) => c.key);

  it("has unique keys and one locked column, the link into the contract", () => {
    expect(new Set(keys).size).toBe(keys.length);
    expect(LOAN_BOOK_COLUMNS.filter((c) => "locked" in c && c.locked).map((c) => c.key)).toEqual(["contractNumber"]);
  });

  it("defaults to the table as it was before the chooser", () => {
    expect(LOAN_BOOK_COLUMNS.filter((c) => DEFAULT_COLUMN_KEYS.includes(c.key)).map((c) => es.loanBook.columns[c.key])).toEqual([
      "Contrato", "Cliente", "País", "Distribuidor", "Tipo de activo", "Firma", "Meses", "Ext.", "Cuota", "Coste",
      "Expected IRR", "Estado", "Cancelación", "Estado adicional", "Principal pendiente", "Default",
    ]);
  });

  it("every column has a header in both languages, and no header without a column", () => {
    expect(Object.keys(es.loanBook.columns).sort()).toEqual([...keys].sort());
    expect(Object.keys(en.loanBook.columns).sort()).toEqual([...keys].sort());
  });

  it("offers the fields the view computes but the table did not show", () => {
    expect(keys.filter((k) => !DEFAULT_COLUMN_KEYS.includes(k))).toEqual([
      "loanBookRef", "cif", "assetCluster", "contractType", "rating", "elapsedMonths", "realMonths", "purchaseValue",
      "expoAdjustment", "residualValue", "settlementAmount", "trancheLender", "hasGuarantor",
    ]);
  });

  it("every column is a field of the row (status is derived from two of them)", () => {
    const row = toLoanBookTableRow(source());
    for (const key of keys) if (key !== "status") expect(row, key).toHaveProperty(key);
  });
});

describe("parseStoredColumns", () => {
  it("is the default set when nothing usable is stored", () => {
    for (const raw of [null, undefined, "", "not json", "{}", "null", "42", '"client"', '[1,2]', '["client",null]', '{"client":true}']) {
      expect(parseStoredColumns(raw), String(raw)).toEqual(DEFAULT_COLUMN_KEYS);
    }
  });

  it("keeps the known keys in table order, whatever order they were stored in", () => {
    expect(parseStoredColumns('["outstanding","cif","client","contractNumber"]')).toEqual(["contractNumber", "client", "cif", "outstanding"]);
  });

  it("drops unknown or inherited keys and duplicates, and never loses the locked column", () => {
    expect(parseStoredColumns('["client","client","toString","__proto__","removedColumn"]')).toEqual(["contractNumber", "client"]);
    expect(parseStoredColumns("[]")).toEqual(["contractNumber"]);
  });

  it("round-trips through serializeColumns", () => {
    const chosen = parseStoredColumns('["residualValue","client"]');
    expect(parseStoredColumns(serializeColumns(chosen))).toEqual(chosen);
    expect(parseStoredColumns(serializeColumns(DEFAULT_COLUMN_KEYS))).toEqual(DEFAULT_COLUMN_KEYS);
  });
});

describe("toggleColumn", () => {
  it("shows a hidden column in its place and hides a shown one", () => {
    const withCif = toggleColumn(DEFAULT_COLUMN_KEYS, "cif");
    expect(withCif.slice(0, 4)).toEqual(["contractNumber", "client", "cif", "country"]);
    expect(toggleColumn(withCif, "cif")).toEqual(DEFAULT_COLUMN_KEYS);
    expect(toggleColumn(DEFAULT_COLUMN_KEYS, "client")).not.toContain("client");
  });

  it("cannot hide the locked column", () => {
    expect(toggleColumn(DEFAULT_COLUMN_KEYS, "contractNumber")).toEqual(DEFAULT_COLUMN_KEYS);
    expect(toggleColumn([], "contractNumber")).toEqual(["contractNumber"]);
  });

  it("does not mutate its input", () => {
    const before = [...DEFAULT_COLUMN_KEYS];
    toggleColumn(DEFAULT_COLUMN_KEYS, "cif");
    expect(DEFAULT_COLUMN_KEYS).toEqual(before);
  });
});

describe("isDefaultColumns / columnsStorageKey", () => {
  it("recognises the default set", () => {
    expect(isDefaultColumns(DEFAULT_COLUMN_KEYS)).toBe(true);
    expect(isDefaultColumns(toggleColumn(DEFAULT_COLUMN_KEYS, "cif"))).toBe(false);
  });

  it("keeps one preference per user", () => {
    expect(columnsStorageKey("u1")).not.toBe(columnsStorageKey("u2"));
    expect(columnsStorageKey("u1")).toContain("loan-book.columns");
  });
});
