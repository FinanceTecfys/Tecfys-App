/**
 * The Holded sales invoice as stored in holded_sales_invoices: one field per
 * column of the Holded sales export, in the export's order. Money is a number
 * (credit notes negative), dates are ISO timestamps of the calendar day.
 */
export type HoldedDocType = "invoice" | "creditnote";
export type HoldedSource = "api" | "excel";

export interface HoldedInvoiceRecord {
  num: string;
  holded_id: string | null;
  doc_type: HoldedDocType;
  date: string;
  operation_date: string | null;
  due_date: string | null;
  client: string | null;
  description: string | null;
  tags: string | null;
  account: string | null;
  payment_method: string | null;
  project: string | null;
  subtotal: number;
  vat: number | null;
  withholding: number | null;
  employees: number | null;
  equivalence_surcharge: number | null;
  total: number;
  collected: number | null;
  pending: number | null;
  status: string | null;
  collected_date: string | null;
  digital_signature: string | null;
  sii: string | null;
}

export type MapResult = { ok: true; record: HoldedInvoiceRecord } | { ok: false; error: string };

/** Holded export header labels (sheet "Holded", row 5), in order, with the field each fills. */
export const HOLDED_COLUMNS = [
  { label: "Date", key: "date", kind: "date" },
  { label: "Num", key: "num", kind: "text" },
  { label: "Operation date", key: "operation_date", kind: "date" },
  { label: "Due", key: "due_date", kind: "date" },
  { label: "Client", key: "client", kind: "text" },
  { label: "Description", key: "description", kind: "text" },
  { label: "Tags", key: "tags", kind: "text" },
  { label: "Account", key: "account", kind: "text" },
  { label: "P.Method", key: "payment_method", kind: "text" },
  { label: "Project", key: "project", kind: "text" },
  { label: "Subtotal", key: "subtotal", kind: "money" },
  { label: "IVA", key: "vat", kind: "money" },
  { label: "Retención", key: "withholding", kind: "money" },
  { label: "Empleados", key: "employees", kind: "money" },
  { label: "Rec. de eq.", key: "equivalence_surcharge", kind: "money" },
  { label: "Total", key: "total", kind: "money" },
  { label: "Collected", key: "collected", kind: "money" },
  { label: "Pending", key: "pending", kind: "money" },
  { label: "Status", key: "status", kind: "text" },
  { label: "Collected date", key: "collected_date", kind: "date" },
  { label: "Digital signature", key: "digital_signature", kind: "text" },
  { label: "SII", key: "sii", kind: "text" },
] as const satisfies readonly { label: string; key: keyof HoldedInvoiceRecord; kind: "date" | "text" | "money" }[];

export type HoldedColumn = (typeof HOLDED_COLUMNS)[number];

/** Holded numbers credit notes "CN…"; everything else in the sales export is an invoice. */
export const docTypeFromNum = (num: string): HoldedDocType => (/^CN/i.test(num) ? "creditnote" : "invoice");
