import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * createContract and updateDraftContract against a mocked database: each must
 * do its whole multi-row write through ONE call to its database function, so
 * there is no sequence of writes that can stop half-way. (That the function
 * itself is one transaction is Postgres's guarantee, exercised by the
 * migration's dry-run; here the action's side of it is pinned down.)
 */
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string; partnerDistributorId: string | null } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /** Every write that is not an RPC: there must be none. */
  tableWrites: [] as { table: string; op: string }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpc: null as null | ((name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }),
  bucket: new Map<string, number>(),
  removed: [] as string[],
  uploadError: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireRole: vi.fn(async () => {
    if (!state.user) throw new Error("NEXT_REDIRECT /login");
    return state.user;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  db: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const read = async () => ({ data: (state.tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null });
      const write = (op: string) => () => {
        state.tableWrites.push({ table, op });
        return query;
      };
      const query: Row = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push([column, value]), query),
        in: () => query,
        maybeSingle: read,
        single: read,
        insert: write("insert"),
        update: write("update"),
        upsert: write("upsert"),
        delete: write("delete"),
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
      };
      return query;
    },
    rpc: async (name: string, args: Row) => {
      state.rpcCalls.push({ name, args });
      return state.rpc!(name, args);
    },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (state.uploadError) return { error: { message: state.uploadError } };
          state.bucket.set(path, bytes.length);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) {
            state.bucket.delete(p);
            state.removed.push(p);
          }
          return { error: null };
        },
      }),
    },
  }),
}));

import { createContract, updateDraftContract } from "../actions";
import type { OperationInput } from "../domain/operation";

const SCORING_ID = "0b0e7a3c-1b1d-4c57-9b0e-3f6a1f0c2d11";
const CONTRACT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ASSET_TYPE_ID = "5d3c2b1a-9f8e-4d7c-8b6a-1a2b3c4d5e6f";
const DISTRIBUTOR_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const OWNER = { id: "user-owner", role: "owner", partnerDistributorId: null };
const PARTNER = { id: "user-partner", role: "partner", partnerDistributorId: "dist-partner" };
const OTHER_PARTNER = { id: "user-partner-2", role: "partner", partnerDistributorId: "dist-2" };

const input = (over: Partial<OperationInput> = {}): OperationInput => ({
  scoringId: SCORING_ID,
  clientName: "Alfa Hostelería SL", clientCif: "B12345678", fiscalAddress: "Calle Mayor 1", fiscalPostalCode: "28013", fiscalCity: "Madrid",
  fiscalProvince: "Madrid", signatoryName: "Ana Pérez", signatoryNif: "12345678Z", signatoryAddress: "", contactName: "Ana Pérez",
  contactPhone: "600 000 000", contactEmail: "ana@alfa.example", deliverySameAsFiscal: true, deliveryAddress: "",
  sepaIban: "ES91 2100 0418 4502 0005 1332", sepaDebtorName: "Alfa Hostelería SL", sepaBic: "",
  distributorId: DISTRIBUTOR_ID, assetTypeId: ASSET_TYPE_ID, productDescription: "12 portátiles", contractType: "Renting",
  signingDate: "2026-10-01", durationMonths: 36, installment: 340, residualValue: 500, purchaseValue: 10000, quantity: 3,
  hasGuarantor: false, guarantorName: "", guarantorNif: "", guarantorAddress: "", guarantorRepresentative: "", guarantorRepresentativeNif: "", notes: "",
  ...over,
});

const PDF = new Uint8Array([..."%PDF-1.7 documento"].map((c) => c.charCodeAt(0)));
function files() {
  const form = new FormData();
  form.set("id_document", new File([PDF], "dni.pdf", { type: "application/pdf" }));
  form.set("bank_certificate", new File([PDF], "certificado.pdf", { type: "application/pdf" }));
  return form;
}

/** Both actions redirect on success; anything they return is a failure. */
async function run<T>(action: () => Promise<T>) {
  try {
    return { redirected: null as string | null, result: await action() };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.startsWith("NEXT_REDIRECT ")) throw e;
    return { redirected: message.slice("NEXT_REDIRECT ".length), result: null };
  }
}

