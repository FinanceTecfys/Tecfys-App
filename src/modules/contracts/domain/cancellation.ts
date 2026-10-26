/**
 * Cancellation of a contract: cancel date + additional status (+ the amount
 * collected to settle it). Pure logic shared by the edit form and the server
 * action; the resulting fields feed the existing schedule engine, which is
 * what recomputes the loan book and the portfolio.
 *
 * Conventions taken from the Borrowing Base (changes_rationale):
 *  - The cancel date shortens the payment horizon; the unrecovered principal
 *    is written off as default in the cancellation month (item 17).
 *  - Gesico (handed to the collection agency): the residual month is not
 *    booked at all, so the whole outstanding principal defaults (item 16).
 *  - An early cancellation paid off is booked as a settlement in the month
 *    after the last rent: principal up to the outstanding balance, the rest
 *    interest. The workbook types that figure over the residual (item 15).
 *
 * `allowsSettlement` follows the workbook's own data: the median residual is
 * ~1 instalment for FC / CAT / B2C / Gesico (a token purchase option) but 16.5
 * for CAP, 12.0 for CAC, 15.7 for CS and 9.1 for "Cancelacion parcial", i.e. a
 * negotiated payoff of the rents still to run.
 */
import { z } from "zod";

export interface AdditionalStatusDefinition {
  /** The value stored on the contract, as the Loan book writes it. */
  code: string;
  /** Its name and description in the catalogue: contract.additionalStatuses.<key>.{label,description}. */
  key: "fc" | "gesico" | "cap" | "cac" | "capClaim" | "cs" | "partial" | "cat" | "catClaim" | "b2c" | "nictonCobro";
  /** Gesico: the residual / settlement month is never booked. */
  waivesResidual: boolean;
  /** Early cancellation where an amount is collected to close the contract. */
  allowsSettlement: boolean;
  /** Values that only exist in the imported book, kept so they can be preserved. */
  legacy?: boolean;
}

// The codes are data: the values the Loan book stores, kept verbatim (accents and all) so they match on import.
/* i18n-exempt-start: stored loan-book status codes */
export const ADDITIONAL_STATUSES: AdditionalStatusDefinition[] = [
  { code: "FC", key: "fc", waivesResidual: false, allowsSettlement: false },
  { code: "Gesico", key: "gesico", waivesResidual: true, allowsSettlement: false },
  { code: "CAP", key: "cap", waivesResidual: false, allowsSettlement: true },
  { code: "CAC", key: "cac", waivesResidual: false, allowsSettlement: true },
  { code: "CAP (Reclamación)", key: "capClaim", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "CS", key: "cs", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "Cancelacion parcial", key: "partial", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "CAT", key: "cat", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "CAT (Reclamación)", key: "catClaim", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "B2C", key: "b2c", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "Nicton Cobro", key: "nictonCobro", waivesResidual: false, allowsSettlement: false, legacy: true },
];

/* i18n-exempt-end */

const BY_CODE = new Map(ADDITIONAL_STATUSES.map((s) => [s.code.toLowerCase(), s]));

/** Case-insensitive lookup, as the workbook compares text. */
export const findStatus = (code: string | null | undefined): AdditionalStatusDefinition | null =>
  code ? BY_CODE.get(code.trim().toLowerCase()) ?? null : null;

export const statusAllowsSettlement = (code: string | null | undefined) => findStatus(code)?.allowsSettlement ?? false;
export const statusWaivesResidual = (code: string | null | undefined) => findStatus(code)?.waivesResidual ?? false;

export const cancellationSchema = z
  .object({
    contractId: z.uuid(),
    cancelDate: z.union([z.iso.date(), z.literal("")]).transform((v) => v || null),
    additionalStatus: z.string().trim().transform((v) => v || null),
    settlementAmount: z
      .union([z.number(), z.literal("")])
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
  })
  .superRefine((v, ctx) => {
    if (v.additionalStatus && !v.cancelDate) {
      ctx.addIssue({ code: "custom", path: ["cancelDate"], message: "validation.cancellation.dateForStatus" });
    }
    if (v.additionalStatus && !findStatus(v.additionalStatus)) {
      ctx.addIssue({ code: "custom", path: ["additionalStatus"], message: "validation.cancellation.unknownStatus" });
    }
    if (v.settlementAmount !== null) {
      if (v.settlementAmount < 0) {
        ctx.addIssue({ code: "custom", path: ["settlementAmount"], message: "validation.cancellation.notNegative" });
      }
      if (!statusAllowsSettlement(v.additionalStatus)) {
        ctx.addIssue({ code: "custom", path: ["settlementAmount"], message: "validation.cancellation.noSettlement" });
      }
    }
  });

export type CancellationInput = z.input<typeof cancellationSchema>;

export interface CancellationFields {
  cancel_date: string | null;
  additional_status: string | null;
  settlement_amount: number | null;
  residual_waived: boolean;
}

/**
 * Contract columns for a validated cancellation. Clearing the cancel date
 * clears the status, the settlement and the residual waiver, so the contract
 * goes back to running its contractual term.
 */
export function resolveCancellation(input: z.output<typeof cancellationSchema>): CancellationFields {
  if (!input.cancelDate) {
    return { cancel_date: null, additional_status: null, settlement_amount: null, residual_waived: false };
  }
  const status = findStatus(input.additionalStatus);
  return {
    cancel_date: input.cancelDate,
    additional_status: status?.code ?? null,
    settlement_amount: status?.allowsSettlement ? input.settlementAmount : null,
    residual_waived: status?.waivesResidual ?? false,
  };
}
