/**
 * Contract -> Word template data (templates/contract-template.docx).
 *
 * Pure mapping, no I/O: the tag names below are the ones inserted by
 * scripts/build-contract-template.ts and documented in templates/README.md.
 */
import { formatIban } from "./sepa";

export interface ContractDraftSource {
  contractNumber: string;
  clientName: string;
  clientCif: string;
  fiscalAddress: string;
  fiscalPostalCode: string;
  fiscalCity: string;
  fiscalProvince: string | null;
  signatoryName: string;
  signatoryNif: string;
  signatoryAddress: string | null;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string;
  deliverySameAsFiscal: boolean;
  deliveryAddress: string | null;
  productDescription: string;
  durationMonths: number;
  installment: number;
  hasGuarantor: boolean;
  guarantorName: string | null;
  guarantorNif: string | null;
  guarantorAddress: string | null;
  guarantorRepresentative: string | null;
  guarantorRepresentativeNif: string | null;
  sepa: {
    debtorName: string;
    debtorAddress: string;
    debtorPostalCode: string;
    debtorCity: string;
    debtorProvince: string | null;
    iban: string;
    signedPlace: string | null;
    signedAt: string | null; // ISO date
  };
}

export interface ContractTemplateData {
  contract_number: string;
  client_name: string;
  client_cif: string;
  client_fiscal_address: string;
  signatory_name: string;
  signatory_nif: string;
  signatory_address: string;
  has_guarantor: boolean;
  guarantor_name: string;
  guarantor_nif: string;
  guarantor_address: string;
  guarantor_representative: string;
  guarantor_representative_nif: string;
  product_description: string;
  duration_months: string;
  installment: string;
  delivery_address: string;
  sepa_debtor_name: string;
  sepa_debtor_street: string;
  sepa_debtor_postal_code: string;
  sepa_debtor_city: string;
  sepa_iban: string;
  sepa_date: string;
  sepa_place: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
}

/** Every tag the template uses, for the build script and the render test. */
export const CONTRACT_TEMPLATE_TAGS = [
  "contract_number", "client_name", "client_cif", "client_fiscal_address", "signatory_name", "signatory_nif",
  "signatory_address", "has_guarantor", "guarantor_name", "guarantor_nif", "guarantor_address",
  "guarantor_representative", "guarantor_representative_nif", "product_description", "duration_months",
  "installment", "delivery_address", "sepa_debtor_name", "sepa_debtor_street", "sepa_debtor_postal_code",
  "sepa_debtor_city", "sepa_iban", "sepa_date", "sepa_place", "contact_name", "contact_phone", "contact_email",
] as const satisfies readonly (keyof ContractTemplateData)[];

/** "1.234,56" - Spanish format, thousands separator even for 4-digit amounts. */
const money = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

/** "2026-10-01" -> "01/10/2026". */
export const formatDateEs = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** "08006 Barcelona (Barcelona)"; the province is dropped when it repeats the city. */
export function cityLine(postalCode: string, city: string, province: string | null): string {
  const withProvince = province && province.trim().toLowerCase() !== city.trim().toLowerCase() ? `${city} (${province})` : city;
  return [postalCode, withProvince].filter(Boolean).join(" ");
}

/**
 * The template prints a literal "domicilio fiscal en Calle ..."; drop a leading
 * "Calle" / "C/" / "Cl." so the address does not read "Calle C/ Mayor".
 */
export const stripLeadingCalle = (street: string) => street.replace(/^\s*(?:calle|c\/|cl\.?|c\.)\s*/i, "").trim();

export function buildContractTemplateData(src: ContractDraftSource): ContractTemplateData {
  const fiscalFull = `${stripLeadingCalle(src.fiscalAddress)}, ${cityLine(src.fiscalPostalCode, src.fiscalCity, src.fiscalProvince)}`;
  const deliveryFull = src.deliverySameAsFiscal || !src.deliveryAddress?.trim()
    ? `${src.fiscalAddress}, ${cityLine(src.fiscalPostalCode, src.fiscalCity, src.fiscalProvince)}`
    : src.deliveryAddress.trim();

  return {
    contract_number: src.contractNumber,
    client_name: src.clientName,
    client_cif: src.clientCif,
    client_fiscal_address: fiscalFull,
    signatory_name: src.signatoryName,
    signatory_nif: src.signatoryNif,
    signatory_address: src.signatoryAddress?.trim() ?? "",
    has_guarantor: src.hasGuarantor,
    guarantor_name: src.guarantorName ?? "",
    guarantor_nif: src.guarantorNif ?? "",
    guarantor_address: src.guarantorAddress ?? "",
    guarantor_representative: src.guarantorRepresentative?.trim() ?? "",
    guarantor_representative_nif: src.guarantorRepresentativeNif ?? "",
    product_description: src.productDescription,
    duration_months: String(src.durationMonths),
    installment: money.format(src.installment),
    delivery_address: deliveryFull,
    sepa_debtor_name: src.sepa.debtorName,
    sepa_debtor_street: src.sepa.debtorAddress,
    sepa_debtor_postal_code: src.sepa.debtorPostalCode,
    sepa_debtor_city: src.sepa.debtorProvince && src.sepa.debtorProvince.trim().toLowerCase() !== src.sepa.debtorCity.trim().toLowerCase()
      ? `${src.sepa.debtorCity} (${src.sepa.debtorProvince})`
      : src.sepa.debtorCity,
    sepa_iban: formatIban(src.sepa.iban),
    sepa_date: src.sepa.signedAt ? formatDateEs(src.sepa.signedAt) : "",
    sepa_place: src.sepa.signedPlace ?? "",
    contact_name: src.contactName,
    contact_phone: src.contactPhone ?? "",
    contact_email: src.contactEmail,
  };
}
