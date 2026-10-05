/**
 * Ownership scoping, pure so it is unit-tested: which records a user may reach.
 * Tecfys roles see everything; a partner only the scorings and operations it
 * created. The data layer applies it (a list filter and a per-record check),
 * so a guessed id outside the scope reads as not found.
 */
import { can, type Role } from "./permissions";

export type DataScope = { all: true } | { all: false; createdBy: string };

export interface ScopedUser {
  id: string;
  role: Role;
  partnerDistributorId: string | null;
}

export const dataScopeFor = (user: Pick<ScopedUser, "id" | "role">): DataScope =>
  can(user.role, "records.viewAll") ? { all: true } : { all: false, createdBy: user.id };

/** May this scope reach a record created by `createdBy`? Rows with no creator are Tecfys's. */
export const inScope = (scope: DataScope, createdBy: string | null | undefined): boolean =>
  scope.all || (createdBy != null && createdBy === scope.createdBy);

/** The `created_by` value a list query must filter on; null when unfiltered. */
export const createdByFilter = (scope: DataScope): string | null => (scope.all ? null : scope.createdBy);

/**
 * The distributor of a new operation: Tecfys roles choose it, a partner always
 * originates for the distributor it represents, whatever the form sends.
 */
export const operationDistributorId = (user: ScopedUser, requested: string | null): string | null =>
  can(user.role, "records.viewAll") ? requested : user.partnerDistributorId;
