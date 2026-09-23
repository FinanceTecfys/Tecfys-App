/**
 * Loan book view: the flat row behind the table and both exports, plus the
 * filtering and sorting they share. Pure - no Supabase, no React - so the
 * screen and the Excel / PDF exports can never drift apart.
 */
import type { ContractSchedule, ContractStatus } from "./schedule";

export interface LoanBookRowView {
  id: string;
  contractNumber: string;
  loanBookRef: string | null;
  client: string;
  cif: string | null;
  country: string | null;
  distributor: string | null;
  assetType: string | null;
  assetCluster: string | null;
  contractType: string;
  signingDate: string;
  durationMonths: number;
  /** Months beyond the contractual term, only while the contract is extended. */
  extensionMonths: number | null;
  installment: number;
  cost: number;
  expectedAnnualIrr: number | null;
  workflowStatus: string;
  /** Lifecycle from the engine; null while the contract is not signed. */
  lifecycleStatus: ContractStatus | null;
  cancelDate: string | null;
  additionalStatus: string | null;
  settlementAmount: number | null;
  outstanding: number | null;
  /**
   * Workbook col. BD (Principal!Profit/loss): principal the contract failed to
   * repay at its expected IRR, i.e. the write-off booked as default in the
   * cancellation month. Negative, BD's own sign; null when nothing is lost.
   */
  defaultAmount: number | null;
}

export interface LoanBookSource {
  row: {
    id: string;
    contract_number: string;
    loan_book_ref: string | null;
    contract_type: string;
    country: string | null;
    signing_date: string;
    duration_months: number;
    installment: number | string;
    cancel_date: string | null;
    additional_status: string | null;
    settlement_amount: number | string | null;
    workflow_status: string;
    company: { name: string; cif: string } | null;
    distributor: { name: string } | null;
    asset_type: { name: string; cluster: string } | null;
  };
  schedule: ContractSchedule;
  outstanding: number;
}

export function toLoanBookRow({ row, schedule, outstanding }: LoanBookSource): LoanBookRowView {
  const signed = row.workflow_status === "signed";
  // Col. O of the workbook: months run beyond the contractual term, and only
  // meaningful while the contract is still extended (no cancellation).
  const extension = schedule.paymentHorizon - row.duration_months;
  return {
    id: row.id,
    contractNumber: row.contract_number,
    loanBookRef: row.loan_book_ref,
    client: row.company?.name ?? "—",
    cif: row.company?.cif ?? null,
    country: row.country,
    distributor: row.distributor?.name ?? null,
    assetType: row.asset_type?.name ?? null,
    assetCluster: row.asset_type?.cluster ?? null,
    contractType: row.contract_type,
    signingDate: row.signing_date,
    durationMonths: row.duration_months,
    extensionMonths: !row.cancel_date && extension > 0 ? extension : null,
    installment: Number(row.installment),
    cost: schedule.assetBase,
    expectedAnnualIrr: schedule.expectedAnnualIrr,
    workflowStatus: row.workflow_status,
    lifecycleStatus: signed ? schedule.status : null,
    cancelDate: row.cancel_date,
    additionalStatus: row.additional_status,
    settlementAmount: row.settlement_amount === null ? null : Number(row.settlement_amount),
    outstanding: signed ? outstanding : null,
    // Only a real shortfall is a default; a contract that recovers its cost has BD = 0.
    defaultAmount: signed && schedule.principalResult < -0.005 ? schedule.principalResult : null,
  };
}

// ---------------------------------------------------------------------------
// Grouping keys shared with the dashboard, so a chart segment and the loan-book
// filter it drills into are the same definition by construction.
// ---------------------------------------------------------------------------

/** Buckets over each contract's own outstanding balance (lower bound in, upper out). */
export const LOAN_SIZE_BUCKETS = [
  { key: "lt1k", label: "<1k", min: 0, max: 1000 },
  { key: "1k5k", label: "1k–5k", min: 1000, max: 5000 },
  { key: "5k10k", label: "5k–10k", min: 5000, max: 10000 },
  { key: "10k20k", label: "10k–20k", min: 10000, max: 20000 },
  { key: "20k50k", label: "20k–50k", min: 20000, max: 50000 },
  { key: "gt50k", label: ">50k", min: 50000, max: Number.POSITIVE_INFINITY },
] as const;

