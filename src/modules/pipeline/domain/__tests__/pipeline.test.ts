import { describe, expect, it } from "vitest";
import {
  activePartners,
  activityByPartner,
  buildPipelineRows,
  filterPipeline,
  hasPipelineFilters,
  NO_PARTNER_KEY,
  NO_PARTNER_LABEL,
  originatorLabel,
  parsePipelineQuery,
  type PipelineContract,
  pipelineFilterOptions,
  type PipelineScoring,
  pipelineSearch,
  pipelineTotals,
  type PipelineUser,
  resolveOriginator,
  scoringsByPartner,
  scoringsByStatus,
  weeklyActivity,
} from "../pipeline";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const SALES = "33333333-3333-4333-8333-333333333333";
const GONE = "99999999-9999-4999-8999-999999999999";

const USERS: PipelineUser[] = [
  { id: P1, email: "ana@alfa.es", role: "partner", distributor: { id: "d-alfa", name: "Alfa Distribución" } },
  { id: P2, email: "luis@beta.es", role: "partner", distributor: { id: "d-beta", name: "Beta Tech" } },
  { id: SALES, email: "ventas@tecfys.com", role: "sales", distributor: null },
];

const scoring = (id: string, createdBy: string | null, status: string, createdAt: string, company = `Empresa ${id}`, sector: string | null = "Hostelería"): PipelineScoring => ({
  id,
  status,
  rating: status === "rejected" ? "CCC" : "A",
  totalScore: status === "rejected" ? 3.2 : 7.5,
  createdAt,
  createdBy,
  company: { name: company, cif: `B0000000${id.slice(-1)}`, sector },
});

const op = (id: string, scoringId: string, workflowStatus: string, createdAt: string, distributorName: string | null = null): PipelineContract => ({
  id,
  contractNumber: `TCF-${id}`,
  scoringId,
  workflowStatus,
  createdAt,
  distributorName,
  hasSignatureRequest: false,
});

// Monday 2026-10-05 is "now": s1..s7 spread over the previous weeks.
const NOW = new Date("2026-10-07T12:00:00Z");
const SCORINGS: PipelineScoring[] = [
  scoring("s1", P1, "approved", "2026-10-05T09:00:00+00:00", "Construcción Núñez SL", "Construcción"),
  scoring("s2", P1, "approved", "2026-10-01T09:00:00+00:00", "Bar La Plaza"),
  scoring("s3", P1, "rejected", "2026-09-22T09:00:00+00:00", "Talleres Ruiz"),
  scoring("s4", P2, "pending_review", "2026-09-30T09:00:00+00:00", "Clínica Dental Sur", "Sanidad"),
  scoring("s5", P2, "rejected", "2026-08-03T09:00:00+00:00", "Gimnasio Fit"),
  scoring("s6", SALES, "approved", "2026-10-06T09:00:00+00:00", "Hotel Mar"),
  scoring("s7", null, "approved", "2026-07-01T09:00:00+00:00", "Legacy SA", null),
];
const CONTRACTS: PipelineContract[] = [
  op("c1", "s1", "signed", "2026-10-06T10:00:00+00:00"),
  op("c2", "s2", "draft", "2026-10-02T10:00:00+00:00"),
  op("c3", "s2", "cancelled", "2026-10-03T10:00:00+00:00"),
  op("c6", "s6", "draft", "2026-10-06T11:00:00+00:00", "Direct"),
  op("c7", "s7", "signed", "2026-07-02T10:00:00+00:00", "Gamma"),
];
const ROWS = buildPipelineRows(SCORINGS, CONTRACTS, USERS);
const row = (key: string) => ROWS.find((r) => r.key === key)!;

