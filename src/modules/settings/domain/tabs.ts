/**
 * The Settings tab navigator, pure and URL-driven: the active tab is the
 * `?tab=` query param, so a refresh or a deep link opens the same tab and the
 * server only loads that tab's data. Unit-tested.
 *
 * Settings is open to every role, but each tab asks for its own capability:
 * the administration tabs are for the roles that hold settings.access, and
 * "Preferencias" (the user's own language and theme) is for everyone. A role
 * only sees, and can only open, the tabs it holds the capability for - asking
 * for another one by URL opens the first tab the role may use instead.
 *
 * The labels are messages (settings.tabs.<key>), not part of this module.
 */
import { can, type Capability, type Role } from "@/lib/auth/permissions";

export const SETTINGS_PATH = "/settings";

/** In display order. */
export const SETTINGS_TABS = [
  { key: "users", capability: "settings.access" },
  { key: "distributors", capability: "settings.access" },
  { key: "assets", capability: "settings.access" },
  { key: "scoring", capability: "settings.access" },
  { key: "apis", capability: "settings.access" },
  { key: "preferences", capability: "preferences.manage" },
] as const satisfies readonly { key: string; capability: Capability }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

export const DEFAULT_SETTINGS_TAB: SettingsTab = SETTINGS_TABS[0].key;

const isSettingsTab = (value: unknown): value is SettingsTab => SETTINGS_TABS.some((t) => t.key === value);

/** The tab a `?tab=` value names; anything unknown, repeated or missing is the first tab. Says nothing about access. */
export const parseSettingsTab = (raw: string | string[] | undefined | null): SettingsTab => (isSettingsTab(raw) ? raw : DEFAULT_SETTINGS_TAB);

/** May this role open this tab? */
export const canOpenSettingsTab = (role: Role, tab: SettingsTab): boolean =>
  can(role, SETTINGS_TABS.find((t) => t.key === tab)!.capability);

/** The tabs a role sees, in display order. Never empty: every role holds preferences.manage. */
export const settingsTabsFor = (role: Role): SettingsTab[] => SETTINGS_TABS.filter((t) => can(role, t.capability)).map((t) => t.key);

/**
 * The tab the page renders for this role: the one `?tab=` names if the role may
 * open it, otherwise the first tab the role may open. This is the server-side
 * gate of each tab's content - a partner asking for ?tab=users gets its own
 * Preferencias, never the users.
 */
export function resolveSettingsTab(raw: string | string[] | undefined | null, role: Role): SettingsTab {
  const requested = parseSettingsTab(raw);
  if (canOpenSettingsTab(role, requested)) return requested;
  return settingsTabsFor(role)[0] ?? "preferences";
}

/** Link to a tab. The default tab keeps the bare /settings URL. */
export const settingsTabHref = (tab: SettingsTab): string => (tab === DEFAULT_SETTINGS_TAB ? SETTINGS_PATH : `${SETTINGS_PATH}?tab=${tab}`);
