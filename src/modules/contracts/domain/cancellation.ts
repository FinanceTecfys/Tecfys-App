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
  code: string;
  label: string;
  description: string;
  /** Gesico: the residual / settlement month is never booked. */
  waivesResidual: boolean;
  /** Early cancellation where an amount is collected to close the contract. */
  allowsSettlement: boolean;
  /** Values that only exist in the imported book, kept so they can be preserved. */
  legacy?: boolean;
}

export const ADDITIONAL_STATUSES: AdditionalStatusDefinition[] = [
  { code: "FC", label: "FC · Finalización de contrato", description: "El contrato llega a término y el cliente ha pagado todas las cuotas.", waivesResidual: false, allowsSettlement: false },
  { code: "Gesico", label: "Gesico · Demanda", description: "Impago (habitualmente DPD+90) reclamado por la agencia: no se cobra el residual y el principal pendiente pasa a default.", waivesResidual: true, allowsSettlement: false },
  { code: "CAP", label: "CAP · Cancelación anticipada partner", description: "El partner avalista liquida el contrato anticipadamente.", waivesResidual: false, allowsSettlement: true },
  { code: "CAC", label: "CAC · Cancelación anticipada cliente", description: "El cliente liquida anticipadamente toda la deuda.", waivesResidual: false, allowsSettlement: true },
  { code: "CAP (Reclamación)", label: "CAP (Reclamación)", description: "Cancelación anticipada por el partner tras reclamación.", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "CS", label: "CS", description: "Valor heredado del Loan book; admite importe de liquidación.", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "Cancelacion parcial", label: "Cancelación parcial", description: "Valor heredado del Loan book; admite importe de liquidación.", waivesResidual: false, allowsSettlement: true, legacy: true },
  { code: "CAT", label: "CAT", description: "Valor heredado del Loan book.", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "CAT (Reclamación)", label: "CAT (Reclamación)", description: "Valor heredado del Loan book.", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "B2C", label: "B2C", description: "Valor heredado del Loan book; excluido del ratio de pérdida en el Summary.", waivesResidual: false, allowsSettlement: false, legacy: true },
  { code: "Nicton Cobro", label: "Nicton Cobro", description: "Valor heredado del Loan book.", waivesResidual: false, allowsSettlement: false, legacy: true },
];

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
      ctx.addIssue({ code: "custom", path: ["cancelDate"], message: "Indica la fecha de cancelación para fijar un estado" });
    }
    if (v.additionalStatus && !findStatus(v.additionalStatus)) {
      ctx.addIssue({ code: "custom", path: ["additionalStatus"], message: "Estado no reconocido" });
    }
    if (v.settlementAmount !== null) {
      if (v.settlementAmount < 0) {
        ctx.addIssue({ code: "custom", path: ["settlementAmount"], message: "No puede ser negativo" });
      }
      if (!statusAllowsSettlement(v.additionalStatus)) {
        ctx.addIssue({ code: "custom", path: ["settlementAmount"], message: "Este estado no admite importe de liquidación" });
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
