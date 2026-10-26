/**
 * Pipeline: what partners (and Tecfys itself) are originating. Pure: the page
 * loads scorings, the contracts born from them and the user directory ONCE,
 * and everything shown - rows, filters, per-partner counts, rates, recent
 * activity - is computed here in memory from that single load.
 *
 * No stored data of its own: it reads scorings.created_by, contracts and
 * profiles.partner_distributor_id as they are.
 */
import type { Role } from "@/lib/auth/permissions";
import { type Lifecycle, lifecycleOf } from "./lifecycle";

// ---------------------------------------------------------------------------
// Inputs (what the data layer loads)
// ---------------------------------------------------------------------------

export interface PipelineScoring {
  id: string;
  status: string;
  rating: string;
  totalScore: number;
  createdAt: string;
  createdBy: string | null;
  company: { name: string; cif: string; sector: string | null } | null;
}

export interface PipelineContract {
  id: string;
  contractNumber: string;
  scoringId: string;
  workflowStatus: string;
  createdAt: string;
  distributorName: string | null;
  hasSignatureRequest: boolean;
}

export interface PipelineUser {
  id: string;
  email: string | null;
  role: Role | null;
  distributor: { id: string; name: string } | null;
}

// ---------------------------------------------------------------------------
// created_by -> who originated it
// ---------------------------------------------------------------------------

/**
 * partner   a partner user (tied to a distributor)
 * internal  a Tecfys user (owner, admin, sales)
 * none      no creator recorded: rows older than RBAC, imported records
 * unknown   a creator id that is no longer in the user directory
 */
export type OriginatorKind = "partner" | "internal" | "none" | "unknown";

export interface Originator {
  kind: OriginatorKind;
  /** Stable grouping / filter key. */
  key: string;
  /** What the table shows as the partner. */
  name: string;
  distributorId: string | null;
  distributorName: string | null;
}

export const NO_PARTNER_KEY = "none";
export const NO_PARTNER_LABEL = "pipeline.text.noPartner";

/**
 * The names given to creators that are not a known user. By default they are
 * the keys of their messages (pipeline.text.*); the page passes them already
 * translated, so the names sort and filter in the user's language.
 */
export interface PipelineText {
  noPartner: string;
  deletedUser: string;
  userWithoutEmail: string;
}
export const PIPELINE_TEXT: PipelineText = { noPartner: NO_PARTNER_LABEL, deletedUser: "pipeline.text.deletedUser", userWithoutEmail: "pipeline.text.userWithoutEmail" };