describe("resolveOriginator (created_by -> partner / distributor)", () => {
  const dir = new Map(USERS.map((u) => [u.id, u]));

  it("a partner resolves to its email and the distributor it represents", () => {
    expect(resolveOriginator(P1, dir)).toEqual({ kind: "partner", key: P1, name: "ana@alfa.es", distributorId: "d-alfa", distributorName: "Alfa Distribución" });
  });

  it("a Tecfys user is internal and has no distributor", () => {
    expect(resolveOriginator(SALES, dir)).toEqual({ kind: "internal", key: SALES, name: "ventas@tecfys.com", distributorId: null, distributorName: null });
  });

  it("a null created_by (imported / legacy) is 'Sin partner', never a crash", () => {
    for (const createdBy of [null, undefined, ""]) {
      expect(resolveOriginator(createdBy, dir)).toEqual({ kind: "none", key: NO_PARTNER_KEY, name: NO_PARTNER_LABEL, distributorId: null, distributorName: null });
    }
    expect(resolveOriginator(null, new Map())).toMatchObject({ kind: "none", name: "Sin partner" });
  });

  it("a creator that is no longer in the directory is shown as deleted", () => {
    expect(resolveOriginator(GONE, dir)).toEqual({ kind: "unknown", key: GONE, name: "Usuario eliminado", distributorId: null, distributorName: null });
  });

  it("tolerates a partner with no distributor, a user with no email and one with no role", () => {
    const odd = new Map<string, PipelineUser>([
      ["a", { id: "a", email: "p@x.es", role: "partner", distributor: null }],
      ["b", { id: "b", email: null, role: "sales", distributor: null }],
      ["c", { id: "c", email: "sin-rol@x.es", role: null, distributor: null }],
    ]);
    expect(resolveOriginator("a", odd)).toMatchObject({ kind: "partner", distributorName: null });
    expect(resolveOriginator("b", odd)).toMatchObject({ kind: "internal", name: "Usuario sin email" });
    expect(resolveOriginator("c", odd)).toMatchObject({ kind: "internal", name: "sin-rol@x.es" });
  });

  it("labels each kind for selects and charts", () => {
    expect(originatorLabel(resolveOriginator(P1, dir))).toBe("Alfa Distribución · ana@alfa.es");
    expect(originatorLabel(resolveOriginator(SALES, dir))).toBe("Tecfys · ventas@tecfys.com");
    expect(originatorLabel(resolveOriginator(null, dir))).toBe("Sin partner");
    expect(originatorLabel(resolveOriginator(GONE, dir))).toBe("Usuario eliminado");
  });
});

describe("buildPipelineRows", () => {
  it("one row per scoring, and one per operation when a scoring has several", () => {
    expect(ROWS.map((r) => r.key).sort()).toEqual(["s1:c1", "s2:c2", "s2:c3", "s3", "s4", "s5", "s6:c6", "s7:c7"]);
  });

  it("carries partner, company, sector, score, rating, status and date", () => {
    expect(row("s1:c1")).toMatchObject({
      scoringId: "s1",
      company: "Construcción Núñez SL",
      cif: "B00000001",
      sector: "Construcción",
      score: 7.5,
      rating: "A",
      status: "approved",
      date: "2026-10-05T09:00:00+00:00",
      lastActivity: "2026-10-06T10:00:00+00:00",
      distributorName: "Alfa Distribución",
      contract: { id: "c1", contractNumber: "TCF-c1", workflowStatus: "signed" },
    });
    expect(row("s1:c1").originator).toMatchObject({ kind: "partner", name: "ana@alfa.es" });
  });

  it("places each row at its lifecycle stage", () => {
    expect(row("s1:c1").lifecycle).toMatchObject({ stage: "signed", outcome: "completed" });
    expect(row("s2:c2").lifecycle).toMatchObject({ stage: "operation", outcome: "in_progress" });
    expect(row("s2:c3").lifecycle).toMatchObject({ stage: "operation", outcome: "cancelled" });
    expect(row("s3").lifecycle).toMatchObject({ stage: "scoring", outcome: "rejected" });
    expect(row("s4").lifecycle).toMatchObject({ stage: "scoring", outcome: "in_progress", label: "Pendiente de revisión" });
  });

  it("a legacy scoring with no creator is listed as 'Sin partner', with the operation's distributor", () => {
    expect(row("s7:c7").originator).toMatchObject({ kind: "none", name: "Sin partner" });
    expect(row("s7:c7").distributorName).toBe("Gamma");
    expect(row("s7:c7").sector).toBeNull();
  });

  it("an internal user's operation shows the distributor chosen on the operation", () => {
    expect(row("s6:c6").originator.kind).toBe("internal");
    expect(row("s6:c6").distributorName).toBe("Direct");
  });

  it("sorts by latest activity, newest first", () => {
    expect(ROWS.map((r) => r.key)).toEqual(["s6:c6", "s1:c1", "s2:c3", "s2:c2", "s4", "s3", "s5", "s7:c7"]);
  });

  it("survives a scoring with no company, an operation of an unknown scoring and empty inputs", () => {
    const rows = buildPipelineRows([{ ...scoring("x1", GONE, "approved", "2026-10-01T00:00:00+00:00"), company: null }], [op("cz", "missing", "draft", "2026-10-01T00:00:00+00:00")], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ company: "—", cif: null, sector: null, contract: null });
    expect(rows[0].originator.kind).toBe("unknown");
    expect(buildPipelineRows([], [], [])).toEqual([]);
  });
});

