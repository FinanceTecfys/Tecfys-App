/**
 * Guards the database's public API surface, read from the migrations themselves.
 *
 * The app reaches every table through the service role (which bypasses RLS);
 * anon / authenticated must reach nothing. These checks fail when a migration
 * adds a table without RLS, grants anything to an API role, or loosens the
 * per-user policy pattern of 20261003000000_rls_hardening.sql. The live proof
 * (dry run + anon / session requests against the local stack) is in that
 * branch's hand-off; this keeps the rules from regressing.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
/** Migration text without comments, lower-cased, newlines normalised. */
const strip = (sql: string) => sql.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "").toLowerCase();
const SQL = new Map(FILES.map((f) => [f, strip(readFileSync(path.join(DIR, f), "utf8"))]));
const ALL = [...SQL.values()].join("\n");
const HARDENING = SQL.get("20261003000000_rls_hardening.sql") ?? "";

const createdTables = [...ALL.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)].map((m) => m[1]);

describe("RLS on every app table", () => {
  it("finds the tables the app uses", () => {
    expect(createdTables).toEqual(expect.arrayContaining(["companies", "scorings", "contracts", "contract_attachments", "profiles", "informa_reports", "holded_sales_invoices"]));
  });

  it("enables RLS on each table explicitly", () => {
    const missing = createdTables.filter((t) => !new RegExp(`alter table (?:public\\.)?${t}\\s+enable row level security`).test(ALL));
    expect(missing).toEqual([]);
  });

  it("enables and forces RLS on every public table in the hardening migration, sparing only profiles from FORCE", () => {
    expect(HARDENING).toContain("where n.nspname = 'public' and c.relkind in ('r', 'p')");
    expect(HARDENING).toContain("execute format('alter table public.%i enable row level security', t.relname)");
    expect(HARDENING).toContain("execute format('alter table public.%i force row level security', t.relname)");
    expect(HARDENING).toContain("if t.relname <> 'profiles' then");
  });

  it("refuses to run unless service_role bypasses RLS", () => {
    expect(HARDENING).toMatch(/rolname = 'service_role' and rolbypassrls/);
    expect(HARDENING).toContain("raise exception");
  });
});

describe("no privilege for the API roles", () => {
  it("never grants anything on a public table, sequence or function to anon / authenticated", () => {
    const grants = [...ALL.matchAll(/\bgrant\s[^;]*;/g)].map((m) => m[0]).filter((g) => /\bto\b[^;]*\b(anon|authenticated|public)\b/.test(g));
    expect(grants).toEqual([]);
  });

  it("re-states the revoke of table and sequence privileges", () => {
    expect(HARDENING).toContain("revoke all on all tables    in schema public from anon, authenticated;");
    expect(HARDENING).toContain("revoke all on all sequences in schema public from anon, authenticated;");
  });

  it("revokes execute on every security definer function from the API roles", () => {
    const definers = [...ALL.matchAll(/create or replace function (public\.\w+)\(\)[^$]*?security definer/g)].map((m) => m[1]);
    expect(definers).toEqual(expect.arrayContaining(["public.seed_owner_profile", "public.current_app_role"]));
    for (const fn of definers) expect(ALL).toContain(`revoke execute on function ${fn}() from public, anon, authenticated;`);
  });
});

describe("per-user policy pattern (scorings, contracts)", () => {
  const policies = [...HARDENING.matchAll(/create policy (\w+) on public\.(\w+)\s+for (\w+) to (\w+)\s+using \(([\s\S]*?)\n\s*\);/g)].map((m) => ({
    name: m[1], table: m[2], command: m[3], role: m[4], using: m[5].replace(/\s+/g, " ").trim(),
  }));

  it("is the only policy in the migrations, SELECT-only and for authenticated", () => {
    expect([...ALL.matchAll(/create policy/g)]).toHaveLength(2);
    expect(policies.map((p) => [p.table, p.command, p.role])).toEqual([
      ["scorings", "select", "authenticated"],
      ["contracts", "select", "authenticated"],
    ]);
  });

  it("lets staff see every row and an active user only the rows it created", () => {
    for (const p of policies) {
      expect(p.using).toBe(
        "(select public.current_app_role()) in ('owner', 'admin', 'sales') " +
          "or (created_by = (select auth.uid()) and (select public.current_app_role()) is not null)",
      );
    }
  });

  it("reads the role through a safe security definer helper (fixed search_path, active profiles only)", () => {
    const fn = HARDENING.slice(HARDENING.indexOf("create or replace function public.current_app_role()"), HARDENING.indexOf("$$;", HARDENING.indexOf("current_app_role() returns")));
    expect(fn).toContain("language sql stable security definer set search_path = ''");
    expect(fn).toContain("from public.profiles p");
    expect(fn).toContain("where p.user_id = auth.uid() and p.active");
    expect(fn).not.toMatch(/\bexecute\b|format\(/);
  });

  it("is idempotent (drop before create)", () => {
    for (const p of policies) expect(HARDENING).toContain(`drop policy if exists ${p.name} on public.${p.table};`);
  });
});