/** Who created a record. Never throws: a null or unknown creator resolves to a placeholder. */
export function resolveOriginator(createdBy: string | null | undefined, users: ReadonlyMap<string, PipelineUser>, text: PipelineText = PIPELINE_TEXT): Originator {
  if (!createdBy) return { kind: "none", key: NO_PARTNER_KEY, name: text.noPartner, distributorId: null, distributorName: null };
  const user = users.get(createdBy);
  if (!user) return { kind: "unknown", key: createdBy, name: text.deletedUser, distributorId: null, distributorName: null };
  const name = user.email ?? text.userWithoutEmail;
  if (user.role === "partner") {
    return { kind: "partner", key: user.id, name, distributorId: user.distributor?.id ?? null, distributorName: user.distributor?.name ?? null };
  }
  return { kind: "internal", key: user.id, name, distributorId: null, distributorName: null };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const SCORING_STATUSES = ["approved", "pending_review", "rejected"] as const;
export type ScoringStatus = (typeof SCORING_STATUSES)[number];
export const isScoringStatus = (v: unknown): v is ScoringStatus => typeof v === "string" && (SCORING_STATUSES as readonly string[]).includes(v);

export const SCORING_STATUS_LABELS: Record<ScoringStatus, string> = {
  approved: "pipeline.statusLabels.approved",
  pending_review: "pipeline.statusLabels.pending_review",
  rejected: "pipeline.statusLabels.rejected",
};

/** One line of the pipeline: a scoring, with one of the operations created from it (if any). */
export interface PipelineRow {
  key: string;
  scoringId: string;
  originator: Originator;
  /** The partner's distributor, else the distributor of the operation. */
  distributorName: string | null;
  company: string;
  cif: string | null;
  sector: string | null;
  score: number;
  rating: string;
  status: string;
  /** Date of the scoring. */
  date: string;
  /** Latest thing that happened: the scoring, or the operation created from it. */
  lastActivity: string;
  contract: { id: string; contractNumber: string; workflowStatus: string; createdAt: string } | null;
  lifecycle: Lifecycle;
}

/**
 * One row per scoring; a scoring with several operations gets one row per
 * operation. Newest activity first.
 */
export function buildPipelineRows(scorings: readonly PipelineScoring[], contracts: readonly PipelineContract[], users: readonly PipelineUser[], text: PipelineText = PIPELINE_TEXT): PipelineRow[] {
  const directory = new Map(users.map((u) => [u.id, u]));
  const byScoring = new Map<string, PipelineContract[]>();
  for (const c of contracts) byScoring.set(c.scoringId, [...(byScoring.get(c.scoringId) ?? []), c]);

  const rows: PipelineRow[] = [];
  for (const s of scorings) {
    const originator = resolveOriginator(s.createdBy, directory, text);
    const base = {
      scoringId: s.id,
      originator,
      company: s.company?.name ?? "—",
      cif: s.company?.cif ?? null,
      sector: s.company?.sector ?? null,
      score: s.totalScore,
      rating: s.rating,
      status: s.status,
      date: s.createdAt,
    };
    const operations = byScoring.get(s.id) ?? [];
    if (operations.length === 0) {
      rows.push({
        ...base,
        key: s.id,
        distributorName: originator.distributorName,
        lastActivity: s.createdAt,
        contract: null,
        lifecycle: lifecycleOf({ scoringStatus: s.status, contract: null }),
      });
    }
    for (const c of operations) {
      rows.push({
        ...base,
        key: `${s.id}:${c.id}`,
        distributorName: originator.distributorName ?? c.distributorName,
        lastActivity: c.createdAt > s.createdAt ? c.createdAt : s.createdAt,
        contract: { id: c.id, contractNumber: c.contractNumber, workflowStatus: c.workflowStatus, createdAt: c.createdAt },
        lifecycle: lifecycleOf({ scoringStatus: s.status, contract: { workflowStatus: c.workflowStatus, hasSignatureRequest: c.hasSignatureRequest } }),
      });
    }
  }
  return rows.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Query (URL-driven filters)
// ---------------------------------------------------------------------------

export interface PipelineQuery {
  /** Company name or CIF. */
  q: string;
  /** Originator key: a user id, or NO_PARTNER_KEY. */
  partner: string | null;
  /** Distributor name. */
  distributor: string | null;
  status: ScoringStatus | null;
  page: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const text = (v: string | string[] | undefined) => (first(v) ?? "").trim().slice(0, 100);

export function parsePipelineQuery(sp: Record<string, string | string[] | undefined>): PipelineQuery {
  const status = first(sp.status);
  const page = Math.floor(Number(first(sp.page)));
  return {
    q: text(sp.q),
    partner: text(sp.partner) || null,
    distributor: text(sp.distributor) || null,
    status: isScoringStatus(status) ? status : null,
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

export function pipelineSearch(query: PipelineQuery, patch: Partial<PipelineQuery> = {}): string {
  const next = { ...query, ...patch };
  const p = new URLSearchParams();
  if (next.q) p.set("q", next.q);
  if (next.partner) p.set("partner", next.partner);
  if (next.distributor) p.set("distributor", next.distributor);
  if (next.status) p.set("status", next.status);
  if (next.page > 1) p.set("page", String(next.page));
  return p.toString();
}

export const hasPipelineFilters = (q: PipelineQuery): boolean => Boolean(q.q || q.partner || q.distributor || q.status);

/** Lower case, no accents: "Construcción" matches "construccion". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterPipeline(rows: readonly PipelineRow[], query: Pick<PipelineQuery, "q" | "partner" | "distributor" | "status">): PipelineRow[] {
  const needle = fold(query.q.trim());
  return rows.filter(
    (r) =>
      (!needle || fold(r.company).includes(needle) || fold(r.cif ?? "").includes(needle)) &&
      (!query.partner || r.originator.key === query.partner) &&
      (!query.distributor || r.distributorName === query.distributor) &&
      (!query.status || r.status === query.status),
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

/** The partners and distributors present in the rows, for the filter selects. */
export function pipelineFilterOptions(rows: readonly PipelineRow[]): { partner: FilterOption[]; distributor: FilterOption[] } {
  const partners = new Map<string, string>();
  const distributors = new Set<string>();
  for (const r of rows) {
    partners.set(r.originator.key, originatorLabel(r.originator));
    if (r.distributorName) distributors.add(r.distributorName);
  }
  const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label, "es");
  return {
    partner: [...partners].map(([value, label]) => ({ value, label })).sort(byLabel),
    distributor: [...distributors].map((d) => ({ value: d, label: d })).sort(byLabel),
  };
}

/** "Distribuidor · email" for a partner, "Tecfys · email" for an internal user. */
export function originatorLabel(o: Originator): string {
  if (o.kind === "partner") return o.distributorName ? `${o.distributorName} · ${o.name}` : o.name;
  if (o.kind === "internal") return `Tecfys · ${o.name}`;
  return o.name;
}

// ---------------------------------------------------------------------------
// Aggregations (each scoring counts once, however many operations it has)
// ---------------------------------------------------------------------------

/** One entry per scoring, keeping its most advanced row first seen. */
function distinctScorings(rows: readonly PipelineRow[]): PipelineRow[] {
  const seen = new Map<string, PipelineRow>();
  for (const r of rows) if (!seen.has(r.scoringId)) seen.set(r.scoringId, r);
  return [...seen.values()];
}

export interface PipelineTotals {
  scorings: number;
  approved: number;
  pendingReview: number;
  rejected: number;
  /** Share of all scorings; null when there are none. */
  approvalRate: number | null;
  rejectionRate: number | null;
  /** Operations (draft contracts) created, and how many of them are signed. */
  operations: number;
  signed: number;
  /** Share of approved scorings that became at least one operation; null without approved scorings. */
  conversionRate: number | null;
}

export function pipelineTotals(rows: readonly PipelineRow[]): PipelineTotals {
  const scorings = distinctScorings(rows);
  const count = (status: ScoringStatus) => scorings.filter((r) => r.status === status).length;
  const approved = count("approved");
  const rejected = count("rejected");
  const withOperation = new Set(rows.filter((r) => r.contract && r.status === "approved").map((r) => r.scoringId)).size;
  const operations = rows.filter((r) => r.contract).length;
  return {
    scorings: scorings.length,
    approved,
    pendingReview: count("pending_review"),
    rejected,
    approvalRate: scorings.length ? approved / scorings.length : null,
    rejectionRate: scorings.length ? rejected / scorings.length : null,
    operations,
    signed: rows.filter((r) => r.contract?.workflowStatus === "signed").length,
    conversionRate: approved ? withOperation / approved : null,
  };
}

export interface PartnerActivity extends PipelineTotals {
  key: string;
  label: string;
  kind: OriginatorKind;
  lastActivity: string;
}

/** Totals per originator, busiest first. */
export function activityByPartner(rows: readonly PipelineRow[]): PartnerActivity[] {
  const groups = new Map<string, PipelineRow[]>();
  for (const r of rows) groups.set(r.originator.key, [...(groups.get(r.originator.key) ?? []), r]);
  return [...groups.values()]
    .map((group) => ({
      key: group[0].originator.key,
      label: originatorLabel(group[0].originator),
      kind: group[0].originator.kind,
      lastActivity: group.reduce((max, r) => (r.lastActivity > max ? r.lastActivity : max), ""),
      ...pipelineTotals(group),
    }))
    .sort((a, b) => b.scorings - a.scorings || a.label.localeCompare(b.label, "es"));
}

/** A chart segment in the shape the dashboard charts take. */
export interface CountSlice {
  key: string;
  label: string;
  amount: number;
  count: number;
  share: number;
  color?: string;
  href?: string;
}

/** Scorings per partner, for the ranked bars; the tail beyond `limit` is dropped from the chart, not from the table. */
export function scoringsByPartner(rows: readonly PipelineRow[], limit = 12): CountSlice[] {
  const all = activityByPartner(rows);
  const total = all.reduce((s, p) => s + p.scorings, 0);
  return all.slice(0, limit).map((p) => ({ key: p.key, label: p.label, amount: p.scorings, count: p.scorings, share: total ? p.scorings / total : 0 }));
}

/** Approved / manual review / rejected, in that fixed order (empty statuses are left out). */
export function scoringsByStatus(rows: readonly PipelineRow[]): CountSlice[] {
  const t = pipelineTotals(rows);
  const counts: Record<ScoringStatus, number> = { approved: t.approved, pending_review: t.pendingReview, rejected: t.rejected };
  return SCORING_STATUSES.filter((s) => counts[s] > 0).map((s) => ({
    key: s,
    label: SCORING_STATUS_LABELS[s],
    amount: counts[s],
    count: counts[s],
    share: t.scorings ? counts[s] / t.scorings : 0,
  }));
}

const DAY = 86_400_000;

/** Monday 00:00 UTC of the week a date falls in. */
function weekStart(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return day - ((date.getUTCDay() + 6) % 7) * DAY;
}

export interface ActivityPoint {
  /** ISO date of the Monday that starts the week. */
  weekStart: string;
  /** "dd/mm" of that Monday. */
  label: string;
  scorings: number;
  operations: number;
}

/** Scorings run and operations created per week, for the last `weeks` weeks ending in the week of `now`. */
export function weeklyActivity(rows: readonly PipelineRow[], now: Date, weeks = 12): ActivityPoint[] {
  const last = weekStart(now);
  const points = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(last - (weeks - 1 - i) * 7 * DAY);
    const iso = start.toISOString().slice(0, 10);
    return { weekStart: iso, label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, scorings: 0, operations: 0 };
  });
  const indexOf = (iso: string) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return -1;
    const i = weeks - 1 - Math.round((last - weekStart(new Date(t))) / (7 * DAY));
    return i >= 0 && i < weeks ? i : -1;
  };
  for (const r of distinctScorings(rows)) {
    const i = indexOf(r.date);
    if (i >= 0) points[i].scorings++;
  }
  for (const r of rows) {
    if (!r.contract) continue;
    const i = indexOf(r.contract.createdAt);
    if (i >= 0) points[i].operations++;
  }
  return points;
}

/** Partners (kind "partner") with any activity in the last `days` days. */
export function activePartners(rows: readonly PipelineRow[], now: Date, days = 30): number {
  const since = now.getTime() - days * DAY;
  return new Set(rows.filter((r) => r.originator.kind === "partner" && Date.parse(r.lastActivity) >= since).map((r) => r.originator.key)).size;
}