beforeEach(() => {
  state.user = OWNER;
  state.tableWrites = [];
  state.rpcCalls = [];
  state.bucket = new Map();
  state.removed = [];
  state.uploadError = null;
  state.tables = {
    scorings: [{ id: SCORING_ID, status: "approved", rating: "A", created_by: PARTNER.id, company: { id: "company-1", sector: "Retail trade" } }],
    contracts: [{ id: CONTRACT_ID, workflow_status: "draft", created_by: PARTNER.id, scoring_id: SCORING_ID }],
  };
  state.rpc = (name, args) =>
    name === "create_draft_contract"
      ? { data: { id: (args.p_contract as Row).id, contract_number: "TCF-000042" }, error: null }
      : { data: true, error: null };
});

describe("createContract writes everything in one database call", () => {
  it("happy path: one RPC with the contract, asset, mandate, company and attachment rows; no other write", async () => {
    const { redirected } = await run(() => createContract(input(), files()));
    expect(state.rpcCalls).toHaveLength(1);
    const { name, args } = state.rpcCalls[0];
    expect(name).toBe("create_draft_contract");
    expect(Object.keys(args).sort()).toEqual(["p_asset", "p_attachments", "p_company", "p_contract", "p_mandate"]);
    expect(state.tableWrites).toEqual([]);

    const contract = args.p_contract as Row;
    expect(contract).toMatchObject({
      company_id: "company-1", scoring_id: SCORING_ID, distributor_id: DISTRIBUTOR_ID, rating: "A", sector: "Retail trade", created_by: OWNER.id,
      duration_months: 36, installment: 340, residual_value: 500, purchase_value: 10000, client_cif: "B12345678",
    });
    expect(args.p_asset).toMatchObject({ quantity: 3, unit_cost: 3333.33 });
    expect(args.p_mandate).toMatchObject({ iban: "ES9121000418450200051332", debtor_name: "Alfa Hostelería SL" });
    expect(args.p_company).toMatchObject({ address: "Calle Mayor 1", admin_nif: "12345678Z" });

    // The files are stored under the id the contract is created with, and the rows point at them.
    const attachments = args.p_attachments as Row[];
    expect(attachments.map((a) => a.kind)).toEqual(["id_document", "bank_certificate"]);
    expect([...state.bucket.keys()].sort()).toEqual(attachments.map((a) => a.storage_path as string).sort());
    for (const a of attachments) expect(a.storage_path as string).toMatch(new RegExp(`^${contract.id}/${a.kind}-`));
    expect(redirected).toBe(`/contracts/${contract.id}`);
    expect(state.removed).toEqual([]);
  });

  it("a failure of the write leaves nothing: no row written by the action, and the uploaded files removed", async () => {
    state.rpc = () => ({ data: null, error: { message: 'new row for relation "sepa_mandates" violates check constraint' } });
    const { redirected, result } = await run(() => createContract(input(), files()));
    expect(redirected).toBeNull();
    expect(result).toEqual({ ok: false, error: 'new row for relation "sepa_mandates" violates check constraint' });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.tableWrites).toEqual([]);
    expect(state.removed).toHaveLength(2);
    expect(state.bucket.size).toBe(0);
  });

  it("a failed upload stops before the database is touched, and removes what was already uploaded", async () => {
    state.uploadError = "bucket unavailable";
    const { result } = await run(() => createContract(input(), files()));
    expect(result).toEqual({ ok: false, error: "No se pudo guardar el adjunto: bucket unavailable" });
    expect(state.rpcCalls).toEqual([]);
    expect(state.tableWrites).toEqual([]);
    expect(state.bucket.size).toBe(0);
  });

  it("validation and the scoring checks are unchanged, and run before any write", async () => {
    expect((await run(() => createContract(input({ sepaIban: "ES00", installment: 0 })))).result).toMatchObject({ ok: false, error: "Revisa los datos marcados", fieldErrors: { installment: "La cuota debe ser positiva" } });

    state.user = OTHER_PARTNER;
    expect((await run(() => createContract(input()))).result).toEqual({ ok: false, error: "Scoring no encontrado" });

    state.user = OWNER;
    state.tables.scorings[0].status = "pending_review";
    expect((await run(() => createContract(input()))).result).toEqual({ ok: false, error: "El scoring no está aprobado" });

    expect(state.rpcCalls).toEqual([]);
    expect(state.tableWrites).toEqual([]);
    expect(state.bucket.size).toBe(0);
  });

  it("a partner always originates for its own distributor", async () => {
    state.user = PARTNER;
    await run(() => createContract(input()));
    expect(state.rpcCalls[0].args.p_contract).toMatchObject({ distributor_id: "dist-partner", created_by: PARTNER.id });
  });
});