describe("filterPipeline", () => {
  const filter = (q: Partial<Parameters<typeof filterPipeline>[1]>) => filterPipeline(ROWS, { q: "", partner: null, distributor: null, status: null, ...q }).map((r) => r.key).sort();

  it("no filter returns everything", () => {
    expect(filter({})).toHaveLength(ROWS.length);
  });

  it("by partner", () => {
    expect(filter({ partner: P1 })).toEqual(["s1:c1", "s2:c2", "s2:c3", "s3"]);
    expect(filter({ partner: P2 })).toEqual(["s4", "s5"]);
    expect(filter({ partner: SALES })).toEqual(["s6:c6"]);
    expect(filter({ partner: NO_PARTNER_KEY })).toEqual(["s7:c7"]);
    expect(filter({ partner: "nobody" })).toEqual([]);
  });

  it("by distributor", () => {
    expect(filter({ distributor: "Alfa Distribución" })).toEqual(["s1:c1", "s2:c2", "s2:c3", "s3"]);
    expect(filter({ distributor: "Beta Tech" })).toEqual(["s4", "s5"]);
    expect(filter({ distributor: "Gamma" })).toEqual(["s7:c7"]);
  });

  it("by scoring status", () => {
    expect(filter({ status: "approved" })).toEqual(["s1:c1", "s2:c2", "s2:c3", "s6:c6", "s7:c7"]);
    expect(filter({ status: "pending_review" })).toEqual(["s4"]);
    expect(filter({ status: "rejected" })).toEqual(["s3", "s5"]);
  });

  it("searches the company name ignoring case and accents, and the CIF", () => {
    expect(filter({ q: "construccion nunez" })).toEqual(["s1:c1"]);
    expect(filter({ q: "  CLÍNICA " })).toEqual(["s4"]);
    expect(filter({ q: "b00000005" })).toEqual(["s5"]);
    expect(filter({ q: "no existe" })).toEqual([]);
  });

  it("combines filters", () => {
    expect(filter({ partner: P1, status: "rejected" })).toEqual(["s3"]);
    expect(filter({ partner: P2, status: "approved" })).toEqual([]);
    expect(filter({ distributor: "Alfa Distribución", q: "bar" })).toEqual(["s2:c2", "s2:c3"]);
  });

  it("offers the partners and distributors present in the data", () => {
    const options = pipelineFilterOptions(ROWS);
    expect(options.partner).toEqual([
      { value: P1, label: "Alfa Distribución · ana@alfa.es" },
      { value: P2, label: "Beta Tech · luis@beta.es" },
      { value: NO_PARTNER_KEY, label: "Sin partner" },
      { value: SALES, label: "Tecfys · ventas@tecfys.com" },
    ]);
    expect(options.distributor.map((d) => d.value)).toEqual(["Alfa Distribución", "Beta Tech", "Direct", "Gamma"]);
  });
});

