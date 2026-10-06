import { describe, expect, it } from "vitest";
import { LIFECYCLE_STEPS, lifecycleOf, lifecycleProgress, STEP_STATE_LABELS, type StepKey, type StepState } from "../lifecycle";

const states = (l: ReturnType<typeof lifecycleOf>) => Object.fromEntries(l.steps.map((s) => [s.key, s.state])) as Record<StepKey, StepState>;
const contract = (workflowStatus: string, hasSignatureRequest = false) => ({ workflowStatus, hasSignatureRequest });

describe("lifecycle steps", () => {
  it("are the four stages the data models, in order", () => {
    expect(LIFECYCLE_STEPS.map((s) => s.key)).toEqual(["scoring", "operation", "signature", "signed"]);
    const l = lifecycleOf({ scoringStatus: "approved", contract: null });
    expect(l.steps.map((s) => s.key)).toEqual(["scoring", "operation", "signature", "signed"]);
    for (const s of l.steps) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.hint.length).toBeGreaterThan(0);
      expect(STEP_STATE_LABELS[s.state]).toBeDefined();
    }
  });
});

describe("scoring only (no operation yet)", () => {
  it("pending manual review: at scoring, nothing else reached", () => {
    const l = lifecycleOf({ scoringStatus: "pending_review", contract: null });
    expect(l.stage).toBe("scoring");
    expect(l.outcome).toBe("in_progress");
    expect(l.label).toBe("Pendiente de revisión");
    expect(states(l)).toEqual({ scoring: "current", operation: "pending", signature: "unavailable", signed: "pending" });
  });

  it("approved: still at scoring, waiting for the operation", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: null });
    expect(l.stage).toBe("scoring");
    expect(l.outcome).toBe("in_progress");
    expect(l.label).toBe("Aprobado · sin operación");
    expect(states(l)).toEqual({ scoring: "current", operation: "pending", signature: "unavailable", signed: "pending" });
    expect(l.steps[0].hint).toMatch(/falta crear la operación/);
  });

  it("rejected: the deal stops at scoring", () => {
    const l = lifecycleOf({ scoringStatus: "rejected", contract: null });
    expect(l.stage).toBe("scoring");
    expect(l.outcome).toBe("rejected");
    expect(l.label).toBe("Rechazado");
    expect(states(l)).toEqual({ scoring: "stopped", operation: "pending", signature: "unavailable", signed: "pending" });
  });
});

describe("operation created", () => {
  it("draft: at the operation stage, signing still ahead", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("draft") });
    expect(l.stage).toBe("operation");
    expect(l.outcome).toBe("in_progress");
    expect(l.label).toBe("Borrador · pendiente de firma");
    expect(states(l)).toEqual({ scoring: "done", operation: "current", signature: "unavailable", signed: "pending" });
  });

  it("pending_signature: at the signature stage (only when the data says so)", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("pending_signature", true) });
    expect(l.stage).toBe("signature");
    expect(l.outcome).toBe("in_progress");
    expect(states(l)).toEqual({ scoring: "done", operation: "done", signature: "current", signed: "pending" });
  });

  it("signed by hand (no signature request): in the loan book, and the signature step is NOT shown as done", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("signed") });
    expect(l.stage).toBe("signed");
    expect(l.outcome).toBe("completed");
    expect(l.label).toBe("Firmado · en loan book");
    expect(states(l)).toEqual({ scoring: "done", operation: "done", signature: "unavailable", signed: "done" });
    expect(l.steps[2].hint).toMatch(/fuera de la plataforma/);
  });

  it("signed after a real signature request: every step done", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("signed", true) });
    expect(states(l)).toEqual({ scoring: "done", operation: "done", signature: "done", signed: "done" });
    expect(l.outcome).toBe("completed");
  });

  it("cancelled: the deal stops at the operation", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("cancelled") });
    expect(l.stage).toBe("operation");
    expect(l.outcome).toBe("cancelled");
    expect(l.label).toBe("Anulado");
    expect(states(l)).toEqual({ scoring: "done", operation: "stopped", signature: "unavailable", signed: "pending" });
    expect(states(lifecycleOf({ scoringStatus: "approved", contract: contract("cancelled", true) })).signature).toBe("done");
  });
});

