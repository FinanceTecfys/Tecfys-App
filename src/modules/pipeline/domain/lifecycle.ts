/**
 * Where a deal is in its lifecycle, derived ONLY from data that already
 * exists: the scoring's status and the contract's workflow status (plus
 * whether a signature request row exists). Pure, so the progress bar cannot
 * drift from reality: it renders exactly what lifecycleOf() returns.
 *
 * Stages, as the data models them today:
 *   scoring    a scoring exists (pending review, approved or rejected)
 *   operation  the operation was created, which IS the draft contract
 *   signature  sent to e-signature: contract "pending_signature" or a
 *              signature_requests row. Signaturit is not built yet, so nothing
 *              reaches this stage today; it is shown as "unavailable", never
 *              as done, unless the data really says so
 *   signed     contract signed = in the loan book
 */

export const LIFECYCLE_STEPS = [
  { key: "scoring", label: "Scoring" },
  { key: "operation", label: "Operación (borrador)" },
  { key: "signature", label: "Enviado a firma" },
  { key: "signed", label: "Firmado · loan book" },
] as const;

export type StepKey = (typeof LIFECYCLE_STEPS)[number]["key"];

/**
 * done         reached and left behind
 * current      where the deal is now
 * pending      not reached yet
 * unavailable  a stage the platform cannot record yet (or has no data for)
 * stopped      the deal ended here (scoring rejected, contract cancelled)
 */
export type StepState = "done" | "current" | "pending" | "unavailable" | "stopped";

export type LifecycleOutcome = "in_progress" | "completed" | "rejected" | "cancelled";

export interface LifecycleStep {
  key: StepKey;
  label: string;
  state: StepState;
  /** One line explaining the state, for the tooltip. */
  hint: string;
}

export interface Lifecycle {
  steps: LifecycleStep[];
  /** The stage the deal is at (the last one it reached). */
  stage: StepKey;
  outcome: LifecycleOutcome;
  /** Short status for a table cell. */
  label: string;
}

export interface LifecycleInput {
  /** scorings.status; null when the contract has no scoring in the platform (imported loan book). */
  scoringStatus: string | null;
  /** The contract born from the scoring; null while there is only a scoring. */
  contract: { workflowStatus: string; hasSignatureRequest?: boolean } | null;
}

const SIGNATURE_FUTURE = "La firma electrónica (Signaturit) aún no está integrada";

export function lifecycleOf({ scoringStatus, contract }: LifecycleInput): Lifecycle {
  const state: Record<StepKey, StepState> = { scoring: "pending", operation: "pending", signature: "unavailable", signed: "pending" };
  const hint: Record<StepKey, string> = {
    scoring: "Sin scoring",
    operation: "Operación aún no creada",
    signature: SIGNATURE_FUTURE,
    signed: "Pendiente de firma",
  };
  let stage: StepKey = "scoring";
  let outcome: LifecycleOutcome = "in_progress";
  let label: string;

  if (!contract) {
    if (scoringStatus === "rejected") {
      state.scoring = "stopped";
      hint.scoring = "Scoring rechazado: no se puede originar la operación";
      hint.operation = "No aplica: scoring rechazado";
      hint.signed = "No aplica: scoring rechazado";
      outcome = "rejected";
      label = "Rechazado";
    } else if (scoringStatus === "approved") {
      state.scoring = "current";
      hint.scoring = "Scoring aprobado: falta crear la operación";
      label = "Aprobado · sin operación";
    } else if (scoringStatus === "pending_review") {
      state.scoring = "current";
      hint.scoring = "Scoring pendiente de revisión manual";
      label = "Pendiente de revisión";
    } else {
      // No scoring and no contract: nothing has happened yet.
      label = "Sin iniciar";
    }
    return build(state, hint, stage, outcome, label);
  }

  // A contract exists: the scoring stage is behind it, or was never recorded here.
  if (scoringStatus === null) {
    state.scoring = "unavailable";
    hint.scoring = "Sin scoring en la plataforma (contrato importado)";
  } else {
    state.scoring = "done";
    hint.scoring = "Scoring realizado";
  }

  const sentToSignature = contract.hasSignatureRequest === true;
  switch (contract.workflowStatus) {
    case "signed":
      state.operation = "done";
      hint.operation = "Operación creada";
      if (sentToSignature) {
        state.signature = "done";
        hint.signature = "Enviado a firma electrónica";
      } else {
        hint.signature = "Firmado fuera de la plataforma (sin envío a firma electrónica)";
      }
      state.signed = "done";
      hint.signed = "Contrato firmado: en el loan book";
      stage = "signed";
      outcome = "completed";
      label = "Firmado · en loan book";
      break;
    case "pending_signature":
      state.operation = "done";
      hint.operation = "Operación creada";
      state.signature = "current";
      hint.signature = "Enviado a firma: pendiente de que firme el cliente";
      stage = "signature";
      label = "Enviado a firma";
      break;
    case "cancelled":
      state.operation = "stopped";
      hint.operation = "Operación anulada";
      hint.signed = "No aplica: operación anulada";
      if (sentToSignature) {
        state.signature = "done";
        hint.signature = "Se envió a firma electrónica antes de anularse";
      }
      stage = "operation";
      outcome = "cancelled";
      label = "Anulado";
      break;
    default:
      // "draft", and any status this code does not know yet: the operation exists and nothing after it is proven.
      state.operation = "current";
      hint.operation = "Borrador creado: pendiente de firma";
      stage = "operation";
      label = "Borrador · pendiente de firma";
  }
  return build(state, hint, stage, outcome, label);
}

function build(state: Record<StepKey, StepState>, hint: Record<StepKey, string>, stage: StepKey, outcome: LifecycleOutcome, label: string): Lifecycle {
  return { steps: LIFECYCLE_STEPS.map(({ key, label: stepLabel }) => ({ key, label: stepLabel, state: state[key], hint: hint[key] })), stage, outcome, label };
}

export const STEP_STATE_LABELS: Record<StepState, string> = {
  done: "Completado",
  current: "En curso",
  pending: "Pendiente",
  unavailable: "No disponible",
  stopped: "Detenido",
};

/** Share of the bar that is filled: steps the deal has reached, out of all of them. */
export function lifecycleProgress(lifecycle: Lifecycle): number {
  const index = LIFECYCLE_STEPS.findIndex((s) => s.key === lifecycle.stage);
  const reached = lifecycle.steps.some((s) => s.state === "done" || s.state === "current" || s.state === "stopped");
  return reached ? index / (LIFECYCLE_STEPS.length - 1) : 0;
}
