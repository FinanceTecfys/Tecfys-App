/**
 * Streaming reader for the Borrowing Base workbook ("Tecfys Borrowing base_*.xlsx").
 *
 * Reads the typed-in inputs of the Loan book tab and, optionally, the cached
 * results of the Principal / Interest / Principal Outstanding tabs so the
 * TypeScript engine can be reconciled cell by cell against Excel.
 *
 * Layout: header row 3, contracts from row 4, grid columns BH:HS = Jan-2020 ..
 * Dec-2033 (168 months).
 */
import ExcelJS from "exceljs";

export const GRID_FIRST_COL = colIndex("BH");
export const GRID_MONTHS = 168;
export const GRID_FIRST_KEY = 2020 * 12 + 1;

/** Contracts whose Principal!HX formula amortises over real life (changes_rationale item 23). */
const REAL_LIFE_OVERRIDE_IDS = new Set(["14200", "14334", "14360", "16034", "16070", "16278", "16583"]);

/** Loan book asset-cluster columns Y:AI, in order. */
export const ASSET_CLUSTER_COLUMNS = [
  "Electrical Appliances", "Laptops", "Móviles & Tablets", "TV", "Technological Accessories",
  "Small Appliances", "Water Dispenser", "Other", "Hospitality Machinery", "Mobiliario general", "Mobility",
] as const;

export interface LoanBookRow {
  row: number;
  /** Col C. NOT unique (one ID can cover several contracts) and sometimes text ("18340-1"). */
  code: string;
  trancheLender: string | null;
  signingYear: number;
  signingMonth: number;
  /** Col F: DATE(D,E,1) on most rows, the real signing date where it was typed in. */
  signingDate: string;
  cif: string | null;
  clientName: string | null;
  country: string | null;
  partner: string | null;
  sector: string | null;
  rating: string | null;
  installment: number;
  durationMonths: number;
  productType: string | null;
  cancelDate: string | null;
  additionalStatus: string | null;
  assets: { cluster: string; quantity: number }[];
  contractType: string;
  residualValue: number | null;
  expoAdjustment: number;
  endorsement: boolean;
  purchaseValue: number;
  residualWaived: boolean;
  amortizeOverRealLife: boolean;
  /** Cached workbook results, for reconciliation only. */
  cached: { status: string | null; realMonths: number | null };
}

export interface SplitRow {
  row: number;
  code: string;
  expectedIrr: number | string | null; // HX
  amortizationMonths: number | null;   // HY
  principalResult: number | null;      // BD
  total: number | null;                // AQ
  grid: (number | null)[];             // BH:HS
}

export interface WorkbookData {
  asOf: Date | null;
  loanBook: LoanBookRow[];
  /** Keyed by worksheet row: the split tabs are row-aligned with the Loan book (col C is not unique). */
  principal?: Map<number, SplitRow>;
  interest?: Map<number, SplitRow>;
  outstanding?: Map<number, (number | null)[]>;
  /** Summary tab: month key -> { summary row number -> cached value }. */
  summary?: Map<number, Record<number, number | null>>;
}

/** Summary rows compared by the reconciliation. */
export const SUMMARY_ROWS = { installments: 4, interest: 5, principal: 6, newInterest: 14, newPrincipal: 15, defaults: 22, closingPrincipal: 28 } as const;

export async function readBorrowingBase(path: string, opts: { withGrids?: boolean } = {}): Promise<WorkbookData> {
  const wanted = new Set(["Loan book", ...(opts.withGrids ? ["Principal", "Interest", "Principal Outstanding", "Summary"] : [])]);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    worksheets: "emit",
    entries: "emit",
  });

  const data: WorkbookData = { asOf: null, loanBook: [] };

  for await (const ws of reader) {
    // exceljs exposes the sheet name on the streaming worksheet reader.
    const name = (ws as unknown as { name: string }).name;
    if (!wanted.has(name)) continue;

    if (name === "Loan book") {
      for await (const row of ws) {
        if (row.number === 1) data.asOf = asDate(value(row.getCell("R")));
        if (row.number < 4) continue;
        const parsed = parseLoanBookRow(row);
        if (parsed) data.loanBook.push(parsed);
      }
    } else if (name === "Summary") {
      data.summary = readSummary(await collectRows(ws, 30));
    } else if (name === "Principal Outstanding") {
      data.outstanding = new Map();
      for await (const row of ws) {
        if (row.number < 4) continue;
        if (asNumber(value(row.getCell("D"))) === null) continue;
        data.outstanding.set(row.number, readGrid(row));
      }
    } else {
      const map = new Map<number, SplitRow>();
      for await (const row of ws) {
        if (row.number < 4) continue;
        if (asNumber(value(row.getCell("D"))) === null) continue;
        const code = contractRef(row);
        const hx = value(row.getCell("HX"));
        map.set(row.number, {
          row: row.number,
          code,
          expectedIrr: typeof hx === "string" ? hx : asNumber(hx),
          amortizationMonths: asNumber(value(row.getCell("HY"))),
          principalResult: asNumber(value(row.getCell("BD"))),
          total: asNumber(value(row.getCell("AQ"))),
          grid: readGrid(row),
        });
      }
      if (name === "Principal") data.principal = map;
      else data.interest = map;
    }
  }
  return data;
}