export type LoanSizeBucket = (typeof LOAN_SIZE_BUCKETS)[number];

/** Bucket of a positive outstanding balance; null when nothing is outstanding. */
export function loanSizeBucketOf(outstanding: number | null): LoanSizeBucket | null {
  if (outstanding === null || !(outstanding > 0)) return null;
  return LOAN_SIZE_BUCKETS.find((b) => outstanding >= b.min && outstanding < b.max) ?? null;
}

/** Key of the "no value" group (no distributor, no country...). */
export const NONE_KEY = "__none__";

/** Case- and space-insensitive key of a grouped value. */
export const groupKeyOf = (value: string | null): string => value?.trim().toLowerCase() || NONE_KEY;

/** The client is identified by its CIF; by its name only when there is no CIF. */
export const clientKeyOf = (r: Pick<LoanBookRowView, "cif" | "client">): string => r.cif ?? r.client;

/** Loan-book filters over a grouped dimension -> the row field they read. */
export const GROUP_FILTERS = { country: "country", distributor: "distributor", cluster: "assetCluster" } as const;
export type GroupFilter = keyof typeof GROUP_FILTERS;
const GROUP_FILTER_NAMES = Object.keys(GROUP_FILTERS) as GroupFilter[];

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface LoanBookFilters {
  q?: string;
  /** Lifecycle status, or "draft" for everything not signed. */
  status?: string;
  /** Client key (clientKeyOf). */
  client?: string;
  /** Group keys (groupKeyOf); several values match any of them. */
  country?: string[];
  distributor?: string[];
  cluster?: string[];
  /** LOAN_SIZE_BUCKETS key, over the outstanding balance. */
  size?: string;
  /** "YYYY-MM": contracts written off as default in that month (cancellation month, BD < 0). */
  defaulted?: string;
  /** Only contracts with principal outstanding (> 0). */
  pending?: boolean;
}

export function filterLoanBook(rows: LoanBookRowView[], filters: LoanBookFilters): LoanBookRowView[] {
  const { q, status, client, size, defaulted, pending } = filters;
  const needle = q?.trim().toLowerCase();
  const groups = GROUP_FILTER_NAMES
    .map((name) => ({ field: GROUP_FILTERS[name], keys: filters[name] ?? [] }))
    .filter((g) => g.keys.length > 0);
  return rows.filter((r) => {
    if (status === "draft" ? r.lifecycleStatus !== null : status && r.lifecycleStatus !== status) return false;
    if (pending && !((r.outstanding ?? 0) > 0)) return false;
    if (client && clientKeyOf(r) !== client) return false;
    if (groups.some((g) => !g.keys.includes(groupKeyOf(r[g.field])))) return false;
    if (size && loanSizeBucketOf(r.outstanding)?.key !== size) return false;
    if (defaulted && (r.defaultAmount === null || r.cancelDate?.slice(0, 7) !== defaulted)) return false;
    if (!needle) return true;
    return [r.contractNumber, r.loanBookRef, r.client, r.cif, r.distributor, r.country, r.assetType, r.assetCluster]
      .some((v) => v?.toLowerCase().includes(needle));
  });
}

export interface FilterOption {
  value: string;
  label: string;
}

/** Choices of the loan-book filter selects, from the rows themselves (label = first spelling seen). */
export function loanBookFilterOptions(rows: readonly LoanBookRowView[], emptyLabel = "Sin informar") {
  const collect = (key: (r: LoanBookRowView) => string, label: (r: LoanBookRowView) => string): FilterOption[] => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const k = key(r);
      if (!seen.has(k)) seen.set(k, label(r));
    }
    return [...seen.entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label, "es"));
  };
  const group = (field: (typeof GROUP_FILTERS)[GroupFilter]) => collect((r) => groupKeyOf(r[field]), (r) => r[field]?.trim() || emptyLabel);
  return {
    client: collect(clientKeyOf, (r) => (r.cif ? `${r.client} (${r.cif})` : r.client)),
    country: group("country"),
    distributor: group("distributor"),
    cluster: group("assetCluster"),
  };
}

