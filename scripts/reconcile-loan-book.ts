/**
 * Reconcile the TypeScript loan-book engine against the Borrowing Base workbook.
 *
 *   npm run reconcile -- "Legacy/Tecfys Borrowing base_15092026_default alignment.xlsx"
 *
 * Recomputes every contract from its Loan book inputs and compares, cell by
 * cell, with the cached values of the Principal, Interest and Principal
 * Outstanding grids (Jan-2020 .. Dec-2033), plus the expected IRR (HX).
 * Exits non-zero when any difference exceeds the tolerance.
 */
import { buildSchedule, type ContractInput } from "../src/modules/contracts/domain/schedule";
import { buildPortfolio } from "../src/modules/contracts/domain/portfolio";
import { GRID_FIRST_KEY, GRID_MONTHS, type LoanBookRow, readBorrowingBase, SUMMARY_ROWS } from "./lib/borrowing-base-workbook";

const TOLERANCE = 1e-4;

export function toContractInput(r: LoanBookRow): ContractInput {
  return {
    signingDate: r.signingDate,
    billingLagMonths: r.contractType === "Renting F" ? 1 : 0,
    durationMonths: r.durationMonths,
    installment: r.installment,
    residualValue: r.residualValue,
    purchaseValue: r.purchaseValue,
    expoAdjustment: r.expoAdjustment,
    cancelDate: r.cancelDate,
    residualWaived: r.residualWaived,
    amortizeOverRealLife: r.amortizeOverRealLife,
  };
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run reconcile -- <path to Borrowing Base xlsx>");

  const t0 = Date.now();
  const wb = await readBorrowingBase(path, { withGrids: true });
  if (!wb.asOf) throw new Error("Loan book!R1 (TODAY) has no cached value");
  console.log(`Read ${wb.loanBook.length} contracts in ${((Date.now() - t0) / 1000).toFixed(1)}s, as of ${wb.asOf.toISOString().slice(0, 10)}`);

  type Diff = { code: string; row: number; what: string; excel: unknown; engine: unknown };
  const diffs: Diff[] = [];
  const perContract = new Map<number, Set<string>>(); // keyed by row
  const note = (d: Diff) => {
    diffs.push(d);
    if (!perContract.has(d.row)) perContract.set(d.row, new Set());
    perContract.get(d.row)!.add(d.what.replace(/@.*/, ""));
  };

  const schedules = [];
  let cells = 0;
  for (const r of wb.loanBook) {
    const s = buildSchedule(toContractInput(r), wb.asOf);
    schedules.push(s);

    if (r.cached.status && r.cached.status !== s.status) note({ code: r.code, row: r.row, what: "status", excel: r.cached.status, engine: s.status });
    if (r.cached.realMonths !== null && r.cached.realMonths !== s.paymentHorizon) note({ code: r.code, row: r.row, what: "V", excel: r.cached.realMonths, engine: s.paymentHorizon });

    const p = wb.principal?.get(r.row);
    const it = wb.interest?.get(r.row);
    const po = wb.outstanding?.get(r.row);
    if (!p || !it || !po || p.code !== r.code) {
      note({ code: r.code, row: r.row, what: "missing split row", excel: null, engine: null });
      continue;
    }

    const hx = typeof p.expectedIrr === "number" ? p.expectedIrr : null;
    const eng = s.expectedMonthlyIrr;
    if ((hx === null) !== (eng === null) || (hx !== null && eng !== null && Math.abs(hx - eng) > 1e-6)) {
      note({ code: r.code, row: r.row, what: "HX expected IRR", excel: p.expectedIrr, engine: eng });
    }

    const pri = new Array<number | null>(GRID_MONTHS).fill(null);
    const int = new Array<number | null>(GRID_MONTHS).fill(null);
    for (const row of s.rows) {
      const idx = row.key - GRID_FIRST_KEY;
      if (idx < 0 || idx >= GRID_MONTHS) continue;
      pri[idx] = row.principal;
      int[idx] = row.interest;
    }
    for (let i = 0; i < GRID_MONTHS; i++) {
      cells++;
      const key = GRID_FIRST_KEY + i;
      const label = `@${Math.floor((key - 1) / 12)}-${((key - 1) % 12) + 1}`;
      cmp(p.grid[i], pri[i], (e, g) => note({ code: r.code, row: r.row, what: `principal${label}`, excel: e, engine: g }));
      cmp(it.grid[i], int[i], (e, g) => note({ code: r.code, row: r.row, what: `interest${label}`, excel: e, engine: g }));
      // PO: engine is null before signing, like the workbook's "".
      const signed = key >= s.signingKey;
      let collected = 0;
      if (signed) for (const row of s.rows) if (row.key <= key) collected += row.principal;
      const engPo = !signed ? null : s.rows.length === 0 ? 0
        : s.assetBase - collected - (s.cancelKey !== null && key >= s.cancelKey ? s.writeOff : 0);
      cmp(po[i], engPo, (e, g) => note({ code: r.code, row: r.row, what: `outstanding${label}`, excel: e, engine: g }));
    }
  }

  // Portfolio over the workbook window.
  const months = buildPortfolio(schedules, { from: GRID_FIRST_KEY, to: GRID_FIRST_KEY + GRID_MONTHS - 1 });
  const maxRecon = Math.max(...months.map((m) => Math.abs(m.reconciliationDiff)));
  const totals = months.reduce((a, m) => ({ inst: a.inst + m.installments, pri: a.pri + m.principal, int: a.int + m.interest, def: a.def + m.defaults }), { inst: 0, pri: 0, int: 0, def: 0 });
  const excelTotals = [...(wb.principal?.values() ?? [])].reduce((a, p) => a + (p.total ?? 0), 0);
  const excelInterest = [...(wb.interest?.values() ?? [])].reduce((a, p) => a + (p.total ?? 0), 0);

  console.log(`\nCells compared: ${cells.toLocaleString()} per grid x 3`);
  console.log(`Engine totals  installments ${fmt(totals.inst)}  principal ${fmt(totals.pri)}  interest ${fmt(totals.int)}  defaults ${fmt(totals.def)}`);
  console.log(`Excel totals   principal ${fmt(excelTotals)}  interest ${fmt(excelInterest)}`);
  console.log(`Summary row 30 equivalent (roll-forward vs bottom-up), max |diff|: ${maxRecon.toExponential(2)}`);
  for (const label of ["2026-08", "2026-09", "2027-06"]) {
    const [y, m] = label.split("-").map(Number);
    const month = months.find((x) => x.key === y * 12 + m);
    if (month) console.log(`Closing principal outstanding ${label}: ${fmt(month.closingPrincipal)}`);
  }

  // Summary tab, month by month.
  let summaryDiffs = 0;
  let summaryMonths = 0;
  for (const m of months) {
    const rec = wb.summary?.get(m.key);
    if (!rec) continue;
    summaryMonths++;
    for (const [field, rowNo] of Object.entries(SUMMARY_ROWS)) {
      const excel = rec[rowNo] ?? 0;
      const engine = m[field as keyof typeof SUMMARY_ROWS];
      if (Math.abs(excel - engine) > 1e-3) {
        summaryDiffs++;
        if (summaryDiffs <= 10) console.log(`  Summary row ${rowNo} (${field}) ${Math.floor((m.key - 1) / 12)}-${((m.key - 1) % 12) + 1}: excel=${fmt(excel)} engine=${fmt(engine)}`);
      }
    }
  }
  console.log(`Summary tab: ${summaryMonths} months x ${Object.keys(SUMMARY_ROWS).length} rows compared, ${summaryDiffs} differences`);
  if (summaryDiffs > 0) process.exitCode = 1;

  console.log(`\nContracts with differences: ${perContract.size} of ${wb.loanBook.length}  (cell diffs: ${diffs.length})`);
  const byKind = new Map<string, number>();
  for (const kinds of perContract.values()) for (const k of kinds) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  for (const [k, n] of byKind) console.log(`  ${k}: ${n} contracts`);
  const shown = new Set<number>();
  for (const d of diffs) {
    if (shown.size >= 40 && !shown.has(d.row)) continue;
    if (!shown.has(d.row)) {
      shown.add(d.row);
      console.log(`  - contract ${d.code} (row ${d.row}): ${d.what} excel=${String(d.excel)} engine=${String(d.engine)}`);
    }
  }
  if (perContract.size > 0) process.exitCode = 1;
}

function cmp(excel: number | null, engine: number | null, onDiff: (e: number | null, g: number | null) => void) {
  const e = excel ?? null;
  const g = engine ?? null;
  if (e === null && g === null) return;
  if (e === null || g === null) {
    // Blank vs (numerically) zero is not a difference worth reporting.
    if (Math.abs((e ?? 0) - (g ?? 0)) <= TOLERANCE) return;
    onDiff(e, g);
    return;
  }
  if (Math.abs(e - g) > TOLERANCE) onDiff(e, g);
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
