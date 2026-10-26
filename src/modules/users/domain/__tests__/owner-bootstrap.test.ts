import { describe, expect, it } from "vitest";
import { planOwnerBootstrap } from "../owner-bootstrap";

const OWNER_ID = "11111111-1111-1111-1111-111111111111";
const confirmed = { id: OWNER_ID, invited_at: "2026-10-01T00:00:00Z", email_confirmed_at: "2026-10-02T00:00:00Z" };
const pending = { id: OWNER_ID, invited_at: "2026-10-01T00:00:00Z", email_confirmed_at: null };

describe("planOwnerBootstrap", () => {
  it("invites the owner on an empty project", () => {
    expect(planOwnerBootstrap({ user: null, profile: null, ownerUserId: null })).toEqual({ kind: "invite" });
  });

  it("writes the profile of an existing user that has none", () => {
    expect(planOwnerBootstrap({ user: confirmed, profile: null, ownerUserId: null })).toEqual({ kind: "create-profile", userId: OWNER_ID });
  });

  it("reactivates an inactive owner profile", () => {
    expect(planOwnerBootstrap({ user: confirmed, profile: { user_id: OWNER_ID, role: "owner", active: false }, ownerUserId: OWNER_ID })).toEqual({
      kind: "activate",
      userId: OWNER_ID,
    });
  });

  it("is a no-op on a second run, and says when the invitation is still pending", () => {
    const profile = { user_id: OWNER_ID, role: "owner" as const, active: true };
    expect(planOwnerBootstrap({ user: confirmed, profile, ownerUserId: OWNER_ID })).toEqual({ kind: "done", userId: OWNER_ID, invitePending: false });
    expect(planOwnerBootstrap({ user: pending, profile, ownerUserId: OWNER_ID })).toEqual({ kind: "done", userId: OWNER_ID, invitePending: true });
  });

  it("never takes the owner role from someone else", () => {
    const other = "22222222-2222-2222-2222-222222222222";
    expect(planOwnerBootstrap({ user: null, profile: null, ownerUserId: other }).kind).toBe("conflict");
    expect(planOwnerBootstrap({ user: confirmed, profile: null, ownerUserId: other }).kind).toBe("conflict");
  });

  it("never changes the role of an existing non-owner profile", () => {
    expect(planOwnerBootstrap({ user: confirmed, profile: { user_id: OWNER_ID, role: "admin", active: true }, ownerUserId: null })).toMatchObject({
      kind: "conflict",
      reason: expect.stringContaining('"admin"'),
    });
  });
});
