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

// Every label, hint and state name below is a key of the message catalogue; the stepper translates them.
export const LIFECYCLE_STEPS = [
  { key: "scoring", label: "contract.lifecycleSteps.scoring" },
  { key: "operation", label: "contract.lifecycleSteps.operation" },
  { key: "signature", label: "contract.lifecycleSteps.signature" },
  { key: "signed", label: "contract.lifecycleSteps.signed" },
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

const SIGNATURE_FUTURE = "pipeline.lifecycle.hints.signatureFuture";

export function lifecycleOf({ scoringStatus, contract }: LifecycleInput): Lifecycle {
  const state: Record<StepKey, StepState> = { scoring: "pending", operation: "pending", signature: "unavailable", signed: "pending" };
  const hint: Record<StepKey, string> = {
    scoring: "pipeline.lifecycle.hints.noScoring",
    operation: "pipeline.lifecycle.hints.operationNotCreated",
    signature: SIGNATURE_FUTURE,
    signed: "pipeline.lifecycle.hints.pendingSignature",
  };
  let stage: StepKey = "scoring";
  let outcome: LifecycleOutcome = "in_progress";
  let label: string;

  if (!contract) {
    if (scoringStatus === "rejected") {
      state.scoring = "stopped";
      hint.scoring = "pipeline.lifecycle.hints.scoringRejected";
      hint.operation = "pipeline.lifecycle.hints.naScoringRejected";
      hint.signed = "pipeline.lifecycle.hints.naScoringRejected";
      outcome = "rejected";
      label = "pipeline.lifecycle.labels.rejected";
    } else if (scoringStatus === "approved") {
      state.scoring = "current";
      hint.scoring = "pipeline.lifecycle.hints.scoringApproved";
      label = "pipeline.lifecycle.labels.approvedNoOperation";
    } else if (scoringStatus === "pending_review") {
      state.scoring = "current";
      hint.scoring = "pipeline.lifecycle.hints.scoringPendingReview";
      label = "pipeline.lifecycle.labels.pendingReview";
    } else {
      // No scoring and no contract: nothing has happened yet.
      label = "pipeline.lifecycle.labels.notStarted";
    }
    return build(state, hint, stage, outcome, label);
  }

  // A contract exists: the scoring stage is behind it, or was never recorded here.
  if (scoringStatus === null) {
    state.scoring = "unavailable";
    hint.scoring = "pipeline.lifecycle.hints.importedNoScoring";
  } else {
    state.scoring = "done";
    hint.scoring = "pipeline.lifecycle.hints.scoringDone";
  }

  const sentToSignature = contract.hasSignatureRequest === true;
  switch (contract.workflowStatus) {
    case "signed":
      state.operation = "done";
      hint.operation = "pipeline.lifecycle.hints.operationCreated";
      if (sentToSignature) {
        state.signature = "done";
        hint.signature = "pipeline.lifecycle.hints.sentToSignature";
      } else {
        hint.signature = "pipeline.lifecycle.hints.signedOutside";
      }
      state.signed = "done";
      hint.signed = "pipeline.lifecycle.hints.contractSigned";
      stage = "signed";
      outcome = "completed";
      label = "pipeline.lifecycle.labels.signed";
      break;
    case "pending_signature":
      state.operation = "done";
      hint.operation = "pipeline.lifecycle.hints.operationCreated";
      state.signature = "current";
      hint.signature = "pipeline.lifecycle.hints.awaitingClient";
      stage = "signature";
      label = "pipeline.lifecycle.labels.sentToSignature";
      break;
    case "cancelled":
      state.operation = "stopped";
      hint.operation = "pipeline.lifecycle.hints.operationCancelled";
      hint.signed = "pipeline.lifecycle.hints.naOperationCancelled";
      if (sentToSignature) {
        state.signature = "done";
        hint.signature = "pipeline.lifecycle.hints.sentBeforeCancel";
      }
      stage = "operation";
      outcome = "cancelled";
      label = "pipeline.lifecycle.labels.cancelled";
      break;
    default:
      // "draft", and any status this code does not know yet: the operation exists and nothing after it is proven.
      state.operation = "current";
      hint.operation = "pipeline.lifecycle.hints.draftCreated";
      stage = "operation";
      label = "pipeline.lifecycle.labels.draft";
  }
  return build(state, hint, stage, outcome, label);
}

function build(state: Record<StepKey, StepState>, hint: Record<StepKey, string>, stage: StepKey, outcome: LifecycleOutcome, label: string): Lifecycle {
  return { steps: LIFECYCLE_STEPS.map(({ key, label: stepLabel }) => ({ key, label: stepLabel, state: state[key], hint: hint[key] })), stage, outcome, label };
}

export const STEP_STATE_LABELS: Record<StepState, string> = {
  done: "pipeline.lifecycle.states.done",
  current: "pipeline.lifecycle.states.current",
  pending: "pipeline.lifecycle.states.pending",
  unavailable: "pipeline.lifecycle.states.unavailable",
  stopped: "pipeline.lifecycle.states.stopped",
};

/** Share of the bar that is filled: steps the deal has reached, out of all of them. */
export function lifecycleProgress(lifecycle: Lifecycle): number {
  const index = LIFECYCLE_STEPS.findIndex((s) => s.key === lifecycle.stage);
  const reached = lifecycle.steps.some((s) => s.state === "done" || s.state === "current" || s.state === "stopped");
  return reached ? index / (LIFECYCLE_STEPS.length - 1) : 0;
}
