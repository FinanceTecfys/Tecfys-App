import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@/lib/auth/permissions";
import { DEFAULT_LOCALE, LOCALES } from "../config";

/**
 * The message catalogues and their use across the WHOLE app. A string that is
 * missing in one language, has lost a placeholder, names a key that does not
 * exist, or was left in Spanish inside a component fails here instead of
 * shipping half-translated.
 */
const SRC = path.join(process.cwd(), "src");
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const rel = (file: string) => path.relative(SRC, file).replaceAll("\\", "/");
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
const NAMESPACES = Object.keys(catalogue(DEFAULT_LOCALE) as object);

describe("message catalogues", () => {
  it("there is one file per language, organised by module", () => {
    for (const locale of LOCALES) expect(existsSync(path.join(SRC, "i18n", "messages", `${locale}.json`)), locale).toBe(true);
    expect(base.size).toBeGreaterThan(900);
    expect(NAMESPACES).toEqual(expect.arrayContaining(["common", "nav", "auth", "settings", "preferences", "scoring", "contract", "loanBook", "operation", "dashboard", "pipeline", "portfolio", "erp", "users", "validation", "errors"]));
  });

  it.each(others)("%s has exactly the keys of the Spanish base: none missing, none extra", (locale) => {
    const translated = flatten(catalogue(locale));
    expect([...base.keys()].filter((k) => !translated.has(k)), "missing").toEqual([]);
    expect([...translated.keys()].filter((k) => !base.has(k)), "not in the base").toEqual([]);
  });

  it.each(LOCALES)("%s: every message is a non-empty string, with balanced braces and no trailing space", (locale) => {
    for (const [key, message] of flatten(catalogue(locale))) {
      expect(typeof message, key).toBe("string");
      const text = message as string;
      expect(text.trim().length, key).toBeGreaterThan(0);
      expect(text, key).toBe(text.trimEnd());
      expect((text.match(/{/g) ?? []).length, key).toBe((text.match(/}/g) ?? []).length);
    }
  });

  it.each(others)("%s keeps the placeholders of every message", (locale) => {
    const translated = flatten(catalogue(locale));
    for (const [key, message] of base) expect(placeholders(translated.get(key) as string), key).toEqual(placeholders(message as string));
  });

  it("reads placeholders, including plurals and selects (the check above is not vacuous)", () => {
    expect(placeholders("Versión {version}")).toEqual(["version"]);
    expect(placeholders("{count, plural, one {# cuenta} other {# cuentas}} · {name}")).toEqual(["count", "name"]);
    expect(placeholders("Sin argumentos")).toEqual([]);
    expect([...base.values()].filter((m) => placeholders(m as string).length > 0).length).toBeGreaterThan(60);
  });

  it.each(LOCALES)("%s: every message is valid ICU and formats with its values (none would fail at render time)", (locale) => {
    const failures: string[] = [];
    const t = createTranslator({
      locale,
      messages: catalogue(locale) as Record<string, unknown>,
      onError: (error) => failures.push(error.message),
    }) as unknown as (key: string, values?: Record<string, string | number>) => string;
    // A value for each placeholder: numbers for the plural arguments, text for the rest.
    const NUMERIC = new Set(["count", "months", "installments"]);
    for (const [key, message] of flatten(catalogue(locale))) {
      const values = Object.fromEntries(placeholders(message as string).map((name) => [name, NUMERIC.has(name) ? 2 : name === "kind" ? "contract" : `<${name}>`]));
      const text = t(key, values);
      expect(text.length, key).toBeGreaterThan(0);
      // Nothing left unformatted, and each plain value really is in the output.
      expect(text, key).not.toMatch(/\{\w+[,}]/);
      for (const [name, value] of Object.entries(values)) if (typeof value === "string" && name !== "kind") expect(text, key).toContain(value);
    }
    expect(failures).toEqual([]);
  });

  it.each(others)("%s is actually translated: no Spanish text was copied over", (locale) => {
    const translated = flatten(catalogue(locale));
    // The same word in both languages is normal (Rating, EBITDA, Partner, Total...). The same SENTENCE is a copy.
    const words = (m: string) => (m.replace(/\{[^{}]*\}/g, " ").match(/[A-Za-zÀ-ÿ]{3,}/g) ?? []).length;
    const copied = [...base].filter(([key, message]) => translated.get(key) === message && words(message as string) >= 3).map(([key]) => key);
    expect(copied).toEqual([]);
    // No Spanish-only characters or function words in the translation (language names aside).
    const spanish = [...translated]
      .filter(([key, m]) => !key.startsWith("preferences.languages.") && /[áéíóúñ¿¡]|\b(el|la|los|las|del|que|para|con|una|sin|por)\b/i.test(m as string))
      .map(([key]) => key);
    expect(spanish).toEqual([]);
    // And at least nine messages in ten really differ from the Spanish ones.
    const different = [...base].filter(([key, message]) => translated.get(key) !== message).length;
    expect(different / base.size).toBeGreaterThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// The source of the whole app
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "messages" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Files that hold Spanish text on purpose - none of it is interface text, and
 * each has its reason. Anything else in src/ must be free of it.
 */
const EXEMPT_FILES: Record<string, string> = {
  "lib/supabase/database.types.ts": "generated from the database",
  "modules/contracts/domain/contract-template.ts": "the renting contract (.docx): a Spanish legal document, never translated",
  "modules/contracts/document/render-contract-docx.ts": "the renting contract (.docx)",
  "modules/contracts/document/export-loan-book.ts": "the Excel / PDF exports stay in Spanish",
  "app/(app)/contracts/export/route.ts": "the Excel / PDF exports stay in Spanish (their filter summary)",
  "modules/scoring/informa/parse-informa-text.ts": "reads the Spanish labels printed in Informa's PDF",
  "modules/scoring/informa/map-informa-report.ts": "matches Spanish values of Informa's API (its warnings are message keys)",
  "modules/scoring/informa/cnae.ts": "CNAE activity names from the official classification",
  "modules/scoring/informa/api-client.ts": "technical diagnostics for the logs; the user is shown scoring.informa.errors.* by code",
  "modules/erp/domain/map-excel.ts": "reads the headers and values of Holded's Excel export",
  "modules/erp/domain/values.ts": "parses values as Holded writes them",
};

/** Regions marked `i18n-exempt-start: reason` ... `i18n-exempt-end`: stored data values and export labels inside otherwise translated files. */
const EXEMPT_REGION = /\/\* i18n-exempt-start[\s\S]*?i18n-exempt-end \*\//g;

const withoutComments = (source: string) =>
  source.replace(EXEMPT_REGION, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

/** Words the Spanish interface used; inside a string or as JSX text they mean a label was left hard-coded. */
const SPANISH_WORDS =
  /\b(Iniciar sesión|Entrar|Cerrar|Guardar|Guardando|Añadir|Nombre|Estado|Activo|Inactivo|Usuarios|Distribuidor|Distribuidores|Idioma|Preferencias|Nuevo|Nueva|Grupo|Peso|Cliente|Clientes|Contrato|Contratos|Cancelar|Firma|Firmado|Cuota|Cuotas|Coste|Meses|Fecha|Importe|Buscar|Todos|Todas|Crear|Descargar|Subir|Borrador|Pendiente|Empresa|Ventas|Eliminar|Aplicar|Volver|Editar|Seleccionar|Selecciona|Indica|Revisa|Falta|Hasta|Desde|Mostrar|Anterior|Siguiente|Operaciones|Aprobado|Rechazado|Enviar|Enviando|Invitar|Rol|Gestionar|Resumen|Actividad|Cartera|Cobros|Concepto|Recalcular|Documentos|Administrador|Comercial|Tasa)\b|\b(Sin|Ver) [a-z]|\b(No se|No hay|No puedes|No tienes|Se ha|Ya existe) /;

/** String literals and JSX text of a line (import paths aside). */
const literalsOf = (line: string) => (line.match(/"[^"\n]*"|'[^'\n]*'|`[^`\n]*`|>[^<>{}\n]+</g) ?? []).filter((l) => !/^["'](@\/|\.\.?\/)/.test(l));

function leftovers(file: string): string[] {
  return withoutComments(read(file))
    .split("\n")
    .flatMap((line, i) => (/[áéíóúñÁÉÍÓÚÑ¿¡]/.test(line) || literalsOf(line).some((l) => SPANISH_WORDS.test(l)) ? [`${rel(file)}:${i + 1}: ${line.trim().slice(0, 120)}`] : []));
}

const ALL = sources(SRC);

describe("no hard-coded Spanish anywhere in the app", () => {
  it("scans every source file of the app", () => {
    expect(ALL.length).toBeGreaterThan(130);
    for (const required of ["app/(app)/page.tsx", "app/(app)/contracts/page.tsx", "app/(app)/pipeline/page.tsx", "app/(app)/portfolio/page.tsx", "app/(app)/erp/page.tsx", "modules/contracts/components/operation-form.tsx", "modules/users/components/users-panel.tsx", "modules/scoring/components/scoring-wizard.tsx"]) {
      expect(ALL.map(rel), required).toContain(required);
    }
  });

  it("every exempt file exists and says why", () => {
    for (const [file, reason] of Object.entries(EXEMPT_FILES)) {
      expect(existsSync(path.join(SRC, file)), file).toBe(true);
      expect(reason.length, file).toBeGreaterThan(10);
    }
    expect(Object.keys(EXEMPT_FILES).length).toBeLessThanOrEqual(11);
  });

  it("outside those, no source file holds Spanish text: no Spanish letter, word or sentence in a string or in JSX", () => {
    const found = ALL.filter((f) => !(rel(f) in EXEMPT_FILES)).flatMap(leftovers);
    expect(found).toEqual([]);
  });

  it("an exempt region is marked and explained, and there are only a handful", () => {
    const regions = ALL.flatMap((f) => (read(f).match(/\/\* i18n-exempt-start[^\n]*/g) ?? []).map((m) => `${rel(f)} ${m}`));
    for (const region of regions) expect(region).toMatch(/i18n-exempt-start: \S.{15,} \*\//);
    expect(regions.length).toBeLessThanOrEqual(6);
    const ends = ALL.flatMap((f) => read(f).match(/\/\* i18n-exempt-end \*\//g) ?? []);
    expect(ends.length).toBe(regions.length);
  });

  it("the scanner catches what it should (it is not passing by seeing nothing)", () => {
    const check = (line: string) => /[áéíóúñÁÉÍÓÚÑ¿¡]/.test(line) || literalsOf(line).some((l) => SPANISH_WORDS.test(l));
    for (const bad of ['<Th>Cliente</Th>', 'label="Fecha de firma"', 'const m = "Sin datos";', "title={`Contrato ${n}`}", '<p>Añadir</p>', 'error: "No se pudo guardar"']) expect(check(bad), bad).toBe(true);
    for (const good of ['<Th>{t("client")}</Th>', 'label={t("signingDate")}', 'import { Card } from "@/components/ui/card";', 'const status = "Finished";', 'title="Pipeline"', 'const k = "errors.contract.notFound";']) {
      expect(check(good), good).toBe(false);
    }
    const stripped = withoutComments('const a = "ok"; // nota: Añadir\n/* Cerrar */\n/* i18n-exempt-start: stored loan-book codes */\nconst c = "Reclamación";\n/* i18n-exempt-end */\nconst url = "https://x";');
    expect(stripped).toContain('const a = "ok";');
    expect(stripped).toContain('const url = "https://x";');
    expect(stripped).not.toMatch(/nota|Cerrar|Reclamación/);
  });

  it("the translated screens take their text from the catalogue", () => {
    const ui = ALL.filter((f) => /\.tsx$/.test(f) && /(app\/|components\/)/.test(rel(f)));
    const without = ui.filter((f) => !/getTranslations\(|useTranslations\(|useTranslate\(|getTranslate\(/.test(read(f))).map(rel);
    // Components with no text of their own: layout shells, primitives that only render what they are given.
    expect(without.sort()).toEqual([
      "app/(app)/layout.tsx",
      "components/brand/tecfys-logo.tsx",
      "components/ui/alert.tsx",
      "components/ui/badge.tsx",
      "components/ui/button.tsx",
      "components/ui/card.tsx",
      "components/ui/field.tsx",
      "components/ui/filter-bar.tsx",
      "components/ui/page-header.tsx",
      "components/ui/stat.tsx",
      "components/ui/table.tsx",
    ]);
  });
});

describe("every message key written in the source exists", () => {
  // A string literal that reads like a path into the catalogue: "validation.operation.installmentPositive".
  const KEY = new RegExp(`["'\`]((?:${NAMESPACES.join("|")})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)["'\`]`, "g");
  const prefixes = new Set<string>();
  for (const key of base.keys()) {
    const parts = key.split(".");
    for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join("."));
  }
  // Capabilities share the shape ("scoring.view") and are not messages.
  // So does one section name of supabase/config.toml.
  const notMessages = new Set<string>([...CAPABILITIES, "auth.email"]);

  it("as a message or as a namespace of messages", () => {
    const unknown: string[] = [];
    let seen = 0;
    for (const file of ALL) {
      for (const match of read(file).matchAll(KEY)) {
        const key = match[1];
        if (notMessages.has(key)) continue;
        seen++;
        // "errors.invalidLink" may also be a key relative to the namespace its translator was opened with.
        const relative = [...base.keys()].some((k) => k.endsWith(`.${key}`)) || [...prefixes].some((k) => k.endsWith(`.${key}`));
        if (!base.has(key) && !prefixes.has(key) && !relative) unknown.push(`${rel(file)}: ${key}`);
      }
    }
    expect(unknown).toEqual([]);
    expect(seen).toBeGreaterThan(200);
  });

  it("including the keys the domain returns for the server to translate", () => {
    for (const key of [
      "validation.operation.installmentPositive", "validation.sepa.checksum", "validation.attachment.tooLarge", "validation.cancellation.noSettlement",
      "validation.scoring.cifRequired", "validation.erp.holdedUrl", "validation.users.role", "errors.contract.notFound", "errors.users.owner",
      "auth.setPassword.errors.tooShort", "pipeline.lifecycle.labels.draft", "pipeline.lifecycle.hints.signedOutside", "pipeline.lifecycle.states.done",
      "contract.lifecycleSteps.signature", "scoring.informa.warnings.months", "scoring.informa.errors.code10005", "dashboard.period.last12",
    ]) {
      expect(base.has(key), key).toBe(true);
    }
  });
});
