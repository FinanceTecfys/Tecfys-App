/**
 * The Settings tab navigator, pure and URL-driven: the active tab is the
 * `?tab=` query param, so a refresh or a deep link opens the same tab and the
 * server only loads that tab's data. Unit-tested.
 */

export const SETTINGS_PATH = "/settings";

/** In display order. */
export const SETTINGS_TABS = [
  { key: "users", label: "Usuarios y roles" },
  { key: "distributors", label: "Distribuidores" },
  { key: "assets", label: "Tipos de activo" },
  { key: "scoring", label: "Modelo de scoring" },
  { key: "apis", label: "APIs" },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

export const DEFAULT_SETTINGS_TAB: SettingsTab = SETTINGS_TABS[0].key;

const isSettingsTab = (value: unknown): value is SettingsTab => SETTINGS_TABS.some((t) => t.key === value);

/** The tab a `?tab=` value selects; anything unknown, repeated or missing opens the first tab. */
export const parseSettingsTab = (raw: string | string[] | undefined | null): SettingsTab => (isSettingsTab(raw) ? raw : DEFAULT_SETTINGS_TAB);

/** Link to a tab. The default tab keeps the bare /settings URL. */
export const settingsTabHref = (tab: SettingsTab): string => (tab === DEFAULT_SETTINGS_TAB ? SETTINGS_PATH : `${SETTINGS_PATH}?tab=${tab}`);
