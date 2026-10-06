import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The download route end to end - guard, scope, lookup, streaming - with the
 * database and the private bucket mocked: no real Supabase, no real bucket.
 */
const state = vi.hoisted(() => ({
  user: null as { id: string; role: string; partnerDistributorId: string | null } | null,
  capabilities: [] as string[],
  rows: [] as Record<string, unknown>[],
  objects: new Map<string, Blob>(),
  downloads: [] as string[],
  queries: 0,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/auth", () => ({
  requireRole: vi.fn(async (capability: string) => {
    state.capabilities.push(capability);
    // The real guard redirects (throws) without a session or the capability.
    if (!state.user) throw new Error("NEXT_REDIRECT /login");
    return state.user;
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  db: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          state.queries++;
          if (table !== "contract_attachments") return { data: null, error: { message: `unexpected table ${table}` } };
          return { data: state.rows.find((row) => filters.every(([column, value]) => row[column] === value)) ?? null, error: null };
        },
      };
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          state.downloads.push(`${bucket}/${path}`);
          const blob = state.objects.get(path);
          return blob ? { data: blob, error: null } : { data: null, error: { message: "Object not found" } };
        },
      }),
    },
  }),
}));

import { GET } from "@/app/(app)/contracts/[id]/attachments/[kind]/route";

const CONTRACT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_ID = "0b0e7a3c-1b1d-4c57-9b0e-3f6a1f0c2d11";
const PDF = new Uint8Array([..."%PDF-1.7 signed contract"].map((c) => c.charCodeAt(0)));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const OWNER = { id: "user-owner", role: "owner", partnerDistributorId: null };
const SALES = { id: "user-sales", role: "sales", partnerDistributorId: null };
const PARTNER = { id: "user-partner", role: "partner", partnerDistributorId: "dist-1" };
const OTHER_PARTNER = { id: "user-partner-2", role: "partner", partnerDistributorId: "dist-2" };

function attachment(contractId: string, kind: string, mime: string, createdBy: string | null, contractNumber: string) {
  return {
    contract_id: contractId,
    kind,
    file_name: `original ${kind}`,
    mime_type: mime,
    size_bytes: 10,
    storage_path: `${contractId}/${kind}-secret-key`,
    contract: { contract_number: contractNumber, created_by: createdBy },
  };
}

const get = (id: string, kind: string) =>
  GET(new Request(`http://localhost/contracts/${id}/attachments/${kind}`) as never, { params: Promise.resolve({ id, kind }) });

beforeEach(() => {
  state.user = OWNER;
  state.capabilities = [];
  state.downloads = [];
  state.queries = 0;
  // An app-created contract of PARTNER, and an imported loan-book contract (no creator).
  state.rows = [
    attachment(CONTRACT_ID, "contract", "application/pdf", PARTNER.id, "TCF-000042"),
    attachment(CONTRACT_ID, "id_document", "image/png", PARTNER.id, "TCF-000042"),
    attachment(OTHER_ID, "contract", "application/pdf", null, "LB-16535"),
    attachment(OTHER_ID, "extra", "application/pdf", null, "LB-16535"),
  ];
  state.objects = new Map<string, Blob>([
    [`${CONTRACT_ID}/contract-secret-key`, new Blob([PDF])],
    [`${CONTRACT_ID}/id_document-secret-key`, new Blob([PNG])],
    [`${OTHER_ID}/contract-secret-key`, new Blob([PDF])],
    [`${OTHER_ID}/extra-secret-key`, new Blob([PDF])],
  ]);
});

describe("GET /contracts/[id]/attachments/[kind]", () => {
  it("asks for the contract.view capability before anything else", async () => {
    await get(CONTRACT_ID, "contract");
    expect(state.capabilities).toEqual(["contract.view"]);

    state.user = null;
    state.queries = 0;
    state.downloads = [];
    await expect(get(CONTRACT_ID, "contract")).rejects.toThrow("NEXT_REDIRECT");
    expect(state.queries).toBe(0);
    expect(state.downloads).toEqual([]);
  });

  it("streams each of the four kinds from the private bucket, as a download", async () => {
    const res = await get(CONTRACT_ID, "contract");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="Contrato_firmado_TCF-000042.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.body).toBeInstanceOf(ReadableStream);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    expect(state.downloads).toEqual([`contract-attachments/${CONTRACT_ID}/contract-secret-key`]);
    // Streamed through the server: no redirect and no storage path handed to the browser.
    expect(res.headers.get("Location")).toBeNull();
    expect([...res.headers.values()].join(" ")).not.toContain("secret-key");

    const id = await get(CONTRACT_ID, "id_document");
    expect(id.headers.get("Content-Disposition")).toBe('attachment; filename="DNI_firmante_TCF-000042.png"');
    expect(new Uint8Array(await id.arrayBuffer())).toEqual(PNG);
  });

  it("serves the documents of an imported loan-book contract to the Tecfys roles", async () => {
    for (const user of [OWNER, SALES]) {
      state.user = user;
      const contract = await get(OTHER_ID, "contract");
      expect(contract.status, user.role).toBe(200);
      expect(contract.headers.get("Content-Disposition")).toBe('attachment; filename="Contrato_firmado_LB-16535.pdf"');
      const extra = await get(OTHER_ID, "extra");
      expect(extra.headers.get("Content-Disposition")).toBe('attachment; filename="Anexo_LB-16535.pdf"');
    }
  });

  it("lets a partner download only the documents of its own contracts", async () => {
    state.user = PARTNER;
    expect((await get(CONTRACT_ID, "contract")).status).toBe(200);

    // Another partner's contract, and a loan-book contract with no creator: not found, bucket untouched.
    state.downloads = [];
    expect((await get(OTHER_ID, "contract")).status).toBe(404);
    state.user = OTHER_PARTNER;
    for (const [id, kind] of [[CONTRACT_ID, "contract"], [CONTRACT_ID, "id_document"], [OTHER_ID, "extra"]]) {
      const res = await get(id, kind);
      expect(res.status, `${id}/${kind}`).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
    expect(state.downloads).toEqual([]);
  });

  it("404s an empty slot, an unknown kind and a malformed id without reading the bucket", async () => {
    state.downloads = [];
    expect((await get(CONTRACT_ID, "bank_certificate")).status).toBe(404);
    state.queries = 0;
    for (const [id, kind] of [[CONTRACT_ID, "passport"], [CONTRACT_ID, "toString"], ["not-a-uuid", "contract"], [`${CONTRACT_ID}/..`, "contract"]]) {
      expect((await get(id, kind)).status, `${id}/${kind}`).toBe(404);
    }
    expect(state.queries).toBe(0);
    expect(state.downloads).toEqual([]);
  });

  it("502s when the row exists but the bucket cannot return the object", async () => {
    state.objects.clear();
    const res = await get(CONTRACT_ID, "contract");
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret-key");
  });
});
