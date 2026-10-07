/**
 * Columns of the loan-book table: the registry the column chooser lists, the
 * default set and the parsing of the user's stored choice. Pure - no React,
 * no localStorage - so the choice is validated the same way wherever it is read.
 *
 * Screen only: the Excel / PDF exports keep their own full, fixed column set
 * (EXPORT_COLUMNS) whatever is shown here.
 */
import { type LoanBookRowView, type LoanBookSource, toLoanBookRow } from "./loan-book-view";

/** The loan-book row plus the fields only the optional columns show. */
export interface LoanBookTableRow extends LoanBookRowView {
  rating: string | null;
  trancheLender: string | null;
  hasGuarantor: boolean;
  /** Workbook col. S: complete months since signing, to the cancellation or the as-of date. Null until signed. */
  elapsedMonths: number | null;
  /** Workbook col. V: months the contract actually pays (extended or cut short). Null until signed. */
  realMonths: number | null;
  /** Purchase value of the equipment, before the expo adjustment. */
  purchaseValue: number;
  /** Workbook col. AS; cost = purchase value - expo adjustment. */
  expoAdjustment: number;
  residualValue: number | null;
}

export interface LoanBookTableSource extends LoanBookSource {
  row: LoanBookSource["row"] & {
    rating: string | null;
    tranche_lender: string | null;
    has_guarantor: boolean;
    purchase_value: number | string;
    expo_adjustment: number | string;
    residual_value: number | string | null;
  };
}

export function toLoanBookTableRow(source: LoanBookTableSource): LoanBookTableRow {
  const { row, schedule } = source;
  const signed = row.workflow_status === "signed";
  return {
    ...toLoanBookRow(source),
    rating: row.rating,
    trancheLender: row.tranche_lender,
    hasGuarantor: row.has_guarantor,
    elapsedMonths: signed ? schedule.elapsedMonths : null,
    realMonths: signed ? schedule.paymentHorizon : null,
    purchaseValue: Number(row.purchase_value),
    expoAdjustment: Number(row.expo_adjustment),
    residualValue: row.residual_value === null ? null : Number(row.residual_value),
  };
}

export interface LoanBookColumn {
  /** Also the key of the column's header in the catalogue: loanBook.columns.<key>. */
  key: string;
  /** Shown until the user chooses otherwise: today's table. */
  default: boolean;
  /** Always shown: the link into the contract. */
  locked?: boolean;
}

/** In table order: an optional column appears next to the ones it relates to. */
export const LOAN_BOOK_COLUMNS = [
  { key: "contractNumber", default: true, locked: true },
  { key: "loanBookRef", default: false },
  { key: "client", default: true },
  { key: "cif", default: false },
  { key: "country", default: true },
  { key: "distributor", default: true },
  { key: "assetType", default: true },
  { key: "assetCluster", default: false },
  { key: "contractType", default: false },
  { key: "rating", default: false },
  { key: "signingDate", default: true },
  { key: "durationMonths", default: true },
  { key: "extensionMonths", default: true },
  { key: "elapsedMonths", default: false },
  { key: "realMonths", default: false },
  { key: "installment", default: true },
  { key: "cost", default: true },
  { key: "purchaseValue", default: false },
  { key: "expoAdjustment", default: false },
  { key: "residualValue", default: false },
  { key: "expectedAnnualIrr", default: true },
  { key: "status", default: true },
  { key: "cancelDate", default: true },
  { key: "additionalStatus", default: true },
  { key: "settlementAmount", default: false },
  { key: "outstanding", default: true },
  { key: "defaultAmount", default: true },
  { key: "trancheLender", default: false },
  { key: "hasGuarantor", default: false },
] as const satisfies readonly LoanBookColumn[];

export type LoanBookColumnKey = (typeof LOAN_BOOK_COLUMNS)[number]["key"];

const COLUMNS: readonly LoanBookColumn[] = LOAN_BOOK_COLUMNS;
const pick = (test: (c: LoanBookColumn) => boolean | undefined) => COLUMNS.filter(test).map((c) => c.key as LoanBookColumnKey);

export const DEFAULT_COLUMN_KEYS: LoanBookColumnKey[] = pick((c) => c.default || c.locked);
const LOCKED_KEYS: readonly LoanBookColumnKey[] = pick((c) => c.locked);

/** A UI preference of this browser, kept apart per user so a shared computer does not mix them. */
export const columnsStorageKey = (userId: string): string => `tecfys.loan-book.columns.v1:${userId}`;

/** Registry order, locked columns always in, unknown keys dropped. */
function normalize(keys: readonly unknown[]): LoanBookColumnKey[] {
  return pick((c) => c.locked || keys.includes(c.key));
}

/**
 * The stored choice -> the columns to show. Nothing stored, or something that
 * is not a list of column keys, is the default set; a list is trusted only for
 * the keys the registry knows (a column removed from the app just disappears).
 */
export function parseStoredColumns(raw: string | null | undefined): LoanBookColumnKey[] {
  if (!raw) return DEFAULT_COLUMN_KEYS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_COLUMN_KEYS;
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return DEFAULT_COLUMN_KEYS;
  return normalize(value);
}

export const serializeColumns = (keys: readonly LoanBookColumnKey[]): string => JSON.stringify(normalize(keys));

/** Show or hide one column; a locked column stays. */
export function toggleColumn(visible: readonly LoanBookColumnKey[], key: LoanBookColumnKey): LoanBookColumnKey[] {
  if (LOCKED_KEYS.includes(key)) return normalize(visible);
  return normalize(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
}

export const isDefaultColumns = (visible: readonly LoanBookColumnKey[]): boolean =>
  serializeColumns(visible) === serializeColumns(DEFAULT_COLUMN_KEYS);
