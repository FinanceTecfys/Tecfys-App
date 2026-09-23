import "server-only";
import { db } from "@/lib/supabase/server";
import { ATTACHMENT_BUCKET, type AttachmentKind, type StoredAttachment } from "./domain/attachments";
import type { ContractDraftSource } from "./domain/contract-template";
import { monthKeyOfDate } from "./domain/month-key";
import { buildSchedule, type ContractInput, type ContractSchedule, principalOutstandingAt } from "./domain/schedule";

const CONTRACT_SELECT = `
  id, contract_number, loan_book_ref, contract_type, tranche_lender, product_type, rating, sector, country,
  settlement_amount,
  signing_date, duration_months, installment, residual_value, purchase_value, expo_adjustment,
  has_guarantor, guarantor_name, guarantor_nif, cancel_date, additional_status, residual_waived,
  amortize_over_real_life, workflow_status, notes, created_at, scoring_id,
  client_name, client_cif, fiscal_address, fiscal_postal_code, fiscal_city, fiscal_province,
  signatory_name, signatory_nif, signatory_address, contact_name, contact_phone, contact_email,
  delivery_same_as_fiscal, delivery_address, guarantor_address, guarantor_representative,
  guarantor_representative_nif, product_description,
  company:companies ( id, cif, name ),
  distributor:distributors ( id, name ),
  asset_type:asset_types ( id, name, cluster ),
  type:contract_types ( billing_lag_months ),
  mandate:sepa_mandates ( mandate_reference, debtor_name, debtor_address, debtor_postal_code, debtor_city, debtor_province, iban, bic, recurrent, signed_place, signed_at )
`;

async function fetchContracts(filter?: { companyId?: string }) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from("contracts").select(CONTRACT_SELECT).order("signing_date", { ascending: false }).order("contract_number").range(from, from + 999);
    if (filter?.companyId) q = q.eq("company_id", filter.companyId);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

type ContractRow = Awaited<ReturnType<typeof fetchContracts>>[number];

export function toContractInput(row: ContractRow): ContractInput {
  return {
    signingDate: row.signing_date,
    billingLagMonths: row.type?.billing_lag_months ?? 0,
    durationMonths: row.duration_months,
    installment: Number(row.installment),
    residualValue: row.residual_value === null ? null : Number(row.residual_value),
    purchaseValue: Number(row.purchase_value),
    expoAdjustment: Number(row.expo_adjustment),
    cancelDate: row.cancel_date,
    settlementAmount: row.settlement_amount === null ? null : Number(row.settlement_amount),
    residualWaived: row.residual_waived,
    amortizeOverRealLife: row.amortize_over_real_life,
  };
}

export interface ContractWithSchedule {
  row: ContractRow;
  schedule: ContractSchedule;
  outstanding: number;
}

/**
 * Every contract of the loan book with its schedule, computed as of `asOf`.
 * Drafts (not yet signed) are excluded from the portfolio by default.
 */
export async function loadLoanBook({ asOf = new Date(), includeDrafts = false, companyId }: { asOf?: Date; includeDrafts?: boolean; companyId?: string } = {}) {
  const rows = await fetchContracts({ companyId });
  const key = monthKeyOfDate(asOf);
  return rows
    .filter((r) => includeDrafts || r.workflow_status === "signed")
    .map((row): ContractWithSchedule => {
      const schedule = buildSchedule(toContractInput(row), asOf);
      return { row, schedule, outstanding: principalOutstandingAt(schedule, key) ?? 0 };
    });
}

export async function getContract(id: string) {
  const { data, error } = await db().from("contracts").select(CONTRACT_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPipeline() {
  const { data, error } = await db()
    .from("contracts")
    .select("id, contract_number, workflow_status, purchase_value, created_at, company:companies ( name )")
    .in("workflow_status", ["draft", "pending_signature"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data;
}

type FullContract = NonNullable<Awaited<ReturnType<typeof getContract>>>;

/**
 * Everything the Word contract needs, from the contract's frozen snapshot and
 * its SEPA mandate. Null for contracts without them (e.g. imported from the
 * Borrowing Base), which have no draft to generate.
 */
export function draftSourceFromContract(c: FullContract): ContractDraftSource | null {
  const m = c.mandate;
  if (!m || !c.client_name || !c.client_cif || !c.fiscal_address || !c.fiscal_postal_code || !c.fiscal_city
    || !c.signatory_name || !c.signatory_nif || !c.contact_name || !c.contact_email || !c.product_description) {
    return null;
  }
  return {
    contractNumber: c.contract_number,
    clientName: c.client_name,
    clientCif: c.client_cif,
    fiscalAddress: c.fiscal_address,
    fiscalPostalCode: c.fiscal_postal_code,
    fiscalCity: c.fiscal_city,
    fiscalProvince: c.fiscal_province,
    signatoryName: c.signatory_name,
    signatoryNif: c.signatory_nif,
    signatoryAddress: c.signatory_address,
    contactName: c.contact_name,
    contactPhone: c.contact_phone,
    contactEmail: c.contact_email,
    deliverySameAsFiscal: c.delivery_same_as_fiscal,
    deliveryAddress: c.delivery_address,
    productDescription: c.product_description,
    durationMonths: c.duration_months,
    installment: Number(c.installment),
    hasGuarantor: c.has_guarantor,
    guarantorName: c.guarantor_name,
    guarantorNif: c.guarantor_nif,
    guarantorAddress: c.guarantor_address,
    guarantorRepresentative: c.guarantor_representative,
    guarantorRepresentativeNif: c.guarantor_representative_nif,
    sepa: {
      debtorName: m.debtor_name,
      debtorAddress: m.debtor_address ?? c.fiscal_address,
      debtorPostalCode: m.debtor_postal_code ?? c.fiscal_postal_code,
      debtorCity: m.debtor_city ?? c.fiscal_city,
      debtorProvince: m.debtor_province,
      iban: m.iban,
      signedPlace: m.signed_place,
      signedAt: m.signed_at,
    },
  };
}

/** The attachments stored for a contract (metadata only; the files stay in the private bucket). */
export async function listAttachments(contractId: string): Promise<StoredAttachment[]> {
  const { data, error } = await db()
    .from("contract_attachments")
    .select("kind, file_name, mime_type, size_bytes, storage_path")
    .eq("contract_id", contractId);
  if (error) throw error;
  return data;
}

export async function findAttachment(contractId: string, kind: AttachmentKind) {
  const { data, error } = await db()
    .from("contract_attachments")
    .select("kind, file_name, mime_type, size_bytes, storage_path, contract:contracts ( contract_number )")
    .eq("contract_id", contractId)
    .eq("kind", kind)
    .maybeSingle();
  if (error) throw error;
  if (!data?.contract) return null;
  const { contract, ...attachment } = data;
  return { contractNumber: contract.contract_number, attachment };
}

export async function downloadAttachment(storagePath: string): Promise<Blob | null> {
  const { data, error } = await db().storage.from(ATTACHMENT_BUCKET).download(storagePath);
  return error ? null : data;
}
