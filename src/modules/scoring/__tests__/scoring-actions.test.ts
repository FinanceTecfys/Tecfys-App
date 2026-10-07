import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The scoring server actions against an in-memory database: the live preview
 * (what it returns and that it agrees with the scoring that gets stored) and
 * the ownership of the Informa report a scoring links. No real Supabase.
 */
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string; partnerDistributorId: string | null } | null,
  capabilities: [] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  writes: [] as { table: string; op: string; values: Record<string, unknown> }[],
  uploads: [] as string[],
  seq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireRole: vi.fn(async (capability: string) => {
    state.capabilities.push(capability);
    if (!state.user) throw new Error("NEXT_REDIRECT /login");
    return state.user;
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  db: () => ({
    from: (table: string) => {
      const rows = (state.tables[table] ??= []);
      const filters: [string, unknown][] = [];
      let op: "select" | "insert" | "update" | "upsert" = "select";
      let values: Row = {};
      let conflict = "id";
      const run = (): Row[] => {
        if (op === "select") return rows.filter((r) => filters.every(([c, v]) => r[c] === v));
        state.writes.push({ table, op, values });
        if (op === "update") {
          const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          hit.forEach((r) => Object.assign(r, values));
          return hit;
        }
        const existing = op === "upsert" ? rows.find((r) => r[conflict] === values[conflict]) : undefined;
        if (existing) return [Object.assign(existing, values)];
        const row = { id: `${table}-${++state.seq}`, ...values };
        rows.push(row);
        return [row];
      };
      const one = async () => ({ data: run()[0] ?? null, error: null });
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        insert: (v: Row) => ((op = "insert"), (values = v), query),
        update: (v: Row) => ((op = "update"), (values = v), query),
        upsert: (v: Row, options?: { onConflict?: string }) => ((op = "upsert"), (values = v), (conflict = options?.onConflict ?? "id"), query),
        maybeSingle: one,
        single: one,
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
      };
      return query;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploads.push(path);
          return { error: null };
        },
      }),
    },
  }),
}));
vi.mock("@/modules/scoring/informa/server", () => ({
  isInformaConfigured: () => true,
  informaConfigStatus: () => ({ baseUrlAllowed: true, hasUsername: true, hasPassword: true }),
  appInformaClient: () => ({ getReport: async () => ({ raw: "report" }), ping: async () => undefined }),
}));
vi.mock("@/modules/scoring/informa/extract-pdf-text", () => ({ extractInformaText: async () => "texto del informe" }));
vi.mock("@/modules/scoring/informa/parse-informa-text", async () => {
  const { EMPTY_FINANCIALS } = await import("@/modules/scoring/domain/financials");
  return { parseInformaText: () => ({ financials: { ...EMPTY_FINANCIALS, cif: "B12345678", name: "Alfa SL", totalRevenue: 1000 }, missing: [] }) };
});
vi.mock("@/modules/scoring/informa/map-informa-report", async (original) => {
  const actual = await original<typeof import("@/modules/scoring/informa/map-informa-report")>();
  const { EMPTY_FINANCIALS } = await import("@/modules/scoring/domain/financials");
  return {
    ...actual,
    mapInformaReport: () => ({ reportType: "INFORME_MAYOR", financials: { ...EMPTY_FINANCIALS, cif: "B12345678", name: "Alfa SL" }, missing: [], warnings: [], status: {}, risk: {} }),
  };
});

import { createScoring, fetchInformaReport, parseInformaPdf, previewScoring } from "../actions";
import { DEFAULT_CRITERIA, type ScoringCriteria } from "../domain/criteria";
import { EMPTY_FINANCIALS, type Financials } from "../domain/financials";

const OWNER = { id: "user-owner", role: "owner", partnerDistributorId: null };
const ADMIN = { id: "user-admin", role: "admin", partnerDistributorId: null };
const SALES = { id: "user-sales", role: "sales", partnerDistributorId: null };
const PARTNER = { id: "user-partner", role: "partner", partnerDistributorId: "dist-1" };
const OTHER_PARTNER = { id: "user-partner-2", role: "partner", partnerDistributorId: "dist-2" };