describe("updateDraftContract writes everything in one database call", () => {
  const edit = (over: Partial<OperationInput> = {}, id = CONTRACT_ID) => run(() => updateDraftContract(id, input(over)));

  it("happy path: one RPC with the edited terms; no other write", async () => {
    const { redirected } = await edit({ durationMonths: 48, installment: 280, purchaseValue: 11000, quantity: 5 });
    expect(redirected).toBe(`/contracts/${CONTRACT_ID}`);
    expect(state.rpcCalls).toHaveLength(1);
    const { name, args } = state.rpcCalls[0];
    expect(name).toBe("update_draft_contract");
    expect(Object.keys(args).sort()).toEqual(["p_asset", "p_company", "p_contract", "p_contract_id", "p_mandate"]);
    expect(args.p_contract_id).toBe(CONTRACT_ID);
    expect(args.p_contract).toMatchObject({ duration_months: 48, installment: 280, purchase_value: 11000, distributor_id: DISTRIBUTOR_ID });
    expect(args.p_asset).toMatchObject({ quantity: 5, unit_cost: 2200 });
    for (const key of ["company_id", "scoring_id", "created_by", "workflow_status", "contract_number"]) expect(args.p_contract).not.toHaveProperty(key);
    expect(state.tableWrites).toEqual([]);
  });

  it("a forced failure mid-write: the action has written nothing else, so nothing is half-updated", async () => {
    state.rpc = () => ({ data: null, error: { message: 'new row for relation "sepa_mandates" violates check constraint "sepa_mandates_iban_check"' } });
    const { redirected, result } = await edit({ installment: 999 });
    expect(redirected).toBeNull();
    expect(result).toEqual({ ok: false, error: 'new row for relation "sepa_mandates" violates check constraint "sepa_mandates_iban_check"' });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.tableWrites).toEqual([]);
  });

  it("a draft signed in the meantime: the function writes nothing and says so", async () => {
    state.rpc = () => ({ data: false, error: null });
    expect((await edit()).result).toEqual({ ok: false, error: "El contrato ya no está en borrador" });
    expect(state.tableWrites).toEqual([]);
  });

  it("the guards are unchanged and run before the write", async () => {
    expect((await edit({ durationMonths: 0 })).result).toMatchObject({ ok: false, error: "Revisa los datos marcados" });
    expect((await edit({}, "not-a-uuid")).result).toEqual({ ok: false, error: "Contrato no encontrado" });

    state.user = OTHER_PARTNER;
    expect((await edit()).result).toEqual({ ok: false, error: "Contrato no encontrado" });

    state.user = OWNER;
    expect((await edit({ scoringId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" })).result).toEqual({ ok: false, error: "El scoring no corresponde a este contrato" });

    for (const status of ["pending_signature", "signed", "cancelled"]) {
      state.tables.contracts[0].workflow_status = status;
      expect((await edit()).result, status).toEqual({ ok: false, error: "Solo se puede editar un contrato en borrador" });
    }
    expect(state.rpcCalls).toEqual([]);
    expect(state.tableWrites).toEqual([]);
  });

  it("a partner edits its own draft, which stays with its own distributor", async () => {
    state.user = PARTNER;
    expect((await edit()).redirected).toBe(`/contracts/${CONTRACT_ID}`);
    expect(state.rpcCalls[0].args.p_contract).toMatchObject({ distributor_id: "dist-partner" });
  });
});
