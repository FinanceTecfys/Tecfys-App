/**
 * Holded API v2 sales document (GET /api/v2/invoices, /api/v2/credit-notes)
 * -> HoldedInvoiceRecord. Pure: the clock (`asOf`) and the id -> name lookups
 * are passed in.
 *
 * Field mapping (API -> export column):
 *   document_number -> Num            id -> holded_id
 *   date            -> Date, Operation date (v2 exposes no separate operation date)
 *   due_date        -> Due            contact_name -> Client
 *   description     -> Description    tags[] -> Tags ("#tag #tag", as exported)
 *   lines[].account -> Account (names via /api/v2/accounting-accounts)
 *   payment_method_id -> P.Method (name via /api/v2/payment-methods)
 *   lines[].project_id -> Project (name via /api/v2/projects)
 *   subtotal - discount -> Subtotal   tax -> IVA
 *   Σ line base × retention% -> Retención
 *   total -> Total   payments_total -> Collected   payments_pending -> Pending
 *   status (+ due date) -> Status (Paid / Pending / Partially paid / Overdue / Cancelled)
 * Not exposed by the v2 list: Empleados, Rec. de eq., Collected date,
 * Digital signature, SII -> null.
 */
import { z } from "zod";
import type { HoldedDocType, HoldedInvoiceRecord, MapResult } from "./invoice";
import { cleanText, parseHoldedDate, parseMoney } from "./values";

const decimal = z.union([z.string(), z.number()]).nullish();
const text = z.string().nullish();

const lineSchema = z.looseObject({
  price: decimal,
  units: decimal,
  discount: decimal,
  retention: decimal,
  account: z.union([z.string(), z.number()]).nullish(),
  project_id: text,
});

export const holdedApiDocumentSchema = z.looseObject({
  id: z.string(),
  document_number: text,
  contact_name: text,
  description: text,
  date: z.union([z.string(), z.number()]).nullish(),
  due_date: z.union([z.string(), z.number()]).nullish(),
  subtotal: decimal,
  discount: decimal,
  total: decimal,
  tax: decimal,
  status: text,
  tags: z.array(z.string()).nullish(),
  lines: z.array(lineSchema).nullish(),
  payment_method_id: text,
  payments_total: decimal,
  payments_pending: decimal,
});

export type HoldedApiDocument = z.infer<typeof holdedApiDocumentSchema>;

export const holdedApiPageSchema = z.object({
  items: z.array(z.unknown()),
  has_more: z.boolean().optional().default(false),
  cursor: z.string().nullish(),
});

/** id -> display name tables resolved once per sync. Missing entries fall back to the raw id. */
export interface HoldedLookups {
  paymentMethods: ReadonlyMap<string, string>;
  projects: ReadonlyMap<string, string>;
  /** Keyed by account id AND by its numeric code as a string. */
  accounts: ReadonlyMap<string, string>;
}

export const EMPTY_LOOKUPS: HoldedLookups = { paymentMethods: new Map(), projects: new Map(), accounts: new Map() };

const lookupItem = z.looseObject({ id: z.string(), name: z.string().nullish(), number: z.union([z.number(), z.string()]).nullish() });

/**
 * Lookup tables from the raw list responses of /api/v2/payment-methods,
 * /api/v2/projects and /api/v2/accounting-accounts. Items without an id or a
 * name are ignored. Accounts are keyed by id and by numeric code because the
 * docs only say lines carry the "accounting account code".
 */
