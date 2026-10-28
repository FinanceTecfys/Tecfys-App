import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AttachmentRowInsert } from "../attachments";
import { COMPANY_FIELDS, type CompanyChange } from "@/modules/companies/domain/update-policy";
import { type CompanyWrite, CREATE_DRAFT_RPC, createDraftArgs, createdDraftOf, UPDATE_DRAFT_RPC, updateDraftArgs } from "../contract-write";
import { operationAssetFields, operationContractFields, type OperationInput, operationMandateFields, operationSchema } from "../operation";

const CONTRACT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SCORING_ID = "0b0e7a3c-1b1d-4c57-9b0e-3f6a1f0c2d11";
const ASSET_TYPE_ID = "5d3c2b1a-9f8e-4d7c-8b6a-1a2b3c4d5e6f";
const DISTRIBUTOR_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const operation = (over: Partial<OperationInput> = {}) =>
  operationSchema.parse({
    scoringId: SCORING_ID,
    clientName: "Alfa Hostelería SL", clientCif: "B12345678", fiscalAddress: "Calle Mayor 1", fiscalPostalCode: "28013", fiscalCity: "Madrid",
    fiscalProvince: "Madrid", signatoryName: "Ana Pérez", signatoryNif: "12345678Z", signatoryAddress: "", contactName: "Ana Pérez",
    contactPhone: "600 000 000", contactEmail: "ana@alfa.example", deliverySameAsFiscal: true, deliveryAddress: "",
    sepaIban: "ES91 2100 0418 4502 0005 1332", sepaDebtorName: "Alfa Hostelería SL", sepaBic: "",
    distributorId: DISTRIBUTOR_ID, assetTypeId: ASSET_TYPE_ID, productDescription: "12 portátiles", contractType: "Renting",
    signingDate: "2026-10-01", durationMonths: 36, installment: 340, residualValue: 500, purchaseValue: 10000, quantity: 3,
    hasGuarantor: false, guarantorName: "", guarantorNif: "", guarantorAddress: "", guarantorRepresentative: "", guarantorRepresentativeNif: "", notes: "",
    ...over,
  } satisfies OperationInput);

const attachment: AttachmentRowInsert = {
  contract_id: CONTRACT_ID, kind: "id_document", file_name: "dni.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: `${CONTRACT_ID}/id_document-x.pdf`,
};

/** What the company update policy decided (staff: one applied change; see update-policy.test.ts for the rules). */
const APPLIED: CompanyChange = { field: "address", kind: "change", oldValue: "Calle Vieja 9", newValue: "Calle Mayor 1", status: "applied" };
const company: CompanyWrite = { apply: { address: "Calle Mayor 1" }, changes: [APPLIED] };
const CHANGE_ROW = { field: "address", old_value: "Calle Vieja 9", new_value: "Calle Mayor 1", status: "applied" };

const createCtx = {
  id: CONTRACT_ID, companyId: "company-1", scoringId: SCORING_ID, distributorId: DISTRIBUTOR_ID, rating: "A", sector: "Retail trade",
  createdBy: "user-1", attachments: [attachment], today: "2026-10-06", company,
};

// ---------------------------------------------------------------------------
// The SQL side of the contract, read from the migration itself.
// ---------------------------------------------------------------------------
const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/** The newest migration that (re)defines the function: that definition is the live one. */
function migrationDefining(name: string): string {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().reverse()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/\r\n/g, "\n");
    if (sql.includes(`create or replace function public.${name}(`)) return sql;
  }
  throw new Error(`function ${name} not found in any migration`);
}

function sqlFunction(name: string) {
  const SQL = migrationDefining(name);
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  const header = SQL.slice(start, SQL.indexOf("language plpgsql", start));
  const body = SQL.slice(start, SQL.indexOf("\n$$;", start));
  const params = [...header.slice(header.indexOf("(") + 1, header.lastIndexOf(") returns")).matchAll(/^\s*(p_\w+)\s+(\w+)(\s+default\b)?/gm)].map((m) => ({
    name: m[1], type: m[2], optional: Boolean(m[3]),
  }));
  return { header, body, params };
}

/** Columns a statement of the function may write: "insert into public.T (...)" and "update public.T x set a = ..., b = ...". */
function writableColumns(body: string, table: string): Set<string> {
  const columns = new Set<string>();
  for (const m of body.matchAll(new RegExp(`insert into public\\.${table} \\(([^)]*)\\)`, "g"))) m[1].split(",").forEach((c) => columns.add(c.trim()));
  for (const m of body.matchAll(new RegExp(`update public\\.${table} \\w+\\s+set ([\\s\\S]*?)\\n\\s*from `, "g"))) {
    for (const assignment of m[1].matchAll(/(\w+)\s*=/g)) columns.add(assignment[1]);
  }
  for (const m of body.matchAll(/do update\s+set ([\s\S]*?);/g)) if (table === "sepa_mandates") for (const a of m[1].matchAll(/(\w+)\s*=\s*excluded/g)) columns.add(a[1]);
  return columns;
}

