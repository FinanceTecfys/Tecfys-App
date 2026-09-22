import Link from "next/link";
import { Card } from "@/components/ui/card";
import { inputClass, Label } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtEur, fmtMonthKey, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadLoanBook } from "@/modules/contracts/data";
import { monthKey, monthKeyOfDate } from "@/modules/contracts/domain/month-key";
import { buildPortfolio, type PortfolioMonth } from "@/modules/contracts/domain/portfolio";

export const metadata = { title: "Cartera / Waterfall" };

type Row = { label: string; get: (m: PortfolioMonth) => number | null; format?: "eur" | "pct" | "int"; strong?: boolean; muted?: boolean; ref?: string };

const ROWS: (Row | "sep")[] = [
  { label: "Cuotas facturadas", get: (m) => m.installments, strong: true, ref: "4" },
  { label: "Interés", get: (m) => m.interest, ref: "5" },
  { label: "Principal cobrado", get: (m) => m.principal, ref: "6" },
  "sep",
  { label: "Nuevos contratos", get: (m) => m.newContracts, format: "int" },
  { label: "Principal originado", get: (m) => m.newPrincipal, ref: "15" },
  { label: "Interés de los nuevos contratos", get: (m) => m.newInterest, ref: "14" },
  "sep",
  { label: "Principal pendiente — apertura", get: (m) => m.openingPrincipal, ref: "11" },
  { label: "Default DPD+90 (baja de principal)", get: (m) => -m.defaults, ref: "22" },
  { label: "Principal pendiente — cierre", get: (m) => m.closingPrincipal, strong: true, ref: "28" },
  { label: "Interés pendiente — cierre", get: (m) => m.closingInterest },
  { label: "Contratos vivos", get: (m) => m.liveContracts, format: "int" },
  "sep",
  { label: "Default acumulado", get: (m) => m.cumulativeDefaults, ref: "23" },
  { label: "Loss rate acumulado (s/ originado)", get: (m) => m.cumulativeLossRate, format: "pct", ref: "45" },
  { label: "Control: roll-forward − contratos", get: (m) => m.reconciliationDiff, muted: true, ref: "30" },
];

function cell(value: number | null, format: Row["format"]) {
  if (value === null) return "—";
  if (format === "pct") return fmtPct(value, 2);
  if (format === "int") return fmtNum(value, 0);
  if (Math.abs(value) < 0.005) return "–";
  return fmtNum(value, 0);
}

export default async function PortfolioPage({ searchParams }: PageProps<"/portfolio">) {
  const sp = await searchParams;
  const asOfParam = typeof sp.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : null;
  const asOf = asOfParam ? new Date(`${asOfParam}T00:00:00Z`) : new Date();
  const year = Number(sp.year) || asOf.getUTCFullYear();

  const book = await loadLoanBook({ asOf });
  const months = buildPortfolio(book.map((c) => c.schedule));
  const byKey = new Map(months.map((m) => [m.key, m]));
  const years = [...new Set(months.map((m) => Math.floor((m.key - 1) / 12)))];
  const shown = Array.from({ length: 12 }, (_, i) => byKey.get(monthKey(year, i + 1))).filter((m): m is PortfolioMonth => !!m);

  const currentKey = monthKeyOfDate(asOf);
  const current = byKey.get(currentKey);
  const ltm = months.filter((m) => m.key > currentKey - 12 && m.key <= currentKey);
  const ltmCollections = ltm.reduce((s, m) => s + m.installments, 0);
  const ltmDefaults = ltm.reduce((s, m) => s + m.defaults, 0);
  const maxDiff = Math.max(0, ...months.map((m) => Math.abs(m.reconciliationDiff)));
  const query = (y: number) => `/portfolio?${new URLSearchParams({ year: String(y), ...(asOfParam && { asOf: asOfParam }) })}`;

  return (
    <>
      <PageHeader
        title="Cartera / Waterfall"
        description="Réplica de la pestaña Summary del Borrowing Base: cobros, originación, default y roll-forward del principal pendiente."
        actions={
          <form className="flex items-end gap-2">
            <input type="hidden" name="year" value={year} />
            <div>
              <Label htmlFor="asOf">Fecha de cálculo</Label>
              <input id="asOf" name="asOf" type="date" defaultValue={asOfParam ?? asOf.toISOString().slice(0, 10)} className={inputClass} />
            </div>
            <button className="rounded-md border border-ink-600 px-3 py-2 text-sm text-slate-200 hover:border-mint-500/60">Recalcular</button>
          </form>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label={`Principal pendiente ${fmtMonthKey(currentKey)}`} value={fmtEur(current?.closingPrincipal)} accent />
        <Stat label="Cobros últimos 12 meses" value={fmtEur(ltmCollections)} />
        <Stat label="Default últimos 12 meses" value={fmtEur(ltmDefaults)} hint={current ? `acumulado ${fmtEur(current.cumulativeDefaults)}` : undefined} />
        <Stat label="Loss rate acumulado" value={fmtPct(current?.cumulativeLossRate)} hint="default / principal originado" />
      </div>

      <Card
        title={`Summary ${year}`}
        subtitle={`${book.length.toLocaleString("es-ES")} contratos firmados · control de cuadre máx. ${maxDiff.toExponential(1)} €`}
        action={
          <nav className="flex flex-wrap gap-1" aria-label="Año">
            {years.map((y) => (
              <Link key={y} href={query(y)} className={cn("rounded px-2 py-1 text-xs num", y === year ? "bg-mint-500/15 text-mint-400" : "text-slate-400 hover:text-slate-100")}>
                {y}
              </Link>
            ))}
          </nav>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-ink-900 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">Concepto</th>
                {shown.map((m) => (
                  <th key={m.key} className={cn("num px-3 py-2 text-right text-[11px] font-medium uppercase text-slate-400", m.key === currentKey && "text-mint-400")}>
                    {fmtMonthKey(m.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) =>
                row === "sep" ? (
                  <tr key={`sep-${i}`}><td colSpan={shown.length + 1} className="h-2 border-b border-ink-700" /></tr>
                ) : (
                  <tr key={row.label} className="hover:bg-ink-800/40">
                    <td className={cn("sticky left-0 z-10 whitespace-nowrap bg-ink-900 px-4 py-1.5", row.strong ? "font-semibold text-slate-100" : "text-slate-300", row.muted && "text-slate-500")}>
                      {row.label}
                      {row.ref && <span className="ml-2 text-[10px] text-slate-600">fila {row.ref}</span>}
                    </td>
                    {shown.map((m) => (
                      <td key={m.key} className={cn("num whitespace-nowrap px-3 py-1.5 text-right", row.strong ? "font-semibold text-slate-100" : "text-slate-300", row.muted && "text-slate-600", m.key === currentKey && "bg-mint-500/5")}>
                        {row.muted ? (row.get(m) ?? 0).toExponential(1) : cell(row.get(m), row.format)}
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
