/**
 * Holded sales export (sheet "Holded", header row 5) -> HoldedInvoiceRecord.
 * Pure: takes plain cell values (ExcelJS gives Date for date cells).
 */
import { docTypeFromNum, HOLDED_COLUMNS, type HoldedInvoiceRecord, type MapResult } from "./invoice";
import { cleanText, parseHoldedDate, parseMoney } from "./values";

export const HOLDED_SHEET = "Holded";
export const HOLDED_HEADER_ROW = 5;

const normalizeLabel = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : "");

export type HeaderIndex = Record<(typeof HOLDED_COLUMNS)[number]["key"], number>;

/**
 * Column position of every Holded field in the header row. Matches labels, not
 * positions, so a reordered export still maps. Throws naming the missing labels.
 */
export function buildHeaderIndex(header: readonly unknown[]): HeaderIndex {
  const positions = new Map<string, number>();
  header.forEach((v, i) => {
    const label = normalizeLabel(v);
    if (label && !positions.has(label)) positions.set(label, i);
  });
  const missing: string[] = [];
  const index = {} as HeaderIndex;
  for (const col of HOLDED_COLUMNS) {
    const pos = positions.get(normalizeLabel(col.label));
    if (pos === undefined) missing.push(col.label);
    else index[col.key] = pos;
  }
  if (missing.length) throw new Error(`Holded sheet header is missing: ${missing.join(", ")}`);
  return index;
}

/** One data row -> record. `rowNumber` only labels errors. */
export function mapExcelRow(cells: readonly unknown[], index: HeaderIndex, rowNumber?: number): MapResult {
  const at = (key: keyof HeaderIndex) => cells[index[key]];
  const where = rowNumber === undefined ? "" : ` (row ${rowNumber})`;

  const num = cleanText(at("num"));
  if (!num) return { ok: false, error: `Missing Num${where}` };
  const date = parseHoldedDate(at("date"));
  if (!date) return { ok: false, error: `${num}: invalid Date${where}` };
  const total = parseMoney(at("total"));
  if (total === null) return { ok: false, error: `${num}: invalid Total${where}` };

  const record: HoldedInvoiceRecord = {
    num,
    holded_id: null,
    doc_type: docTypeFromNum(num),
    date,
    operation_date: parseHoldedDate(at("operation_date")),
    due_date: parseHoldedDate(at("due_date")),
    client: cleanText(at("client")),
    description: cleanText(at("description")),
    tags: cleanText(at("tags")),
    account: cleanText(at("account")),
    payment_method: cleanText(at("payment_method")),
    project: cleanText(at("project")),
    subtotal: parseMoney(at("subtotal")) ?? 0,
    vat: parseMoney(at("vat")),
    withholding: parseMoney(at("withholding")),
    employees: parseMoney(at("employees")),
    equivalence_surcharge: parseMoney(at("equivalence_surcharge")),
    total,
    collected: parseMoney(at("collected")),
    pending: parseMoney(at("pending")),
    status: cleanText(at("status")),
    collected_date: parseHoldedDate(at("collected_date")),
    digital_signature: cleanText(at("digital_signature")),
    sii: cleanText(at("sii")),
  };
  return { ok: true, record };
}

/** True for rows with no value at all (the blank separator before the export footer). */
export const isBlankRow = (cells: readonly unknown[]) => cells.every((c) => c === null || c === undefined || (typeof c === "string" && c.trim() === ""));
