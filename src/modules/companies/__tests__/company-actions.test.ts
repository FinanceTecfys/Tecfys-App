import { beforeEach, describe, expect, it, vi } from "vitest";

/** decideCompanyChange: who may call it, what it sends to decide_company_change, how it reads the answer. */
const state = vi.hoisted(() => ({
  capabilities: [] as string[],
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  answer: "applied" as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace?: string) => Object.assign((key: string) => (namespace ? `${namespace}.${key}` : key), { has: () => true }),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireRole: vi.fn(async (capability: string) => {
    state.capabilities.push(capability);
    return { id: "user-admin", role: "admin", partnerDistributorId: null };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  db: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      return { data: state.answer, error: null };
    },
  }),
}));

import { decideCompanyChange } from "../actions";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

beforeEach(() => {
  state.capabilities = [];
  state.calls = [];
  state.answer = "applied";
});

describe("decideCompanyChange", () => {
  it("needs companyChanges.review and records the actor", async () => {
    expect(await decideCompanyChange({ id: ID, approve: true })).toEqual({ ok: true, status: "applied" });
    expect(state.capabilities).toEqual(["companyChanges.review"]);
    expect(state.calls).toEqual([{ fn: "decide_company_change", args: { p_change_id: ID, p_approve: true, p_actor: "user-admin" } }]);
  });

  it("rejects", async () => {
    state.answer = "rejected";
    expect(await decideCompanyChange({ id: ID, approve: false })).toEqual({ ok: true, status: "rejected" });
    expect(state.calls[0].args.p_approve).toBe(false);
  });

  it("reports a change already decided or missing, and never calls the database for a bad id", async () => {
    state.answer = "not_pending";
    expect(await decideCompanyChange({ id: ID, approve: true })).toEqual({ ok: false, error: "companies.review.errors.alreadyDecided" });
    state.answer = "not_found";
    expect(await decideCompanyChange({ id: ID, approve: true })).toEqual({ ok: false, error: "companies.review.errors.notFound" });
    state.calls = [];
    expect(await decideCompanyChange({ id: "x' or 1=1", approve: true })).toEqual({ ok: false, error: "companies.review.errors.notFound" });
    expect(state.calls).toEqual([]);
  });
});
