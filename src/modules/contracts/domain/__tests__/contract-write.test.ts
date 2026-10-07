import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AttachmentRowInsert } from "../attachments";
import { CREATE_DRAFT_RPC, createDraftArgs, createdDraftOf, UPDATE_DRAFT_RPC, updateDraftArgs } from "../contract-write";
import { operationAssetFields, operationCompanyFields, operationContractFields, type OperationInput, operationMandateFields, operationSchema } from "../operation";

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

const createCtx = {
  id: CONTRACT_ID, companyId: "company-1", scoringId: SCORING_ID, distributorId: DISTRIBUTOR_ID, rating: "A", sector: "Retail trade",
  createdBy: "user-1", attachments: [attachment], today: "2026-10-06",
};

// ---------------------------------------------------------------------------
// The SQL side of the contract, read from the migration itself.
// ---------------------------------------------------------------------------
const SQL = readFileSync(path.join(process.cwd(), "supabase", "migrations", "20261001000000_atomic_contract_writes.sql"), "utf8").replace(/\r\n/g, "\n");

function sqlFunction(name: string) {
  const start = SQL.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in the migration`);
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
    expect(args.p_company).toEqual(operationCompanyFields(v));
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

  it("matches the SQL signature: same parameter names, only the attachments optional", () => {
    const { params } = sqlFunction(CREATE_DRAFT_RPC);
    expect(params.map((p) => p.name).sort()).toEqual(Object.keys(args).sort());
    expect(params.every((p) => p.type === "jsonb")).toBe(true);
    expect(params.filter((p) => p.optional).map((p) => p.name)).toEqual(["p_attachments"]);
  });

  it("every key it sends is a column the function writes (nothing is silently dropped)", () => {
    const { body } = sqlFunction(CREATE_DRAFT_RPC);
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
  const args = updateDraftArgs(v, { contractId: CONTRACT_ID, distributorId: null, today: "2026-10-06" });

  it("sends the contract id and one argument per table, from the same mappings as creation", () => {
    expect(UPDATE_DRAFT_RPC).toBe("update_draft_contract");
    expect(args).toEqual({
      p_contract_id: CONTRACT_ID,
      p_contract: { ...operationContractFields(v), distributor_id: null },
      p_asset: operationAssetFields(v),
      p_mandate: { ...operationMandateFields(v), signed_at: "2026-10-06" },
      p_company: operationCompanyFields(v),
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
    expect(params.some((p) => p.optional)).toBe(false);
    for (const key of Object.keys(args.p_contract)) expect(writableColumns(body, "contracts").has(key), key).toBe(true);
    for (const key of Object.keys(args.p_asset)) expect(writableColumns(body, "contract_assets").has(key), key).toBe(true);
    for (const key of Object.keys(args.p_company)) expect(writableColumns(body, "companies").has(key), key).toBe(true);
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
    expect(SQL).toMatch(/revoke execute on function public\.create_draft_contract\(jsonb, jsonb, jsonb, jsonb, jsonb\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/revoke execute on function public\.update_draft_contract\(uuid, jsonb, jsonb, jsonb, jsonb\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.create_draft_contract\([^)]*\) to service_role;/);
    expect(SQL).toMatch(/grant execute on function public\.update_draft_contract\([^)]*\) to service_role;/);
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
