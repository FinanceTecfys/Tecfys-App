/**
 * The company master update policy, pure so every rule is unit-tested:
 * current company + incoming data (an Informa report behind a scoring, or what
 * was typed in "Nueva operación") + actor role -> what to write and what to record.
 *
 *   COMPANY = the current truth about the client, changed only through here and
 *             always recorded (company_changes);
 *   SCORING = an immutable snapshot of what the report said - kept whatever
 *             this policy decides about the master.
 *
 * Rules:
 *  - A brand-new CIF creates the company, whoever scores it.
 *  - Values are compared after normalisation (spacing, case, accents, the
 *    punctuation of legal forms, the format of a NIF / date / postal code), so a
 *    cosmetic difference is never a change.
 *  - A value is never replaced by an empty one.
 *  - Authoritative identity fields: a real difference is applied and recorded
 *    when the actor is Tecfys staff (companyMaster.update); for anyone else (a
 *    partner) it is NOT applied and is recorded as pending review.
 *  - Tecfys-maintained fields: filled only when empty, never overwritten
 *    (and, for a partner, the fill is pending too: a partner never writes).
 *  - Without a source (a scoring typed by hand, no Informa report) an existing
 *    company is left alone: there is nothing authoritative to compare with.
 */
import { can, type Role } from "@/lib/auth/permissions";
import type { Financials } from "@/modules/scoring/domain/financials";

/** Identity fields applied for staff and pending for a partner (Informa is their authority). */
export const INFORMA_FIELDS = [
  "name", "address", "fiscal_postal_code", "fiscal_city", "fiscal_province",
  "admin_name", "admin_nif", "cnae", "sector", "constitution_date", "employees",
] as const;
/** Contact data Tecfys users maintain: fill-only, never overwritten. */
export const FILL_ONLY_FIELDS = ["phone", "email", "web"] as const;
export const COMPANY_FIELDS = [...INFORMA_FIELDS, ...FILL_ONLY_FIELDS] as const;

export type InformaField = (typeof INFORMA_FIELDS)[number];
export type CompanyField = (typeof COMPANY_FIELDS)[number];
export type CompanyValue = string | number | null;
export type CompanyValues = Partial<Record<CompanyField, CompanyValue>>;

/** The company as stored (the columns this policy reads). */
export type CurrentCompany = { id: string; cif: string } & Record<CompanyField, CompanyValue>;

/** Where a change comes from: an Informa report behind a scoring, or an operation's form. */
export type ChangeSource = "informa_pdf" | "informa_api" | "operation";
export type ChangeStatus = "applied" | "pending";

export interface CompanyChange {
  field: CompanyField;
  /** "change": a different value replaces one; "fill": an empty field gets a value. */
  kind: "change" | "fill";
  oldValue: string | null;
  newValue: string;
  status: ChangeStatus;
}

/** What a scoring or an operation brings. Creating a company needs its CIF and name. */
export type IncomingCompany = CompanyValues & { cif?: string; country?: string };

export type CompanyUpdateDecision =
  /** New CIF: create the company with these columns. */
  | { kind: "create"; values: CompanyValues & { cif: string; name: string; country: string } }
  /** Existing company: write `apply` ({} = nothing) and record `changes`. */
  | { kind: "update"; companyId: string; apply: CompanyValues; changes: CompanyChange[] };

const isInforma = (field: CompanyField): field is InformaField => (INFORMA_FIELDS as readonly string[]).includes(field);

