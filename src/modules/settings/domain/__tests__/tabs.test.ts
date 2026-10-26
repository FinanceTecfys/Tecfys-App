import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { ROLES } from "@/lib/auth/permissions";
import {
  canOpenSettingsTab,
  DEFAULT_SETTINGS_TAB,
  parseSettingsTab,
  resolveSettingsTab,
  SETTINGS_TABS,
  type SettingsTab,
  settingsTabHref,
  settingsTabsFor,
} from "../tabs";

const ADMIN_TABS: SettingsTab[] = ["users", "distributors", "assets", "scoring", "apis"];
const ALL_TABS: SettingsTab[] = [...ADMIN_TABS, "preferences"];

describe("settings tabs", () => {
  it("are the five administration sections and then Preferencias, in order", () => {
    expect(SETTINGS_TABS.map((t) => t.key)).toEqual(ALL_TABS);
    expect(new Set(SETTINGS_TABS.map((t) => t.key)).size).toBe(SETTINGS_TABS.length);
    expect(SETTINGS_TABS.at(-1)).toEqual({ key: "preferences", capability: "preferences.manage" });
    for (const tab of ADMIN_TABS) expect(SETTINGS_TABS.find((t) => t.key === tab)?.capability, tab).toBe("settings.access");
  });

  it("every tab has a label in both languages, and the Spanish ones are unchanged", () => {
    expect(Object.keys(es.settings.tabs).sort()).toEqual([...ALL_TABS].sort());
    expect(Object.keys(en.settings.tabs).sort()).toEqual([...ALL_TABS].sort());
    expect(ALL_TABS.map((t) => es.settings.tabs[t])).toEqual(["Usuarios y roles", "Distribuidores", "Tipos de activo", "Modelo de scoring", "APIs", "Preferencias"]);
    expect(en.settings.tabs.preferences).toBe("Preferences");
  });

  it("opens the users tab by default", () => {
    expect(DEFAULT_SETTINGS_TAB).toBe("users");
    for (const raw of [undefined, null, ""]) expect(parseSettingsTab(raw)).toBe("users");
  });

  it("selects the tab named by ?tab=", () => {
    for (const { key } of SETTINGS_TABS) expect(parseSettingsTab(key)).toBe(key);
  });

  it("falls back to the default for anything it does not know", () => {
    for (const raw of ["nope", "Users", "users ", "toString", "constructor", "__proto__", "apis;drop", ["apis"], ["users", "apis"], []]) {
      expect(parseSettingsTab(raw), String(raw)).toBe(DEFAULT_SETTINGS_TAB);
    }
  });

  it("links each tab with its query param; the default keeps the bare URL", () => {
    expect(settingsTabHref("users")).toBe("/settings");
    expect(settingsTabHref("distributors")).toBe("/settings?tab=distributors");
    expect(settingsTabHref("assets")).toBe("/settings?tab=assets");
    expect(settingsTabHref("scoring")).toBe("/settings?tab=scoring");
    expect(settingsTabHref("apis")).toBe("/settings?tab=apis");
    expect(settingsTabHref("preferences")).toBe("/settings?tab=preferences");
  });

  it("round-trips: the tab a link points to is the tab the page opens", () => {
    for (const { key } of SETTINGS_TABS) {
      const url = new URL(settingsTabHref(key), "http://tecfys.invalid");
      expect(url.pathname).toBe("/settings");
      expect(parseSettingsTab(url.searchParams.get("tab")), key).toBe<SettingsTab>(key);
    }
  });
});

describe("access to each tab, by role", () => {
  it("owner and admin see every tab; sales and partner only Preferencias", () => {
    expect(settingsTabsFor("owner")).toEqual(ALL_TABS);
    expect(settingsTabsFor("admin")).toEqual(ALL_TABS);
    expect(settingsTabsFor("sales")).toEqual(["preferences"]);
    expect(settingsTabsFor("partner")).toEqual(["preferences"]);
  });

  it("every role can open Preferencias; only owner and admin an administration tab", () => {
    for (const role of ROLES) {
      expect(canOpenSettingsTab(role, "preferences"), role).toBe(true);
      for (const tab of ADMIN_TABS) expect(canOpenSettingsTab(role, tab), `${role} ${tab}`).toBe(role === "owner" || role === "admin");
    }
  });

  it("owner and admin get the tab they ask for, and the users tab by default", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const tab of ALL_TABS) expect(resolveSettingsTab(tab, role), `${role} ${tab}`).toBe(tab);
      for (const raw of [undefined, null, "", "nope", ["apis"]]) expect(resolveSettingsTab(raw, role), `${role} ${String(raw)}`).toBe("users");
    }
  });

  it("sales and partner always get Preferencias: asking for an administration tab by URL does not open it", () => {
    for (const role of ["sales", "partner"] as const) {
      for (const raw of [...ADMIN_TABS, "preferences", undefined, null, "", "nope", "toString", ["users"], ["users", "apis"]]) {
        expect(resolveSettingsTab(raw, role), `${role} ${String(raw)}`).toBe("preferences");
      }
    }
  });

  it("whatever is asked, by whoever, the tab resolved is one the role may open and one it is shown", () => {
    for (const role of ROLES) {
      for (const raw of [...ALL_TABS, undefined, "nope", "__proto__"]) {
        const tab = resolveSettingsTab(raw, role);
        expect(canOpenSettingsTab(role, tab), `${role} ${String(raw)}`).toBe(true);
        expect(settingsTabsFor(role), `${role} ${String(raw)}`).toContain(tab);
      }
    }
  });
});

describe("the Settings page applies it on the server", () => {
  const page = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "settings", "page.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("is open to every role, and renders only the tab resolved for the user's role", () => {
    expect(page).toContain('const user = await requireRole("preferences.manage");');
    expect(page).toContain("const tab = resolveSettingsTab((await searchParams).tab, user.role);");
    expect(page).toContain("<SettingsTabs tabs={settingsTabsFor(user.role)} active={tab} />");
    // The raw ?tab= value never chooses what is rendered.
    expect(page).not.toMatch(/parseSettingsTab|searchParams\)\.tab ===/);
  });

  it("every tab's content hangs from that resolved tab, one branch each", () => {
    for (const tab of ALL_TABS) expect(page.match(new RegExp(`\\{tab === "${tab}" && <`, "g")) ?? [], tab).toHaveLength(1);
    expect(page.match(/\{tab === "/g)).toHaveLength(ALL_TABS.length);
  });

  it("the preferences form edits the session user's own stored values", () => {
    expect(page).toContain("language={user.language} theme={user.theme}");
  });
});
