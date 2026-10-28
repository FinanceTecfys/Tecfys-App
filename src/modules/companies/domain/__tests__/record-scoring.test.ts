/**
 * The TypeScript side (the payload of record_scoring) and the SQL side (what
 * the functions write), read from the migration so the two cannot drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { recordedScoringOf, recordScoringArgs } from "../record-scoring";
import { COMPANY_FIELDS, type CompanyUpdateDecision } from "../update-policy";

const SQL = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261028000000_company_master_history.sql"), "utf8")
  .replace(/\r\n/g, "\n")
  .replace(/--[^\n]*/g, "");
const fn = (name: string) => SQL.slice(SQL.indexOf(`create or replace function public.${name}(`), SQL.indexOf("\n$$;", SQL.indexOf(`function public.${name}(`)));
const DATA = readFileSync(path.join(process.cwd(), "src", "modules", "companies", "data.ts"), "utf8");

const SCORING = { rating: "A", created_by: "user-1" };

describe("recordScoringArgs", () => {
  it("creates: the new company's columns, no id, no changes", () => {
    const decision: CompanyUpdateDecision = { kind: "create", values: { cif: "B1", name: "Alfa", country: "ES" } };
    expect(recordScoringArgs({ decision, source: "informa_pdf", scoring: SCORING, reportId: "r-1" })).toEqual({
      p_scoring: SCORING, p_company: { cif: "B1", name: "Alfa", country: "ES" }, p_changes: [], p_report_id: "r-1",
    });
  });

  it("updates: only the applied columns, every change, the source", () => {
    const decision: CompanyUpdateDecision = {
      kind: "update", companyId: "c-1", apply: { name: "Beta" },
      changes: [{ field: "name", kind: "change", oldValue: "Alfa", newValue: "Beta", status: "applied" }],
    };
    expect(recordScoringArgs({ decision, source: "informa_api", scoring: SCORING, reportId: null })).toEqual({
      p_scoring: SCORING, p_company: { name: "Beta" }, p_company_id: "c-1", p_source: "informa_api",
      p_changes: [{ field: "name", old_value: "Alfa", new_value: "Beta", status: "applied" }],
    });
  });

  it("a partner's pending-only update sends an empty company: the master is not touched", () => {
    const decision: CompanyUpdateDecision = {
      kind: "update", companyId: "c-1", apply: {},
      changes: [{ field: "name", kind: "change", oldValue: "Alfa", newValue: "Beta", status: "pending" }],
    };
    expect(recordScoringArgs({ decision, source: "informa_pdf", scoring: SCORING, reportId: null })).toMatchObject({ p_company: {}, p_company_id: "c-1" });
  });

  it("reads the function's answer", () => {
    expect(recordedScoringOf({ scoring_id: "s", company_id: "c" })).toEqual({ scoringId: "s", companyId: "c" });
    for (const bad of [null, "x", {}, { scoring_id: 1, company_id: "c" }]) expect(recordedScoringOf(bad)).toBeNull();
  });
});

describe("the SQL functions agree with the policy", () => {
  const columnsSet = (body: string) => [...body.matchAll(/^\s*(?:set\s+)?(\w+)\s*= case\b/gm)].map((m) => m[1]).sort();

  it("record_scoring updates exactly the policy's fields, each only when the policy sent it", () => {
    const update = fn("record_scoring").slice(fn("record_scoring").indexOf("update public.companies c"));
    const body = update.slice(0, update.indexOf("where c.id"));
    expect(columnsSet(body)).toEqual([...COMPANY_FIELDS].sort());
    for (const field of COMPANY_FIELDS) expect(body).toMatch(new RegExp(`${field}\\s*= case when p_company \\? '${field}'\\s+then n\\.${field}\\s+else c\\.${field} end`));
  });

  it("decide_company_change applies exactly the policy's fields, and the change table accepts exactly those", () => {
    const update = fn("decide_company_change").slice(fn("decide_company_change").indexOf("update public.companies c"));
    expect(columnsSet(update.slice(0, update.indexOf("where c.id")))).toEqual([...COMPANY_FIELDS].sort());
    const check = SQL.match(/field\s+text not null check \(field in \(([^)]*)\)\)/)![1];
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...COMPANY_FIELDS].sort());
  });

  it("record_scoring never touches contracts, and only inserts scorings", () => {
    const body = fn("record_scoring");
    expect(body).not.toMatch(/\bcontracts\b/);
    expect(body).not.toMatch(/update public\.scorings|delete from public\.scorings/);
    expect(body).toMatch(/insert into public\.scorings/);
  });

  it("both functions run with the caller's rights, an empty search_path, for the service role only", () => {
    for (const name of ["record_scoring", "decide_company_change"]) {
      expect(fn(name)).toContain("language plpgsql security invoker set search_path = ''");
      expect(SQL).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
      expect(SQL).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
    expect(SQL).toContain("alter table company_changes enable row level security;");
    expect(SQL).toContain("alter table company_changes force row level security;");
  });

  it("the data layer reads every policy field", () => {
    const columns = DATA.match(/const POLICY_COLUMNS =\s*"([^"]+)"/)![1].split(",").map((c) => c.trim());
    expect(columns.filter((c) => c !== "id" && c !== "cif").sort()).toEqual([...COMPANY_FIELDS].sort());
  });

  it("every field has a label in both languages", () => {
    expect(Object.keys(es.companies.fields).sort()).toEqual([...COMPANY_FIELDS].sort());
    expect(Object.keys(en.companies.fields).sort()).toEqual([...COMPANY_FIELDS].sort());
  });
});
