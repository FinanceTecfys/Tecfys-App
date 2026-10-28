/**
 * A contract keeps the scoring it was originated with, forever: the database
 * refuses to delete a scoring a contract references (ON DELETE RESTRICT), and
 * no code path deletes scorings or re-links a contract to another one. Read
 * from the sources; the live refusal was exercised against the local database
 * in the branch's verification (rolled back).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const sql = (file: string) => readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const code = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : code(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });

describe("contract origination is permanent", () => {
  it("the newest definition of contracts.scoring_id's foreign key is ON DELETE RESTRICT", () => {
    const definitions = migrations.flatMap((file) =>
      [...sql(file).matchAll(/scoring_id\s+uuid references scorings \(id\) on delete (\w+ ?\w*)|constraint contracts_scoring_id_fkey\s+foreign key \(scoring_id\) references scorings \(id\) on delete (\w+)/g)].map((m) => ({
        file, action: (m[1] ?? m[2]).trim(),
      })),
    );
    expect(definitions.at(0)).toEqual({ file: "20260922000000_core_schema.sql", action: "set null" });
    expect(definitions.at(-1)).toEqual({ file: "20261028120000_operation_master_policy.sql", action: "restrict" });
    expect(sql("20261028120000_operation_master_policy.sql")).toContain("alter table contracts drop constraint if exists contracts_scoring_id_fkey;");
  });

  it("nothing in the app, the scripts or the migrations deletes scorings", () => {
    const sources = [...code(path.join(ROOT, "src")), ...code(path.join(ROOT, "scripts"))].map((f) => readFileSync(f, "utf8"));
    expect(sources.filter((s) => /from\("scorings"\)[\s\S]{0,200}?\.delete\(/.test(s))).toEqual([]);
    expect(migrations.filter((f) => /delete from (public\.)?scorings\b/.test(sql(f)))).toEqual([]);
  });

  it("no operation write can move a contract to another scoring", () => {
    const update = sql("20261028120000_operation_master_policy.sql");
    const body = update.slice(update.indexOf("create or replace function public.update_draft_contract("), update.indexOf("create or replace function public.apply_operation_company_changes("));
    expect(body).not.toMatch(/scoring_id\s*=/);
  });
});
