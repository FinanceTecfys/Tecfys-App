import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_THEME, documentAttributes, isTheme, resolvePreferences, resolveTheme, THEMES } from "../theme";

const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), "utf8").replace(/\r\n/g, "\n");

describe("theme modes", () => {
  it("are green (the current palette, the default) and blue", () => {
    expect(THEMES).toEqual(["green", "blue"]);
    expect(DEFAULT_THEME).toBe("green");
    expect(DEFAULT_PREFERENCES).toEqual({ language: "es", theme: "green" });
  });

  it("resolveTheme keeps a known mode and falls back to green for anything else", () => {
    expect(resolveTheme("blue")).toBe("blue");
    expect(resolveTheme("green")).toBe("green");
    for (const bad of [null, undefined, "", "Blue", "dark", "light", "toString", 1, ["blue"]]) {
      expect(isTheme(bad), String(bad)).toBe(false);
      expect(resolveTheme(bad), String(bad)).toBe("green");
    }
  });
});

describe("resolvePreferences (what is stored -> what is applied)", () => {
  it("takes both from the profile", () => {
    expect(resolvePreferences({ language: "en", theme: "blue" })).toEqual({ language: "en", theme: "blue" });
    expect(resolvePreferences({ language: "es", theme: "green" })).toEqual({ language: "es", theme: "green" });
  });

  it("is the defaults with no profile, and each value falls back on its own", () => {
    expect(resolvePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(resolvePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(resolvePreferences({})).toEqual(DEFAULT_PREFERENCES);
    expect(resolvePreferences({ language: "en", theme: "purple" })).toEqual({ language: "en", theme: "green" });
    expect(resolvePreferences({ language: "fr", theme: "blue" })).toEqual({ language: "es", theme: "blue" });
  });

  it("before signing in only the language can come from the browser; the theme is always the default", () => {
    expect(resolvePreferences(null, "en")).toEqual({ language: "en", theme: "green" });
    expect(resolvePreferences({ language: "es", theme: "blue" }, "en")).toEqual({ language: "es", theme: "blue" });
  });
});

describe("the data-theme seam", () => {
  it("the stored preference becomes the attributes of <html>", () => {
    expect(documentAttributes({ language: "es", theme: "green" })).toEqual({ lang: "es", "data-theme": "green" });
    expect(documentAttributes({ language: "en", theme: "blue" })).toEqual({ lang: "en", "data-theme": "blue" });
    // Straight from what the database holds, valid or not.
    expect(documentAttributes(resolvePreferences({ language: "en", theme: "blue" }))["data-theme"]).toBe("blue");
    expect(documentAttributes(resolvePreferences({ language: null, theme: "neon" }))).toEqual({ lang: "es", "data-theme": "green" });
  });

  it("the root layout puts those attributes on <html>, from the request's preferences", () => {
    const layout = read("src", "app", "layout.tsx");
    expect(layout).toContain("const preferences = await currentPreferences();");
    expect(layout).toContain("<html {...documentAttributes(preferences)}");
    expect(layout).not.toMatch(/<html[^>]*\blang="/);
    expect(layout).toContain("<NextIntlClientProvider>");
  });

  it("every theme mode has its place in globals.css: green is the token set, blue is a block waiting for its palette", () => {
    const css = read("src", "app", "globals.css");
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Green: the tokens every ink-* / mint-* utility reads.
    const theme = code.slice(code.indexOf("@theme {"), code.indexOf("}", code.indexOf("@theme {")));
    for (const token of ["--color-ink-950", "--color-ink-900", "--color-ink-800", "--color-ink-700", "--color-mint-500", "--color-mint-400", "--color-paper"]) {
      expect(theme, token).toMatch(new RegExp(`${token}:\\s*#[0-9a-f]{6};`));
    }
    // Every other mode has a selector on the same attribute the layout sets.
    for (const mode of THEMES.filter((t) => t !== DEFAULT_THEME)) expect(code, mode).toContain(`[data-theme="${mode}"] {`);
    // Out of scope here: the blue palette. The block exists and defines nothing yet, so blue renders green.
    const blue = code.slice(code.indexOf('[data-theme="blue"] {'));
    expect(blue.slice(blue.indexOf("{") + 1, blue.indexOf("}")).trim()).toBe("");
  });

  it("the palette is only ever reached through tokens: no component hard-codes the green hex values", () => {
    const css = read("src", "app", "globals.css");
    const hexes = [...css.matchAll(/--color-(?:ink|mint)-\d+:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
    expect(hexes.length).toBeGreaterThanOrEqual(10);
    for (const file of ["src/components/layout/sidebar.tsx", "src/components/ui/card.tsx", "src/components/ui/button.tsx", "src/components/ui/field.tsx", "src/modules/settings/components/preferences-form.tsx"]) {
      const source = read(...file.split("/")).toLowerCase();
      for (const hex of hexes) expect(source.includes(hex), `${file} ${hex}`).toBe(false);
    }
  });
});