describe("edge cases", () => {
  it("never invents a signature: a draft with no request keeps the step unavailable", () => {
    for (const status of ["draft", "signed", "cancelled"]) {
      expect(states(lifecycleOf({ scoringStatus: "approved", contract: contract(status) })).signature, status).toBe("unavailable");
      expect(states(lifecycleOf({ scoringStatus: "approved", contract: { workflowStatus: status } })).signature, status).toBe("unavailable");
    }
  });

  it("an imported loan-book contract has no scoring: that step is unavailable, the rest follows the contract", () => {
    const l = lifecycleOf({ scoringStatus: null, contract: contract("signed") });
    expect(states(l)).toEqual({ scoring: "unavailable", operation: "done", signature: "unavailable", signed: "done" });
    expect(l.stage).toBe("signed");
    expect(l.outcome).toBe("completed");
    expect(l.steps[0].hint).toMatch(/importado/);
  });

  it("the contract decides once it exists, whatever the scoring says now", () => {
    for (const scoringStatus of ["approved", "pending_review", "rejected", "something-new"]) {
      const l = lifecycleOf({ scoringStatus, contract: contract("signed") });
      expect(l.stage, scoringStatus).toBe("signed");
      expect(states(l).scoring, scoringStatus).toBe("done");
      expect(l.outcome, scoringStatus).toBe("completed");
    }
  });

  it("an unknown workflow status is treated as a draft: nothing after the operation is assumed", () => {
    const l = lifecycleOf({ scoringStatus: "approved", contract: contract("archived") });
    expect(l.stage).toBe("operation");
    expect(states(l)).toEqual({ scoring: "done", operation: "current", signature: "unavailable", signed: "pending" });
  });

  it("an unknown scoring status with no contract does not crash and claims nothing", () => {
    for (const scoringStatus of [null, "", "something-new"]) {
      const l = lifecycleOf({ scoringStatus, contract: null });
      expect(l.stage).toBe("scoring");
      expect(l.outcome).toBe("in_progress");
      expect(states(l)).toEqual({ scoring: "pending", operation: "pending", signature: "unavailable", signed: "pending" });
      expect(lifecycleProgress(l)).toBe(0);
    }
  });

  it("at most one step is current, and nothing is done after a pending step except a recorded signature", () => {
    const inputs = [null, "approved", "pending_review", "rejected"].flatMap((scoringStatus) =>
      [null, contract("draft"), contract("pending_signature", true), contract("signed"), contract("signed", true), contract("cancelled")].map((c) => ({ scoringStatus, contract: c })),
    );
    for (const input of inputs) {
      const l = lifecycleOf(input);
      const s = l.steps.map((x) => x.state);
      expect(s.filter((x) => x === "current").length, JSON.stringify(input)).toBeLessThanOrEqual(1);
      expect(s.filter((x) => x === "stopped").length, JSON.stringify(input)).toBeLessThanOrEqual(1);
      const stageIndex = l.steps.findIndex((x) => x.key === l.stage);
      for (const after of l.steps.slice(stageIndex + 1)) expect(["pending", "unavailable"], JSON.stringify(input)).toContain(after.state);
    }
  });
});

describe("lifecycleProgress", () => {
  it("fills the bar up to the stage reached", () => {
    expect(lifecycleProgress(lifecycleOf({ scoringStatus: "pending_review", contract: null }))).toBe(0);
    expect(lifecycleProgress(lifecycleOf({ scoringStatus: "approved", contract: contract("draft") }))).toBeCloseTo(1 / 3);
    expect(lifecycleProgress(lifecycleOf({ scoringStatus: "approved", contract: contract("pending_signature") }))).toBeCloseTo(2 / 3);
    expect(lifecycleProgress(lifecycleOf({ scoringStatus: "approved", contract: contract("signed") }))).toBe(1);
  });
});