describe("pipeline query (URL)", () => {
  it("parses the filters and drops what it does not know", () => {
    expect(parsePipelineQuery({ q: "  bar ", partner: P1, distributor: "Beta Tech", status: "rejected", page: "3" })).toEqual({ q: "bar", partner: P1, distributor: "Beta Tech", status: "rejected", page: 3 });
    expect(parsePipelineQuery({})).toEqual({ q: "", partner: null, distributor: null, status: null, page: 1 });
    expect(parsePipelineQuery({ status: "signed", page: "-2", q: ["a", "b"] })).toEqual({ q: "a", partner: null, distributor: null, status: null, page: 1 });
    expect(parsePipelineQuery({ status: "toString", page: "abc" }).status).toBeNull();
    expect(parsePipelineQuery({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("round-trips through the query string", () => {
    const query = parsePipelineQuery({ q: "bar & co", partner: NO_PARTNER_KEY, status: "approved", page: "2" });
    const sp = Object.fromEntries(new URLSearchParams(pipelineSearch(query)));
    expect(parsePipelineQuery(sp)).toEqual(query);
    expect(pipelineSearch(parsePipelineQuery({}))).toBe("");
    expect(pipelineSearch(query, { partner: P2, page: 1 })).toBe(`q=bar+%26+co&partner=${P2}&status=approved`);
  });

  it("knows when a filter is active", () => {
    expect(hasPipelineFilters(parsePipelineQuery({}))).toBe(false);
    expect(hasPipelineFilters(parsePipelineQuery({ page: "4" }))).toBe(false);
    for (const sp of [{ q: "a" }, { partner: P1 }, { distributor: "x" }, { status: "approved" }]) expect(hasPipelineFilters(parsePipelineQuery(sp))).toBe(true);
  });
});

describe("aggregations", () => {
  it("totals count each scoring once, however many operations it has", () => {
    expect(pipelineTotals(ROWS)).toEqual({
      scorings: 7,
      approved: 4,
      pendingReview: 1,
      rejected: 2,
      approvalRate: 4 / 7,
      rejectionRate: 2 / 7,
      operations: 5,
      signed: 2,
      conversionRate: 1,
    });
  });

  it("rates are null, not NaN, with no scorings", () => {
    expect(pipelineTotals([])).toEqual({ scorings: 0, approved: 0, pendingReview: 0, rejected: 0, approvalRate: null, rejectionRate: null, operations: 0, signed: 0, conversionRate: null });
    expect(scoringsByStatus([])).toEqual([]);
    expect(scoringsByPartner([])).toEqual([]);
    expect(activityByPartner([])).toEqual([]);
  });

  it("conversion is the share of approved scorings that became an operation", () => {
    const rows = buildPipelineRows(
      [scoring("a1", P1, "approved", "2026-10-01T00:00:00+00:00"), scoring("a2", P1, "approved", "2026-10-01T00:00:00+00:00"), scoring("a3", P1, "rejected", "2026-10-01T00:00:00+00:00")],
      [op("k1", "a1", "draft", "2026-10-02T00:00:00+00:00"), op("k2", "a1", "signed", "2026-10-02T00:00:00+00:00")],
      USERS,
    );
    expect(pipelineTotals(rows)).toMatchObject({ scorings: 3, approved: 2, rejected: 1, operations: 2, signed: 1, conversionRate: 0.5, approvalRate: 2 / 3 });
  });

  it("per partner: counts, rates and last activity, busiest first", () => {
    const partners = activityByPartner(ROWS);
    expect(partners.map((p) => [p.label, p.scorings])).toEqual([
      ["Alfa Distribución · ana@alfa.es", 3],
      ["Beta Tech · luis@beta.es", 2],
      ["Sin partner", 1],
      ["Tecfys · ventas@tecfys.com", 1],
    ]);
    expect(partners[0]).toMatchObject({ key: P1, kind: "partner", approved: 2, rejected: 1, pendingReview: 0, approvalRate: 2 / 3, rejectionRate: 1 / 3, operations: 3, signed: 1, lastActivity: "2026-10-06T10:00:00+00:00" });
    expect(partners[1]).toMatchObject({ key: P2, approved: 0, rejected: 1, pendingReview: 1, approvalRate: 0, rejectionRate: 0.5, operations: 0, conversionRate: null });
    expect(partners[2]).toMatchObject({ key: NO_PARTNER_KEY, kind: "none", scorings: 1 });
    expect(partners.reduce((s, p) => s + p.scorings, 0)).toBe(pipelineTotals(ROWS).scorings);
  });

  it("chart slices: scorings per partner with their share", () => {
    const slices = scoringsByPartner(ROWS);
    expect(slices.map((s) => [s.key, s.amount])).toEqual([[P1, 3], [P2, 2], [NO_PARTNER_KEY, 1], [SALES, 1]]);
    expect(slices[0].share).toBeCloseTo(3 / 7);
    expect(slices.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(scoringsByPartner(ROWS, 2).map((s) => s.key)).toEqual([P1, P2]);
  });

  it("chart slices: approved / manual review / rejected in a fixed order, empty ones left out", () => {
    expect(scoringsByStatus(ROWS).map((s) => [s.key, s.label, s.amount])).toEqual([
      ["approved", "Aprobado", 4],
      ["pending_review", "Revisión manual", 1],
      ["rejected", "Rechazado", 2],
    ]);
    expect(scoringsByStatus(filterPipeline(ROWS, { q: "", partner: P2, distributor: null, status: null })).map((s) => s.key)).toEqual(["pending_review", "rejected"]);
  });

  it("the figures follow the filters", () => {
    const alfa = filterPipeline(ROWS, { q: "", partner: P1, distributor: null, status: null });
    expect(pipelineTotals(alfa)).toMatchObject({ scorings: 3, approved: 2, rejected: 1, operations: 3 });
  });
});

describe("recent activity", () => {
  it("counts scorings and operations per week (Monday to Sunday, UTC), oldest first", () => {
    const weeks = weeklyActivity(ROWS, NOW, 4);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(weeks.map((w) => w.label)).toEqual(["14/09", "21/09", "28/09", "05/10"]);
    // s3 on 22-sep; s2 (1-oct) and s4 (30-sep); s1 (5-oct) and s6 (6-oct). s5 and s7 are older than the window.
    expect(weeks.map((w) => w.scorings)).toEqual([0, 1, 2, 2]);
    // c2 (2-oct) and c3 (3-oct); c1 and c6 (6-oct).
    expect(weeks.map((w) => w.operations)).toEqual([0, 0, 2, 2]);
  });

  it("always returns the requested number of weeks, also with no data or bad dates", () => {
    expect(weeklyActivity([], NOW)).toHaveLength(12);
    expect(weeklyActivity([], NOW).every((w) => w.scorings === 0 && w.operations === 0)).toBe(true);
    const bad = buildPipelineRows([scoring("z1", P1, "approved", "not-a-date")], [], USERS);
    expect(weeklyActivity(bad, NOW, 3).map((w) => w.scorings)).toEqual([0, 0, 0]);
  });

  it("a Sunday belongs to the week that started the Monday before", () => {
    const rows = buildPipelineRows([scoring("u1", P1, "approved", "2026-10-04T23:30:00+00:00")], [], USERS);
    expect(weeklyActivity(rows, NOW, 2).map((w) => w.scorings)).toEqual([1, 0]);
  });

  it("active partners: partners only, with activity in the window", () => {
    expect(activePartners(ROWS, NOW, 30)).toBe(2);
    expect(activePartners(ROWS, NOW, 3)).toBe(1);
    expect(activePartners(ROWS, new Date("2027-06-01T00:00:00Z"), 30)).toBe(0);
    expect(activePartners([], NOW)).toBe(0);
  });
});