describe("create_draft_contract arguments", () => {
  const v = operation();
  const args = createDraftArgs(v, createCtx);

  it("sends one argument per table, built from the shared operation mappings", () => {
    expect(CREATE_DRAFT_RPC).toBe("create_draft_contract");
    expect(args.p_contract).toEqual({
      id: CONTRACT_ID, company_id: "company-1", scoring_id: SCORING_ID, distributor_id: DISTRIBUTOR_ID, rating: "A", sector: "Retail trade", created_by: "user-1",
      ...operationContractFields(v),
    });
    expect(args.p_asset).toEqual(operationAssetFields(v));
    expect(args.p_mandate).toEqual({ ...operationMandateFields(v), signed_at: "2026-10-06" });
    // The company gets only what the policy applied, and the change rows - never the typed values as such.
    expect(args.p_company).toEqual({ address: "Calle Mayor 1" });
    expect(args.p_changes).toEqual([CHANGE_ROW]);
    expect(args.p_attachments).toEqual([{ kind: "id_document", file_name: "dni.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: `${CONTRACT_ID}/id_document-x.pdf` }]);
  });

  it("is plain JSON: it survives the round trip to PostgREST unchanged", () => {
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
    expect(createDraftArgs(v, { ...createCtx, attachments: [] }).p_attachments).toEqual([]);
  });

  it("never sends a status, a contract number or a mandate reference: the function decides them", () => {
    for (const key of ["workflow_status", "contract_number", "product_type", "cancel_date", "expo_adjustment"]) expect(args.p_contract).not.toHaveProperty(key);
    expect(args.p_mandate).not.toHaveProperty("mandate_reference");
    expect(args.p_mandate).not.toHaveProperty("contract_id");
    for (const row of args.p_attachments) expect(row).not.toHaveProperty("contract_id");
  });

  it("matches the SQL signature: same parameter names, only the attachments and the changes optional", () => {
    const { params } = sqlFunction(CREATE_DRAFT_RPC);
    expect(params.map((p) => p.name).sort()).toEqual(Object.keys(args).sort());
    expect(params.every((p) => p.type === "jsonb")).toBe(true);
    expect(params.filter((p) => p.optional).map((p) => p.name)).toEqual(["p_attachments", "p_changes"]);
  });

  it("a partner's operation sends an empty company: the master is not touched", () => {
    const pending: CompanyWrite = { apply: {}, changes: [{ ...APPLIED, status: "pending" }] };
    const partner = createDraftArgs(v, { ...createCtx, company: pending });
    expect(partner.p_company).toEqual({});
    expect(partner.p_changes).toEqual([{ ...CHANGE_ROW, status: "pending" }]);
    // The contract's own snapshot still holds exactly what was typed.
    expect(partner.p_contract).toEqual(args.p_contract);
  });

  it("every key it sends is a column the function writes (nothing is silently dropped)", () => {
    // The company columns are written by apply_operation_company_changes, which the function calls.
    const body = sqlFunction(CREATE_DRAFT_RPC).body + sqlFunction("apply_operation_company_changes").body;
    const check = (keys: string[], table: string) => {
      const columns = writableColumns(body, table);
      for (const key of keys) expect(columns.has(key), `${table}.${key}`).toBe(true);
    };
    check(Object.keys(args.p_contract), "contracts");
    check(Object.keys(args.p_asset), "contract_assets");
    check(Object.keys(args.p_mandate), "sepa_mandates");
    check(Object.keys(args.p_company), "companies");
    check(Object.keys(args.p_attachments[0]), "contract_attachments");
  });

  it("the function always creates a draft, whatever it is sent", () => {
    const { body } = sqlFunction(CREATE_DRAFT_RPC);
    expect(body).toMatch(/'New', 'draft'\s*\n\s*from jsonb_populate_record\(null::public\.contracts, p_contract\)/);
    expect(body).not.toMatch(/r\.workflow_status|r\.contract_number/);
  });
});

describe("update_draft_contract arguments", () => {
  const v = operation({ durationMonths: 48, installment: 280 });
  const args = updateDraftArgs(v, { contractId: CONTRACT_ID, distributorId: null, today: "2026-10-06", company, actorId: "user-2" });

  it("sends the contract id and one argument per table, from the same mappings as creation", () => {
    expect(UPDATE_DRAFT_RPC).toBe("update_draft_contract");
    expect(args).toEqual({
      p_contract_id: CONTRACT_ID,
      p_contract: { ...operationContractFields(v), distributor_id: null },
      p_asset: operationAssetFields(v),
      p_mandate: { ...operationMandateFields(v), signed_at: "2026-10-06" },
      p_company: { address: "Calle Mayor 1" },
      p_changes: [CHANGE_ROW],
      p_actor: "user-2",
    });
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
  });

  it("stores exactly what creation stores for the same operation", () => {
    const created = createDraftArgs(v, { ...createCtx, distributorId: null });
    for (const [key, value] of Object.entries(args.p_contract)) expect(created.p_contract, key).toHaveProperty(key, value);
    expect(args.p_asset).toEqual(created.p_asset);
    expect(args.p_mandate).toEqual(created.p_mandate);
    expect(args.p_company).toEqual(created.p_company);
  });

  it("cannot move the contract to another company, scoring, creator, number or status", () => {
    for (const key of ["id", "company_id", "scoring_id", "created_by", "contract_number", "workflow_status", "rating", "sector"]) expect(args.p_contract).not.toHaveProperty(key);
    const columns = writableColumns(sqlFunction(UPDATE_DRAFT_RPC).body, "contracts");
    for (const key of ["id", "company_id", "scoring_id", "created_by", "contract_number", "workflow_status", "rating", "sector", "cancel_date"]) expect(columns.has(key), key).toBe(false);
  });

  it("matches the SQL signature and every key is a column the function writes", () => {
    const { params, body } = sqlFunction(UPDATE_DRAFT_RPC);
    expect(params.map((p) => p.name).sort()).toEqual(Object.keys(args).sort());
    expect(params.find((p) => p.name === "p_contract_id")?.type).toBe("uuid");
    expect(params.find((p) => p.name === "p_actor")?.type).toBe("uuid");
    expect(params.filter((p) => p.optional).map((p) => p.name)).toEqual(["p_changes", "p_actor"]);
    for (const key of Object.keys(args.p_contract)) expect(writableColumns(body, "contracts").has(key), key).toBe(true);
    for (const key of Object.keys(args.p_asset)) expect(writableColumns(body, "contract_assets").has(key), key).toBe(true);
    const company = sqlFunction("apply_operation_company_changes").body;
    for (const key of Object.keys(args.p_company)) expect(writableColumns(company, "companies").has(key), key).toBe(true);
  });

  it("the function only touches a draft, and keeps the mandate's reference and date on an edit", () => {
    const { body } = sqlFunction(UPDATE_DRAFT_RPC);
    expect(body).toMatch(/where c\.id = p_contract_id and c\.workflow_status = 'draft'/);
    expect(body).toMatch(/if not found then\s+return false;/);
    const onConflict = body.slice(body.indexOf("on conflict (contract_id) do update"));
    expect(onConflict.slice(0, onConflict.indexOf(";"))).not.toMatch(/signed_at|mandate_reference/);
  });
});

describe("the functions as a whole", () => {
  it("each is one plpgsql function - one transaction - with no commit or exception swallowing inside", () => {
    for (const name of [CREATE_DRAFT_RPC, UPDATE_DRAFT_RPC]) {
      const { body } = sqlFunction(name);
      expect(body).toMatch(/security invoker set search_path = ''/);
      expect(body).not.toMatch(/\bcommit\b|\bexception\s+when\b|\bsavepoint\b/i);
    }
  });

  it("only the service role may execute them", () => {
    const sql = migrationDefining(CREATE_DRAFT_RPC);
    expect(sql).toMatch(/revoke execute on function public\.create_draft_contract\(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.update_draft_contract\(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.apply_operation_company_changes\([^)]*\) from public, anon, authenticated;/);
    for (const name of [CREATE_DRAFT_RPC, UPDATE_DRAFT_RPC, "apply_operation_company_changes"]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`));
    }
    // The old signatures are dropped, so no overload that still overwrites the company remains.
    expect(sql).toContain("drop function if exists public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb);");
    expect(sql).toContain("drop function if exists public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb);");
  });
});

describe("the company side of an operation write", () => {
  const { body } = sqlFunction("apply_operation_company_changes");

  it("both writes go through it, inside their own transaction", () => {
    for (const name of [CREATE_DRAFT_RPC, UPDATE_DRAFT_RPC]) {
      const fn = sqlFunction(name).body;
      expect(fn).toMatch(/perform public\.apply_operation_company_changes\(/);
      expect(fn).not.toMatch(/update public\.companies/);
    }
    expect(body).toMatch(/security invoker set search_path = ''/);
  });

  it("writes exactly the policy's fields, each only when the policy sent it, and never when it sent {}", () => {
    const update = body.slice(body.indexOf("update public.companies c"), body.indexOf("where c.id"));
    const columns = [...update.matchAll(/^\s*(?:set\s+)?(\w+)\s*= case\b/gm)].map((m) => m[1]).sort();
    expect(columns).toEqual([...COMPANY_FIELDS].sort());
    expect(body).toMatch(/if p_company is not null and p_company <> '\{\}'::jsonb then/);
  });

  it("records the changes as source 'operation' with the contract, and never repeats a waiting pending one", () => {
    expect(body).toMatch(/'operation', p_contract_id/);
    expect(body).toMatch(/where ch\.status = 'applied'\s+or not exists \(/);
  });
});

describe("createdDraftOf", () => {
  it("reads what the function returns", () => {
    expect(createdDraftOf({ id: CONTRACT_ID, contract_number: "TCF-000042" })).toEqual({ id: CONTRACT_ID, contractNumber: "TCF-000042" });
  });

  it("is null for anything else", () => {
    for (const bad of [null, undefined, "", true, [], {}, { id: CONTRACT_ID }, { id: 1, contract_number: "x" }, { contract_number: "TCF-1" }]) expect(createdDraftOf(bad)).toBeNull();
  });
});