export const LOAN_BOOK_SORTS = {
  signing_desc: { label: "Firma (recientes primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => b.signingDate.localeCompare(a.signingDate) },
  signing_asc: { label: "Firma (antiguos primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => a.signingDate.localeCompare(b.signingDate) },
  client: { label: "Cliente (A-Z)", compare: (a: LoanBookRowView, b: LoanBookRowView) => a.client.localeCompare(b.client, "es") },
  outstanding_desc: { label: "Principal pendiente (mayor primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => (b.outstanding ?? -1) - (a.outstanding ?? -1) },
  cost_desc: { label: "Coste (mayor primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => b.cost - a.cost },
  default_desc: { label: "Default (mayor primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => (a.defaultAmount ?? 0) - (b.defaultAmount ?? 0) },
  cancel_desc: { label: "Cancelación (recientes primero)", compare: (a: LoanBookRowView, b: LoanBookRowView) => (b.cancelDate ?? "").localeCompare(a.cancelDate ?? "") },
} as const;

export type LoanBookSort = keyof typeof LOAN_BOOK_SORTS;
export const DEFAULT_SORT: LoanBookSort = "signing_desc";

/** Explicit allow-list: `in` would also accept inherited keys such as "toString". */
export const LOAN_BOOK_SORT_KEYS = Object.keys(LOAN_BOOK_SORTS) as LoanBookSort[];

export const isLoanBookSort = (value: string | undefined): value is LoanBookSort =>
  value !== undefined && (LOAN_BOOK_SORT_KEYS as string[]).includes(value);

export function sortLoanBook(rows: LoanBookRowView[], sort: LoanBookSort): LoanBookRowView[] {
  // Contract number breaks ties so the order is stable between exports.
  const { compare } = LOAN_BOOK_SORTS[sort];
  return [...rows].sort((a, b) => compare(a, b) || a.contractNumber.localeCompare(b.contractNumber));
}

export type ExportValue = string | number | null;
export interface ExportColumn {
  key: string;
  header: string;
  type: "text" | "number" | "money" | "percent" | "date";
  /** Column width in characters (Excel) / relative units (PDF). */
  width: number;
  value: (row: LoanBookRowView) => ExportValue;
}

/** One definition per column, used by both the Excel and the PDF export. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "contractNumber", header: "Contrato", type: "text", width: 14, value: (r) => r.contractNumber },
  { key: "loanBookRef", header: "Ref. Loan book", type: "text", width: 14, value: (r) => r.loanBookRef },
  { key: "client", header: "Cliente", type: "text", width: 32, value: (r) => r.client },
  { key: "cif", header: "CIF", type: "text", width: 12, value: (r) => r.cif },
  { key: "country", header: "País", type: "text", width: 7, value: (r) => r.country },
  { key: "distributor", header: "Distribuidor", type: "text", width: 16, value: (r) => r.distributor },
  { key: "assetType", header: "Tipo de activo", type: "text", width: 18, value: (r) => r.assetType },
  { key: "assetCluster", header: "Grupo de activo", type: "text", width: 18, value: (r) => r.assetCluster },
  { key: "contractType", header: "Tipo", type: "text", width: 14, value: (r) => r.contractType },
  { key: "signingDate", header: "Firma", type: "date", width: 11, value: (r) => r.signingDate },
  { key: "durationMonths", header: "Meses", type: "number", width: 7, value: (r) => r.durationMonths },
  { key: "extensionMonths", header: "Ext.", type: "number", width: 6, value: (r) => r.extensionMonths },
  { key: "installment", header: "Cuota", type: "money", width: 11, value: (r) => r.installment },
  { key: "cost", header: "Coste", type: "money", width: 12, value: (r) => r.cost },
  { key: "expectedAnnualIrr", header: "IRR esperada", type: "percent", width: 12, value: (r) => r.expectedAnnualIrr },
  { key: "status", header: "Estado", type: "text", width: 12, value: (r) => r.lifecycleStatus ?? r.workflowStatus },
  { key: "cancelDate", header: "Cancelación", type: "date", width: 12, value: (r) => r.cancelDate },
  { key: "additionalStatus", header: "Estado adicional", type: "text", width: 16, value: (r) => r.additionalStatus },
  { key: "settlementAmount", header: "Liquidación", type: "money", width: 12, value: (r) => r.settlementAmount },
  { key: "outstanding", header: "Principal pendiente", type: "money", width: 16, value: (r) => r.outstanding },
  { key: "defaultAmount", header: "Default (BD)", type: "money", width: 13, value: (r) => r.defaultAmount },
];

/** Totals row: only the money columns that make sense to add up. */
export const EXPORT_TOTAL_COLUMNS = ["cost", "outstanding", "settlementAmount", "defaultAmount"] as const;

export function exportTotals(rows: LoanBookRowView[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const key of EXPORT_TOTAL_COLUMNS) {
    const column = EXPORT_COLUMNS.find((c) => c.key === key)!;
    totals[key] = rows.reduce((sum, r) => sum + (Number(column.value(r)) || 0), 0);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Query string: one parser / serializer for the page, the exports and the
// dashboard drill-down links.
// ---------------------------------------------------------------------------

const MONTH_INPUT = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface LoanBookQuery extends LoanBookFilters {
  sort?: LoanBookSort;
  /** "YYYY-MM": read the book as of the end of that month (never beyond today). */
  asof?: string;
}

/** Parse the loan-book query; unknown or malformed values are dropped, never guessed. */
export function parseLoanBookQuery(sp: URLSearchParams): LoanBookQuery {
  const one = (name: string) => sp.get(name)?.trim() || undefined;
  const many = (name: string) => [...new Set(sp.getAll(name).map((v) => v.trim()).filter(Boolean))];
  const month = (name: string) => {
    const v = one(name);
    return v && MONTH_INPUT.test(v) ? v : undefined;
  };
  const size = one("size");
  const sort = one("sort");
  return {
    q: one("q"),
    status: one("status"),
    client: one("client"),
    country: many("country"),
    distributor: many("distributor"),
    cluster: many("cluster"),
    size: LOAN_SIZE_BUCKETS.some((b) => b.key === size) ? size : undefined,
    defaulted: month("defaulted"),
    pending: sp.get("pending") === "1",
    sort: isLoanBookSort(sort) ? sort : undefined,
    asof: month("asof"),
  };
}

/** Next's searchParams record -> URLSearchParams, keeping repeated params. */
export function toSearchParams(record: Record<string, string | string[] | undefined>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) sp.append(key, v);
  }
  return sp;
}

/** Serialize a query (plus extra params such as page / format), omitting empty values. */
export function loanBookSearch(query: LoanBookQuery, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  const set = (name: string, value: string | undefined) => {
    if (value) sp.set(name, value);
  };
  set("q", query.q);
  set("status", query.status);
  set("client", query.client);
  for (const name of GROUP_FILTER_NAMES) for (const v of query[name] ?? []) sp.append(name, v);
  set("size", query.size);
  set("defaulted", query.defaulted);
  if (query.pending) sp.set("pending", "1");
  set("asof", query.asof);
  set("sort", query.sort);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  return sp.toString();
}

/** True when any row filter (not the sort or the as-of month) is set. */
export const hasLoanBookFilters = (f: LoanBookFilters): boolean =>
  Boolean(f.q || f.status || f.client || f.size || f.defaulted || f.pending || GROUP_FILTER_NAMES.some((n) => f[n]?.length));

/**
 * As-of date of a "YYYY-MM" month: its last day, capped at today - the same
 * convention the dashboard reads its point-in-time figures with.
 */
export function asOfForMonth(month: string | undefined, now: Date): Date {
  if (!month || !MONTH_INPUT.test(month)) return now;
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0));
  return end < now ? end : now;
}
