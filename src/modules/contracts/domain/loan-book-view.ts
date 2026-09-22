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

export interface LoanBookFilters {
  q?: string;
  /** Lifecycle status, or "draft" for everything not signed. */
  status?: string;
}

export function filterLoanBook(rows: LoanBookRowView[], { q, status }: LoanBookFilters): LoanBookRowView[] {
  const needle = q?.trim().toLowerCase();
  return rows.filter((r) => {
    if (status === "draft" ? r.lifecycleStatus !== null : status && r.lifecycleStatus !== status) return false;
    if (!needle) return true;
    return [r.contractNumber, r.loanBookRef, r.client, r.cif, r.distributor, r.country, r.assetType, r.assetCluster]
      .some((v) => v?.toLowerCase().includes(needle));
  });
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

export const isLoanBookSort = (value: string | undefined): value is LoanBookSort =>
  value !== undefined && value in LOAN_BOOK_SORTS;

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
