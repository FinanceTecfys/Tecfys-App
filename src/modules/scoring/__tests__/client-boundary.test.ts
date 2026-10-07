import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scoring model is confidential: it must not be bundled for the browser.
 * This walks the import graph of every client component of the app (each
 * "use client" file and everything it imports by value) and fails if it
 * reaches the modules that hold or handle the model. Type-only imports are
 * erased by the compiler and "use server" files are only called, not bundled,
 * so neither is followed.
 */
const SRC = path.join(process.cwd(), "src");
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const rel = (file: string) => path.relative(SRC, file).replaceAll("\\", "/");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const directive = (source: string) => source.match(/^\s*["'](use client|use server)["']/)?.[1] ?? null;

/** Module specifiers a file imports by value (not `import type`, not all-`type` named imports). */
function valueImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/^(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {
    if (m[1]) continue;
    const named = m[2].match(/^\{([\s\S]*)\}$/);
    if (named && named[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    found.push(m[3]);
  }
  for (const m of source.matchAll(/^import\s+["']([^"']+)["']/gm)) found.push(m[1]);
  for (const m of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) found.push(m[1]);
  return found;
}

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every module that ends up in the browser because `entry` is a client component. */
function clientGraph(entry: string): Map<string, string> {
  const cameFrom = new Map<string, string>([[entry, entry]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    for (const specifier of valueImports(read(file))) {
      const target = resolve(file, specifier);
      if (!target || cameFrom.has(target)) continue;
      if (directive(read(target)) === "use server") continue; // called over the network, not bundled
      cameFrom.set(target, file);
      queue.push(target);
    }
  }
  return cameFrom;
}

const CONFIDENTIAL = [
  "modules/scoring/domain/criteria.ts", // the model itself
  "modules/scoring/domain/engine.ts", // only useful with the model in hand
  "modules/scoring/domain/preview.ts", // imports the engine; clients may use its types only
  "modules/scoring/data.ts", // reads the active model
];

describe("the scoring model stays on the server", () => {
  const clientEntries = sources(SRC).filter((file) => directive(read(file)) === "use client");

  it("finds the client components, the scoring wizard among them", () => {
    expect(clientEntries.length).toBeGreaterThanOrEqual(10);
    expect(clientEntries.map(rel)).toContain("modules/scoring/components/scoring-wizard.tsx");
  });

  it("no client component imports the model, the engine or the model's data access", () => {
    for (const entry of clientEntries) {
      const graph = clientGraph(entry);
      for (const forbidden of CONFIDENTIAL) {
        const hit = [...graph.keys()].find((file) => rel(file) === forbidden);
        expect(hit && `${rel(entry)} reaches ${forbidden} through ${rel(graph.get(hit)!)}`, rel(entry)).toBeUndefined();
      }
    }
  });

  it("the walker does see value imports (it is not passing by seeing nothing)", () => {
    const wizard = clientEntries.find((f) => rel(f) === "modules/scoring/components/scoring-wizard.tsx")!;
    const reached = [...clientGraph(wizard).keys()].map(rel);
    expect(reached).toEqual(expect.arrayContaining([
      "modules/scoring/components/score-breakdown.tsx",
      "modules/scoring/components/badges.tsx",
      "modules/scoring/domain/financials.ts",
      "i18n/client.ts",
    ]));
    // The server actions are called, not bundled.
    expect(reached).not.toContain("modules/scoring/actions.ts");
    expect(valueImports('import { a, type B } from "./x";\nimport type { C } from "./y";\nimport { type D } from "./z";\nexport { e } from "./w";')).toEqual(["./x", "./w"]);
  });

  it("the wizard takes results and sector names, never the criteria, and computes nothing itself", () => {
    const wizard = read(path.join(SRC, "modules/scoring/components/scoring-wizard.tsx"));
    expect(wizard).not.toMatch(/criteria|scoreCompany|ScoringCriteria|sectorRating|weights/);
    expect(wizard).toContain("previewScoring(");
    const page = read(path.join(SRC, "app/(app)/scoring/new/page.tsx"));
    expect(page).not.toMatch(/criteria=\{/);
    expect(page).toMatch(/sectors=\{sectorNames\(criteria\.config\)\}/);
  });

  it("the stored breakdown shows the weight and the score only through the scoringModel.viewBreakdown capability", () => {
    const detail = read(path.join(SRC, "app/(app)/scoring/[id]/page.tsx"));
    expect(detail).toContain('breakdownRows(scoring.breakdown, { withModel: can(user.role, "scoringModel.viewBreakdown") })');
    // The page renders the gated rows, never the raw stored breakdown.
    expect(detail).toContain("<ScoreBreakdown rows={rows} />");
    expect(detail).not.toMatch(/criteria_snapshot|breakdown={/);
  });

  it("the result vocabulary shared with the browser holds no model values", () => {
    const ratings = read(path.join(SRC, "modules/scoring/domain/ratings.ts"));
    const code = ratings.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toContain("RATINGS");
    expect(code).not.toMatch(/weights|tiers|scoreTable|scoreBuckets|prudence\s*:|decisionRules|sectorRating\s*:/);
    expect(valueImports(ratings)).toEqual([]);
  });
});
