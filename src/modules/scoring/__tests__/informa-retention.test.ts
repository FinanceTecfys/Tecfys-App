/**
 * Zero retention of Informa reports, guarded on the source itself: the scoring
 * module never touches Supabase Storage, never names the old informa-reports
 * bucket, never writes a file or logs, and never persists a raw payload column.
 * The behaviour (no storage call, no report content written) is tested in
 * scoring-actions.test.ts; this catches a regression before it runs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
/** Code without comments, so a comment explaining the rule does not trip it. */
const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const SCORING = files(path.join(ROOT, "src", "modules", "scoring")).concat(files(path.join(ROOT, "src", "app", "(app)", "scoring")));
const APP = files(path.join(ROOT, "src"));

describe("Informa reports are never retained", () => {
  it("the scoring module never calls Supabase Storage", () => {
    expect(SCORING.filter((f) => /\.storage\b/.test(code(f))).map(rel)).toEqual([]);
  });

  it("no app code names the informa-reports bucket", () => {
    expect(APP.filter((f) => code(f).includes("informa-reports")).map(rel)).toEqual([]);
  });

  it("the scoring module writes no file and logs nothing", () => {
    const offenders = SCORING.filter((f) => /\bconsole\.|\bwriteFile|\bcreateWriteStream|\bmkdtemp|\btmpdir\(/.test(code(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("no hand-written code writes the dropped raw-report columns", () => {
    const hand = APP.filter((f) => !f.endsWith("database.types.ts"));
    expect(hand.filter((f) => /\b(storage_path|parsed)\s*:/.test(code(f)) && code(f).includes("informa_reports")).map(rel)).toEqual([]);
  });

  it("the generated types no longer offer a raw-report column on informa_reports", () => {
    const types = readFileSync(path.join(ROOT, "src", "lib", "supabase", "database.types.ts"), "utf8");
    const start = types.indexOf("informa_reports: {");
    const table = types.slice(start, types.indexOf("Relationships", start));
    expect(table).toContain("file_sha256");
    expect(table).not.toMatch(/\b(storage_path|parsed)\b/);
  });

  it("the Informa actions write only the receipt columns", () => {
    const actions = code(path.join(ROOT, "src", "modules", "scoring", "actions.ts"));
    const inserts = [...actions.matchAll(/\.from\("informa_reports"\)\s*\.insert\(\{([\s\S]*?)\}\)/g)].map((m) =>
      [...m[1].matchAll(/^\s*(\w+):/gm)].map((c) => c[1]).sort(),
    );
    expect(inserts).toEqual([
      ["created_by", "fetched_at", "reference_year", "report_date", "source"],
      ["created_by", "file_name", "file_sha256", "reference_year", "report_date", "source"],
    ]);
  });
});