/** "dd/mm/yyyy" (Informa) or ISO -> ISO date; anything else null. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dmy = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value.trim()) ? value.trim().slice(0, 10) : null;
}

/** The company columns a scoring's (Informa-sourced, analyst-reviewed) data maps to. */
export function companyValuesFromFinancials(f: Financials): CompanyValues & { cif: string; name: string; country: string } {
  return {
    cif: f.cif,
    name: f.name,
    country: f.country || "ES",
    sector: f.sector,
    cnae: f.cnae,
    address: f.address,
    fiscal_postal_code: f.fiscalPostalCode,
    fiscal_city: f.fiscalCity,
    fiscal_province: f.fiscalProvince,
    phone: f.phone,
    email: f.email,
    web: f.web,
    constitution_date: toIsoDate(f.constitutionDate),
    employees: f.employees,
    admin_name: f.adminName,
    admin_nif: f.adminNif?.toUpperCase() ?? null,
  };
}

/** The value as stored text (history rows hold text), or null when empty. */
export function asText(value: CompanyValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/**
 * The comparable form of a value: equal forms are the same value. Null when empty.
 * Exported for the tests and for the wizard summary.
 */
export function comparable(field: CompanyField, value: CompanyValue | undefined): string | null {
  const text = asText(value);
  if (text === null) return null;
  switch (field) {
    case "name":
      // "ALFA, S.L." = "Alfa SL" = "ALFA S. L.": punctuation and spacing of the legal form are cosmetic.
      return fold(text).replace(/[.,]/g, "").replace(/\s+/g, " ").trim() || null;
    case "admin_nif":
      return text.toUpperCase().replace(/[\s.-]/g, "") || null;
    case "cnae":
    case "fiscal_postal_code":
    case "phone":
      return text.replace(/\D/g, "") || null;
    case "constitution_date":
      return toIsoDate(text);
    case "employees":
      return Number.isFinite(Number(text)) ? String(Number(text)) : null;
    case "email":
      return text.toLowerCase();
    case "web":
      return text.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "") || null;
    default:
      // address, city, province, administrator name, sector: case, accents and spacing are cosmetic.
      return fold(text).replace(/\s*,\s*/g, ", ");
  }
}

export function decideCompanyUpdate(input: {
  /** The stored company with this CIF, or null when the CIF is new. */
  current: CurrentCompany | null;
  /** What the scoring (companyValuesFromFinancials) or the operation (operationCompanyFields) brings. */
  incoming: IncomingCompany;
  actorRole: Role;
  /** Where the data comes from; null for a scoring typed by hand (no Informa report). */
  source: ChangeSource | null;
}): CompanyUpdateDecision {
  const { current, incoming, actorRole, source } = input;
  if (!current) {
    const name = asText(incoming.name);
    if (!incoming.cif || !name) throw new Error("A new company needs its CIF and name");
    return { kind: "create", values: { ...incoming, cif: incoming.cif, name, country: incoming.country || "ES" } };
  }
  if (!source) return { kind: "update", companyId: current.id, apply: {}, changes: [] };

  const staff = can(actorRole, "companyMaster.update");
  const apply: CompanyValues = {};
  const changes: CompanyChange[] = [];
  for (const field of COMPANY_FIELDS) {
    const next = comparable(field, incoming[field]);
    if (next === null) continue; // never replace with empty
    const now = comparable(field, current[field]);
    if (now === next) continue; // cosmetic or no difference
    const kind = now === null ? "fill" : "change";
    if (kind === "change" && !isInforma(field)) continue; // Tecfys-maintained: fill-only
    const status: ChangeStatus = staff ? "applied" : "pending";
    const value = incoming[field] as CompanyValue;
    changes.push({ field, kind, oldValue: asText(current[field]), newValue: asText(value)!, status });
    if (status === "applied") apply[field] = typeof value === "string" ? asText(value) : value;
  }
  return { kind: "update", companyId: current.id, apply, changes };
}

/** One change as the forms show it before saving (staff only). */
export interface ChangePreview {
  field: CompanyField;
  kind: "change" | "fill";
  from: string | null;
  to: string;
}

export const changePreviews = (changes: readonly CompanyChange[]): ChangePreview[] =>
  changes.map((c) => ({ field: c.field, kind: c.kind, from: c.oldValue, to: c.newValue }));