const OWN_REPORT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHERS_REPORT = "0b0e7a3c-1b1d-4c57-9b0e-3f6a1f0c2d11";
const LEGACY_REPORT = "5d3c2b1a-9f8e-4d7c-8b6a-1a2b3c4d5e6f";
const STAFF_REPORT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const company = (over: Partial<Financials> = {}): Financials => ({
  ...EMPTY_FINANCIALS,
  cif: "b-12.345.678", name: "Alfa SL", sector: "Information technology", maturityYears: 12,
  totalRevenue: 2_000_000, grossMargin: 900_000, procurement: 1_100_000, ebitda: 300_000, netResult: 150_000,
  nonCurrentAssets: 800_000, currentAssets: 700_000, equity: 900_000, nonCurrentLiabilities: 250_000, currentLiabilities: 350_000,
  receivables: 300_000, payables: 180_000,
  ...over,
});

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const writesTo = (table: string) => state.writes.filter((w) => w.table === table);
const storedScoring = () => writesTo("scorings").at(-1)?.values;

/** createScoring redirects on success; anything it returns is a failure. */
async function save(input: Parameters<typeof createScoring>[0]) {
  try {
    return { redirected: null, result: await createScoring(input) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!message.startsWith("NEXT_REDIRECT ")) throw e;
    return { redirected: message.slice("NEXT_REDIRECT ".length), result: null };
  }
}

beforeEach(() => {
  state.user = OWNER;
  state.capabilities = [];
  state.writes = [];
  state.uploads = [];
  state.seq = 0;
  state.tables = {
    scoring_criteria: [],
    companies: [],
    scorings: [],
    informa_reports: [
      { id: OWN_REPORT, created_by: PARTNER.id, company_id: null },
      { id: OTHERS_REPORT, created_by: OTHER_PARTNER.id, company_id: null },
      { id: LEGACY_REPORT, created_by: null, company_id: null },
      { id: STAFF_REPORT, created_by: SALES.id, company_id: null },
    ],
  };
});