export function buildLookups(raw: { paymentMethods?: unknown[]; projects?: unknown[]; accounts?: unknown[] }): HoldedLookups {
  const table = (items: unknown[] | undefined, withNumber = false) => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      const p = lookupItem.safeParse(item);
      const name = p.success ? cleanText(p.data.name) : null;
      if (!p.success || !name) continue;
      map.set(p.data.id, name);
      if (withNumber && p.data.number !== null && p.data.number !== undefined) map.set(String(p.data.number), name);
    }
    return map;
  };
  return { paymentMethods: table(raw.paymentMethods), projects: table(raw.projects), accounts: table(raw.accounts, true) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num0 = (v: unknown) => parseMoney(v) ?? 0;

/**
 * Holded's export status. The v2 enum has no "overdue": an unpaid document
 * past its due date (strictly before the `asOf` day) is reported Overdue, as
 * Holded's own export does.
 */
export function holdedStatusLabel(status: string | null | undefined, dueDate: string | null, asOf: Date): string | null {
  const s = status?.trim().toLowerCase();
  if (!s) return null;
  if (s === "completed" || s === "paid") return "Paid";
  if (s === "cancelled" || s === "canceled") return "Cancelled";
  if (s === "failed") return "Failed";
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const overdue = s === "overdue" || (dueDate !== null && Date.parse(dueDate) < today);
  if (s === "pending" || s === "partial" || s === "outstanding" || s === "overdue") {
    if (overdue) return "Overdue";
    return s === "partial" ? "Partially paid" : "Pending";
  }
  return status!.trim();
}

const formatTags = (tags: readonly string[] | null | undefined) => {
  const clean = (tags ?? []).map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
  return clean.length ? clean.map((t) => `#${t}`).join(" ") : null;
};

const distinctNames = (values: (string | null | undefined)[], lookup: ReadonlyMap<string, string>) => {
  const names = [...new Set(values.filter((v): v is string => Boolean(v)).map((v) => lookup.get(v) ?? v))];
  return names.length ? names.join(", ") : null;
};

/** Credit notes are negative in Holded's export whatever sign the API returns. */
const signFor = (docType: HoldedDocType) => (n: number | null) =>
  n === null ? null : docType === "creditnote" && n !== 0 ? -Math.abs(n) : n;

export function mapApiDocument(
  input: unknown,
  ctx: { docType: HoldedDocType; asOf: Date; lookups?: HoldedLookups },
): MapResult {
  const parsed = holdedApiDocumentSchema.safeParse(input);
  if (!parsed.success) {
    const id = typeof input === "object" && input && "id" in input ? String((input as { id: unknown }).id) : "?";
    return { ok: false, error: `Document ${id}: unexpected shape (${parsed.error.issues[0].path.join(".") || "root"}: ${parsed.error.issues[0].message})` };
  }
  const d = parsed.data;
  const lookups = ctx.lookups ?? EMPTY_LOOKUPS;
  const num = cleanText(d.document_number);
  if (!num) return { ok: false, error: `Document ${d.id}: no document number (draft?)` };
  const date = parseHoldedDate(d.date);
  if (!date) return { ok: false, error: `${num}: invalid date` };
  const total = parseMoney(d.total);
  if (total === null) return { ok: false, error: `${num}: invalid total` };

  const lines = d.lines ?? [];
  const withholding = round2(
    lines.reduce((s, l) => {
      const base = num0(l.price) * num0(l.units) * (1 - num0(l.discount) / 100);
      return s + (base * num0(l.retention)) / 100;
    }, 0),
  );
  const dueDate = parseHoldedDate(d.due_date);
  const sign = signFor(ctx.docType);

  const record: HoldedInvoiceRecord = {
    num,
    holded_id: d.id,
    doc_type: ctx.docType,
    date,
    operation_date: date,
    due_date: dueDate,
    client: cleanText(d.contact_name),
    description: cleanText(d.description),
    tags: formatTags(d.tags),
    account: distinctNames(lines.map((l) => (l.account === null || l.account === undefined ? null : String(l.account))), lookups.accounts),
    payment_method: d.payment_method_id ? lookups.paymentMethods.get(d.payment_method_id) ?? d.payment_method_id : null,
    project: distinctNames(lines.map((l) => l.project_id), lookups.projects),
    subtotal: sign(round2(num0(d.subtotal) - num0(d.discount)))!,
    vat: sign(parseMoney(d.tax)),
    withholding: sign(withholding),
    employees: null,
    equivalence_surcharge: null,
    total: sign(total)!,
    collected: sign(parseMoney(d.payments_total)),
    pending: sign(parseMoney(d.payments_pending)),
    status: holdedStatusLabel(d.status, dueDate, ctx.asOf),
    collected_date: null,
    digital_signature: null,
    sii: null,
  };
  return { ok: true, record };
}
