/**
 * The permission matrix: the single place that says what each role may do.
 * Pure (no Next, no Supabase), so the whole matrix and the route allow-list are
 * unit-tested and the same module drives the proxy, the server guards and the
 * UI. Nothing else in the app compares roles by name.
 *
 * Enforcement is server-side (src/lib/auth/guard.ts); the UI only hides what a
 * role cannot use.
 */

/** Most to least privileged. */
export const ROLES = ["owner", "admin", "sales", "partner"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

/** The root role belongs to this account: exactly one owner, never deleted or demoted. */
export const OWNER_EMAIL = "finance@tecfys.com";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrador",
  sales: "Comercial",
  partner: "Partner",
};

const EVERYONE: readonly Role[] = ROLES;
const TECFYS: readonly Role[] = ["owner", "admin", "sales"];
const ADMINS: readonly Role[] = ["owner", "admin"];
const OWNER_ONLY: readonly Role[] = ["owner"];

const MATRIX = {
  /** Dashboard (/). */
  "dashboard.view": TECFYS,
  /** Loan book listing and its Excel / PDF export. */
  "loanBook.view": TECFYS,
  /** Cartera / Waterfall. */
  "waterfall.view": TECFYS,
  "erp.view": ADMINS,
  "erp.sync": ADMINS,
  /** Scoring list and detail; partners only reach their own (see scope.ts). */
  "scoring.view": EVERYONE,
  "scoring.run": EVERYONE,
  /** Manual committee decision on a scoring left pending review. */
  "scoring.review": ADMINS,
  /** The scoring model / criteria configuration. */
  "scoringModel.edit": ADMINS,
  /** Create an operation from an approved scoring the user can reach. */
  "operation.create": EVERYONE,
  /** One contract with its draft and attachments; partners only reach their own. */
  "contract.view": EVERYONE,
  /** Mark as signed, cancel, settle. */
  "contract.manage": ADMINS,
  /** Settings: catalogs, ERP and Informa connections. */
  "settings.access": ADMINS,
  /** See every record instead of only the ones the user created. */
  "records.viewAll": TECFYS,
  /** Create users, change roles, deactivate - never an owner (users/domain/rules.ts). */
  "users.manage": ADMINS,
  /** Create or modify an admin. */
  "admins.manage": OWNER_ONLY,
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof MATRIX;
export const CAPABILITIES = Object.keys(MATRIX) as Capability[];

export const can = (role: Role, capability: Capability): boolean => (MATRIX[capability] as readonly Role[]).includes(role);

/**
 * Route allow-list: the capability each path needs. Every page and route
 * handler under src/app/(app) must match a rule (a test walks the folder).
 */
const ROUTE_RULES: readonly (readonly [RegExp, Capability])[] = [
  [/^\/$/, "dashboard.view"],
  [/^\/scoring\/new$/, "scoring.run"],
  [/^\/scoring(?:\/[^/]+)?$/, "scoring.view"],
  [/^\/contracts$/, "loanBook.view"],
  [/^\/contracts\/export$/, "loanBook.view"],
  [/^\/contracts\/new$/, "operation.create"],
  [/^\/contracts\/[^/]+(?:\/draft|\/attachments\/[^/]+)?$/, "contract.view"],
  [/^\/portfolio$/, "waterfall.view"],
  [/^\/erp$/, "erp.view"],
  [/^\/settings$/, "settings.access"],
];

/** The capability a path needs; null when no rule knows the path. */
export function routeCapability(pathname: string): Capability | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return ROUTE_RULES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

/** Default deny: a path with no rule is only reachable by the roles that reach Settings. */
export function canAccessPath(role: Role, pathname: string): boolean {
  return can(role, routeCapability(pathname) ?? "settings.access");
}

export const DASHBOARD_PATH = "/";
export const NEW_SCORING_PATH = "/scoring/new";

/** Where a role lands after login, and where it is sent back to when denied. */
export const homePathFor = (role: Role): string => (can(role, "dashboard.view") ? DASHBOARD_PATH : NEW_SCORING_PATH);