describe("previewScoring", () => {
  const MODEL_KEYS = ["weight", "weights", "ratingScore", "tiers", "scoreTable", "scoreBuckets", "decisionRules", "sectorRating", "ratios", "direction", "breakdown", "criteria", "config"];

  it("asks for scoring.run, and stores nothing", async () => {
    const res = await previewScoring(company());
    expect(res.ok).toBe(true);
    expect(state.capabilities).toEqual(["scoring.run"]);
    expect(state.writes).toEqual([]);

    state.user = null;
    await expect(previewScoring(company())).rejects.toThrow("NEXT_REDIRECT");
  });

  it("returns the result without the model configuration - for a partner and for the owner alike", async () => {
    for (const user of [PARTNER, SALES, OWNER]) {
      state.user = user;
      const res = await previewScoring(company());
      if (!res.ok) throw new Error(res.error);
      // Exactly what goes over the network: the serialised return value.
      const payload = JSON.stringify(res);
      for (const key of MODEL_KEYS) expect(payload, `${user.role}: ${key}`).not.toContain(`"${key}"`);
      expect(Object.keys(res.preview).sort()).toEqual(["adjustedEbitda", "creditOpinion", "decision", "prudence", "rating", "rows", "totalScore"]);
      for (const row of res.preview.rows) expect(Object.keys(row).sort()).toEqual(["contribution", "formula", "key", "label", "rating", "value"]);
      // The other sectors and their ratings are not in it either.
      expect(payload).not.toContain("Pharmaceuticals and biotechnology");
      expect(payload).not.toMatch(/\[\s*"(AAA|AA|A|BBB|BB|CCC|CC|C)"\s*,/);
    }
  });

  it("scores the empty form, and refuses values that are not numbers", async () => {
    expect((await previewScoring(EMPTY_FINANCIALS)).ok).toBe(true);
    expect(await previewScoring({ ...company(), totalRevenue: Number.NaN })).toEqual({ ok: false, error: "Hay datos financieros no válidos" });
    expect((await previewScoring({ ...company(), equity: "900000" } as unknown as Financials)).ok).toBe(false);
  });

  it("matches the authoritative createScoring computation for the same inputs", async () => {
    for (const financials of [
      company(),
      company({ netResult: -200_000, equity: 50_000, currentLiabilities: 900_000, sector: "Catering", maturityYears: 1 }),
      company({ sector: null, adjustedEbitda: 420_000 }),
      company({ ebitda: null, totalRevenue: null }),
    ]) {
      const res = await previewScoring(financials);
      if (!res.ok) throw new Error(res.error);
      const { preview } = res;

      const { redirected } = await save({ financials });
      expect(redirected).toMatch(/^\/scoring\//);
      const stored = storedScoring()!;
      expect(stored.total_score).toBe(round(preview.totalScore, 3));
      expect(stored.rating).toBe(preview.rating);
      expect(stored.decision).toBe(preview.decision);
      expect(stored.prudence).toBe(preview.prudence);
      expect(stored.adjusted_ebitda).toBe(preview.adjustedEbitda);
      expect(stored.credit_opinion).toBe(round(preview.creditOpinion, 2));
      const breakdown = stored.breakdown as Record<string, { rating: string; contribution: number; value: unknown }>;
      expect(Object.keys(breakdown).sort()).toEqual(preview.rows.map((r) => r.key).sort());
      for (const row of preview.rows) {
        expect({ rating: breakdown[row.key].rating, contribution: breakdown[row.key].contribution, value: breakdown[row.key].value }).toEqual({
          rating: row.rating, contribution: row.contribution, value: row.value,
        });
      }
    }
  });

  it("uses the active model of the database, the same one createScoring snapshots", async () => {
    const active: ScoringCriteria = {
      ...DEFAULT_CRITERIA,
      decisionRules: { ...DEFAULT_CRITERIA.decisionRules, AAA: "manual", AA: "manual", A: "manual", BBB: "manual" },
    };
    state.tables.scoring_criteria.push({ id: "criteria-7", version: 7, is_active: true, config: active });
    const res = await previewScoring(company());
    if (!res.ok) throw new Error(res.error);
    expect(res.preview.decision).toBe("manual");

    await save({ financials: company() });
    expect(storedScoring()).toMatchObject({ decision: "manual", status: "pending_review", criteria_id: "criteria-7", rating: res.preview.rating });
  });
});

describe("createScoring: ownership of the linked Informa report", () => {
  const link = (reportId: string | null) => save({ financials: company(), informaReportId: reportId });

  it("a partner links a report it created", async () => {
    state.user = PARTNER;
    const { redirected } = await link(OWN_REPORT);
    expect(redirected).toMatch(/^\/scoring\//);
    expect(storedScoring()).toMatchObject({ informa_report_id: OWN_REPORT, created_by: PARTNER.id });
    // The report is attached to the company it was scored for.
    expect(state.tables.informa_reports.find((r) => r.id === OWN_REPORT)?.company_id).toBe(state.tables.companies[0].id);
  });

  it("a partner cannot link another user's report: rejected as not found, nothing written", async () => {
    state.user = PARTNER;
    for (const foreign of [OTHERS_REPORT, STAFF_REPORT]) {
      const { redirected, result } = await link(foreign);
      expect(redirected).toBeNull();
      expect(result).toEqual({ ok: false, error: "Informe de Informa no encontrado" });
    }
    expect(state.writes).toEqual([]);
    expect(state.tables.scorings).toEqual([]);
    expect(state.tables.companies).toEqual([]);
    expect(state.tables.informa_reports.every((r) => r.company_id === null)).toBe(true);
  });

  it("a legacy report with no owner is Tecfys's: staff link it, a partner does not", async () => {
    for (const user of [OWNER, ADMIN, SALES]) {
      state.user = user;
      const { redirected } = await link(LEGACY_REPORT);
      expect(redirected, user.role).toMatch(/^\/scoring\//);
      expect(storedScoring()).toMatchObject({ informa_report_id: LEGACY_REPORT, created_by: user.id });
    }
    state.user = PARTNER;
    state.writes = [];
    expect((await link(LEGACY_REPORT)).result).toEqual({ ok: false, error: "Informe de Informa no encontrado" });
    expect(state.writes).toEqual([]);
  });

  it("staff keep linking any report, whoever created it", async () => {
    for (const user of [OWNER, ADMIN, SALES]) {
      for (const report of [OWN_REPORT, OTHERS_REPORT, STAFF_REPORT]) {
        state.user = user;
        const { redirected } = await link(report);
        expect(redirected, `${user.role} ${report}`).toMatch(/^\/scoring\//);
        expect(storedScoring()).toMatchObject({ informa_report_id: report });
      }
    }
  });

  it("an id that does not exist or is not a uuid is rejected the same way, for everyone", async () => {
    for (const user of [OWNER, PARTNER]) {
      state.user = user;
      state.writes = [];
      for (const bad of ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "not-a-uuid", `${OWN_REPORT}' or 1=1`]) {
        expect((await link(bad)).result, `${user.role} ${bad}`).toEqual({ ok: false, error: "Informe de Informa no encontrado" });
      }
      expect(state.writes).toEqual([]);
    }
  });

  it("a scoring without a report (manual entry) is unaffected", async () => {
    state.user = PARTNER;
    for (const none of [null, undefined, ""]) {
      const { redirected } = await save({ financials: company(), informaReportId: none });
      expect(redirected).toMatch(/^\/scoring\//);
      expect(storedScoring()).toMatchObject({ informa_report_id: null, created_by: PARTNER.id });
    }
    expect(writesTo("informa_reports")).toEqual([]);
  });

  it("still validates the financials first", async () => {
    state.user = PARTNER;
    const { result } = await save({ financials: company({ cif: "", name: "" }), informaReportId: OTHERS_REPORT });
    expect(result).toMatchObject({ ok: false, error: "Revisa los datos marcados", fieldErrors: { cif: "CIF obligatorio", name: "Razón social obligatoria" } });
  });
});

describe("a report belongs to whoever created it", () => {
  it("the API path stores the user that fetched it, and that user can then link it", async () => {
    state.user = PARTNER;
    const res = await fetchInformaReport("B12345678");
    if (!res.ok) throw new Error(res.error);
    expect(writesTo("informa_reports").at(-1)?.values).toMatchObject({ source: "informa_api", created_by: PARTNER.id });

    expect((await save({ financials: company(), informaReportId: null })).redirected).toMatch(/^\/scoring\//);
    const created = state.tables.informa_reports.find((r) => r.id === res.reportId)!;
    expect(created.created_by).toBe(PARTNER.id);
    // Linking goes by uuid; the in-memory ids are not uuids, so check the scope rule on the stored row directly.
    state.user = OTHER_PARTNER;
    created.id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect((await save({ financials: company(), informaReportId: created.id as string })).result).toEqual({ ok: false, error: "Informe de Informa no encontrado" });
    state.user = PARTNER;
    expect((await save({ financials: company(), informaReportId: created.id as string })).redirected).toMatch(/^\/scoring\//);
  });

  it("the PDF path stores the user that uploaded it", async () => {
    state.user = SALES;
    const form = new FormData();
    form.set("pdf", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "informe.pdf", { type: "application/pdf" }));
    const res = await parseInformaPdf(form);
    expect(res.ok).toBe(true);
    expect(writesTo("informa_reports").at(-1)?.values).toMatchObject({ source: "informa_pdf", file_name: "informe.pdf", created_by: SALES.id });
    expect(state.uploads).toHaveLength(1);
  });
});
