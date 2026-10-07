import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "../config";

/**
 * The message catalogues. A string that is missing in one language, has lost a
 * placeholder, or was left in Spanish inside a translated component fails here
 * instead of shipping half-translated.
 */
const SRC = path.join(process.cwd(), "src");
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const catalogue = (locale: string): unknown => JSON.parse(read(path.join(SRC, "i18n", "messages", `${locale}.json`)));

/** "a.b.c" -> message, for every leaf of a catalogue. */
function flatten(value: unknown, prefix = "", into = new Map<string, unknown>()): Map<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, into);
  } else into.set(prefix, value);
  return into;
}

/** The ICU arguments of a message: {name}, {count, plural, ...}. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === "{") {
      if (depth === 0) {
        const name = message.slice(i + 1).match(/^\s*([A-Za-z_][\w]*)\s*[,}]/)?.[1];
        if (name) names.add(name);
      }
      depth++;
    } else if (message[i] === "}") depth--;
  }
  return [...names].sort();
}

const base = flatten(catalogue(DEFAULT_LOCALE));
const others = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

describe("message catalogues", () => {
  it("there is one file per language", () => {
    for (const locale of LOCALES) expect(existsSync(path.join(SRC, "i18n", "messages", `${locale}.json`)), locale).toBe(true);
    expect(base.size).toBeGreaterThan(80);
  });

  it.each(others)("%s has exactly the keys of the Spanish base: none missing, none extra", (locale) => {
    const translated = flatten(catalogue(locale));
    expect([...base.keys()].filter((k) => !translated.has(k)), "missing").toEqual([]);
    expect([...translated.keys()].filter((k) => !base.has(k)), "not in the base").toEqual([]);
  });

  it.each(LOCALES)("%s: every message is a non-empty string, with balanced braces", (locale) => {
    for (const [key, message] of flatten(catalogue(locale))) {
      expect(typeof message, key).toBe("string");
      const text = message as string;
      expect(text.trim().length, key).toBeGreaterThan(0);
      expect(text, key).toBe(text.trim());
      expect((text.match(/{/g) ?? []).length, key).toBe((text.match(/}/g) ?? []).length);
    }
  });

  it.each(others)("%s keeps the placeholders of every message", (locale) => {
    const translated = flatten(catalogue(locale));
    for (const [key, message] of base) expect(placeholders(translated.get(key) as string), key).toEqual(placeholders(message as string));
  });

  it("reads placeholders, including plurals (the check above is not vacuous)", () => {
    expect(placeholders("Versión {version}")).toEqual(["version"]);
    expect(placeholders("{count, plural, one {# cuenta} other {# cuentas}} · {name}")).toEqual(["count", "name"]);
    expect(placeholders("Sin argumentos")).toEqual([]);
    expect([...base.values()].some((m) => placeholders(m as string).length > 0)).toBe(true);
  });

  it.each(others)("%s is actually translated: Spanish text was not copied over", (locale) => {
    const translated = flatten(catalogue(locale));
    // The same in both languages on purpose: brand and product terms, language names, symbols.
    const SAME = /^(common\.brand\.tagline|common\.roles\.(owner|partner)|nav\.(dashboard|scoring|pipeline|loanBook|erp)|auth\.login\.email|settings\.tabs\.apis|settings\.distributors\.email|settings\.scoringModel\.ratio|settings\.apis\.(holdedTitle|informaTitle)|preferences\.languages\.\w+|preferences\.themes\.green|scoring\.ratios\.sectorialRisk\.formula)$/;
    const copied = [...base].filter(([key, message]) => translated.get(key) === message && !SAME.test(key)).map(([key]) => key);
    expect(copied).toEqual([]);
    // No Spanish-only characters or stop words in the translation (language names aside).
    const spanish = [...translated].filter(([key, m]) => !key.startsWith("preferences.languages.") && /[áéíóúñ¿¡]|\b(el|la|los|las|de|del|que|para|con|una|sin)\b/i.test(m as string)).map(([key]) => key);
    expect(spanish).toEqual([]);
  });
});

/**
 * The areas already moved to tokens. Their source may not hold user-facing
 * Spanish any more: a Spanish letter, or one of the words these screens used,
 * outside a comment means a string was left hard-coded.
 */
const TRANSLATED = [
  "app/layout.tsx",
  "app/login/page.tsx",
  "app/(app)/settings/page.tsx",
  "components/layout/sidebar.tsx",
  "modules/auth/components/login-form.tsx",
  "modules/auth/domain/sign-in.ts",
  "modules/catalog/components/catalog-forms.tsx",
  "modules/catalog/actions.ts",
  "modules/settings/actions.ts",
  "modules/settings/components/settings-tabs.tsx",
  "modules/settings/components/preferences-form.tsx",
  "modules/settings/domain/tabs.ts",
  "modules/settings/domain/preferences.ts",
];

const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

describe("no hard-coded text in the translated areas", () => {
  it.each(TRANSLATED)("%s", (file) => {
    const code = withoutComments(read(path.join(SRC, file)));
    expect(code.match(/[áéíóúñÁÉÍÓÚÑ¿¡]/g) ?? [], "Spanish characters").toEqual([]);
    const words = /\b(Iniciar sesión|Entrar|Cerrar|Guardar|Añadir|Nombre|Estado|Activo|Inactivo|Usuarios|Distribuidores|Idioma|Preferencias|Principal|Nuevo|Grupo|Tipo|Peso)\b/;
    expect(code.match(words)?.[0], "Spanish word").toBeUndefined();
    // JSX text: anything between tags that starts with a capital letter and has a space is a sentence.
    const sentences = [...code.matchAll(/>\s*([A-Z][a-z]+ [a-z][^<>{}]*)</g)].map((m) => m[1].trim());
    expect(sentences, "literal JSX text").toEqual([]);
  });

  it("each of them takes its text from the catalogue (or has none to show)", () => {
    const NO_TEXT = ["modules/auth/domain/sign-in.ts", "modules/settings/domain/tabs.ts", "modules/settings/domain/preferences.ts"];
    for (const file of TRANSLATED.filter((f) => !NO_TEXT.includes(f))) {
      expect(read(path.join(SRC, file)), file).toMatch(/getTranslations\(|useTranslations\(/);
    }
  });

  it("the comment stripper leaves strings alone", () => {
    const stripped = withoutComments('const a = "Añadir"; // nota\n/* Cerrar */\n  // Guardar\nconst url = "https://x";');
    expect(stripped).toContain('const a = "Añadir";');
    expect(stripped).toContain('const url = "https://x";');
    expect(stripped).not.toMatch(/nota|Cerrar|Guardar/);
  });
});
