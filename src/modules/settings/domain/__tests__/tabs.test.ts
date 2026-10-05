import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS_TAB, parseSettingsTab, SETTINGS_TABS, type SettingsTab, settingsTabHref } from "../tabs";

describe("settings tabs", () => {
  it("are the five sections, in order", () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(["Usuarios y roles", "Distribuidores", "Tipos de activo", "Modelo de scoring", "APIs"]);
    expect(SETTINGS_TABS.map((t) => t.key)).toEqual(["users", "distributors", "assets", "scoring", "apis"]);
    expect(new Set(SETTINGS_TABS.map((t) => t.key)).size).toBe(SETTINGS_TABS.length);
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
  });

  it("round-trips: the tab a link points to is the tab the page opens", () => {
    for (const { key } of SETTINGS_TABS) {
      const url = new URL(settingsTabHref(key), "http://tecfys.invalid");
      expect(url.pathname).toBe("/settings");
      expect(parseSettingsTab(url.searchParams.get("tab")), key).toBe<SettingsTab>(key);
    }
  });
});