function parseLoanBookRow(row: ExcelJS.Row): LoanBookRow | null {
  const year = asNumber(value(row.getCell("D")));
  const month = asNumber(value(row.getCell("E")));
  if (year === null || month === null) return null;
  const code = contractRef(row);
  const f = asDate(value(row.getCell("F")));
  const signingDate = f && f.getUTCFullYear() === year && f.getUTCMonth() + 1 === month
    ? toIso(f)!
    : `${year}-${String(month).padStart(2, "0")}-01`;

  const additionalStatus = asText(value(row.getCell("U")));
  const assets = ASSET_CLUSTER_COLUMNS.map((cluster, i) => ({
    cluster,
    quantity: asNumber(value(row.getCell(colIndex("Y") + i))) ?? 0,
  })).filter((a) => a.quantity > 0);

  return {
    row: row.number,
    code,
    trancheLender: asText(value(row.getCell("B"))),
    signingYear: year,
    signingMonth: month,
    signingDate,
    cif: asText(value(row.getCell("G"))),
    clientName: asText(value(row.getCell("H"))),
    country: asText(value(row.getCell("I"))),
    partner: asText(value(row.getCell("J"))),
    sector: asText(value(row.getCell("K"))),
    rating: asText(value(row.getCell("L"))),
    installment: asNumber(value(row.getCell("M"))) ?? 0,
    durationMonths: asNumber(value(row.getCell("N"))) ?? 0,
    productType: asText(value(row.getCell("Q"))),
    cancelDate: toIso(asDate(value(row.getCell("R")))),
    additionalStatus,
    assets,
    // The workbook compares contract types with "=" (case-insensitive, exact
    // otherwise); "Renting " with a trailing space is a plain Renting.
    contractType: normaliseContractType(asText(value(row.getCell("AL")))),
    residualValue: asNumber(value(row.getCell("AR"))),
    expoAdjustment: asNumber(value(row.getCell("AS"))) ?? 0,
    endorsement: (asText(value(row.getCell("AT"))) ?? "").toLowerCase().startsWith("y")
      || (asText(value(row.getCell("AT"))) ?? "").toLowerCase().startsWith("s"),
    purchaseValue: -(asNumber(value(row.getCell("BE"))) ?? 0),
    residualWaived: (additionalStatus ?? "").toLowerCase() === "gesico",
    amortizeOverRealLife: REAL_LIFE_OVERRIDE_IDS.has(code),
    cached: {
      status: asText(value(row.getCell("T"))),
      realMonths: asNumber(value(row.getCell("V"))),
    },
  };
}

const CONTRACT_TYPES = ["Renting", "Renting F", "Renting RC", "Renting K", "Subscription", "Subscription K"];
function normaliseContractType(raw: string | null): string {
  const t = (raw ?? "").trim();
  return CONTRACT_TYPES.find((c) => c.toLowerCase() === t.toLowerCase()) ?? "Renting";
}

async function collectRows(ws: AsyncIterable<ExcelJS.Row>, maxRow: number): Promise<Map<number, ExcelJS.Row>> {
  const rows = new Map<number, ExcelJS.Row>();
  for await (const row of ws) if (row.number <= maxRow) rows.set(row.number, row);
  return rows;
}

function readSummary(rows: Map<number, ExcelJS.Row>): Map<number, Record<number, number | null>> {
  const out = new Map<number, Record<number, number | null>>();
  const years = rows.get(2);
  const months = rows.get(3);
  if (!years || !months) return out;
  for (let col = 2; col <= years.cellCount; col++) {
    const y = asNumber(value(years.getCell(col)));
    const m = asNumber(value(months.getCell(col)));
    if (y === null || m === null) continue;
    const rec: Record<number, number | null> = {};
    for (const r of Object.values(SUMMARY_ROWS)) rec[r] = asNumber(value(rows.get(r)?.getCell(col) ?? years.getCell(1)));
    out.set(y * 12 + m, rec);
  }
  return out;
}

/** Col C as text; a cell holding an Excel error gets a row-based placeholder. */
function contractRef(row: ExcelJS.Row): string {
  const raw = value(row.getCell("C"));
  const text = typeof raw === "number" ? String(raw) : asText(raw);
  return text && !text.startsWith("#") ? text : `ROW${row.number}`;
}

function readGrid(row: ExcelJS.Row): (number | null)[] {
  const out: (number | null)[] = new Array(GRID_MONTHS);
  for (let i = 0; i < GRID_MONTHS; i++) out[i] = asNumber(value(row.getCell(GRID_FIRST_COL + i)));
  return out;
}

/** Cached value of a cell: formula results are unwrapped. */
function value(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("result" in o) return o.result ?? null;
    if ("formula" in o || "sharedFormula" in o) return null;
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("error" in o) return null;
  }
  return v;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  return null;
}

function toIso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
