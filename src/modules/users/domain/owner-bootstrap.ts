/**
 * First owner of a fresh cloud project (scripts/bootstrap-owner.ts), pure so the
 * decision is unit-tested. Idempotent by construction: it looks at what exists
 * and only does the missing step, so a second run reports "done".
 *
 * The owner is OWNER_EMAIL. Creating its Auth user is enough to give it the owner
 * profile (trigger seed_owner_profile, migration 20260927000000); the profile
 * step only covers a user created before that trigger existed.
 */
import type { Role } from "@/lib/auth/permissions";
import { isInvitePending } from "./rules";

export interface BootstrapAuthUser {
  id: string;
  invited_at?: string | null;
  email_confirmed_at?: string | null;
}

export interface BootstrapProfile {
  user_id: string;
  role: Role;
  active: boolean;
}

export type OwnerBootstrapStep =
  /** No Auth user yet: invite it (the trigger writes the owner profile). */
  | { kind: "invite" }
  /** The Auth user exists without a profile: write the owner profile. */
  | { kind: "create-profile"; userId: string }
  /** The owner profile exists but is inactive: reactivate it. */
  | { kind: "activate"; userId: string }
  /** Nothing to do. `invitePending`: the owner has not set a password yet. */
  | { kind: "done"; userId: string; invitePending: boolean }
  /** A state the script must not "fix" on its own; a human decides. */
  | { kind: "conflict"; reason: string };

export function planOwnerBootstrap(input: {
  /** The Auth user with OWNER_EMAIL, if any. */
  user: BootstrapAuthUser | null;
  /** That user's profile, if any. */
  profile: BootstrapProfile | null;
  /** The user id holding the owner role today, if any. */
  ownerUserId: string | null;
}): OwnerBootstrapStep {
  const { user, profile, ownerUserId } = input;
  if (ownerUserId && ownerUserId !== user?.id) {
    return { kind: "conflict", reason: `another user (${ownerUserId}) already holds the owner role` };
  }
  if (!user) return { kind: "invite" };
  if (!profile) return { kind: "create-profile", userId: user.id };
  if (profile.role !== "owner") {
    return { kind: "conflict", reason: `the user exists with role "${profile.role}"; change it by hand if it really must become the owner` };
  }
  if (!profile.active) return { kind: "activate", userId: user.id };
  return { kind: "done", userId: user.id, invitePending: isInvitePending(user) };
}
