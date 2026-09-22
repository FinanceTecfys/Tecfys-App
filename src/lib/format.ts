const eur0 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Sub-cent float noise (e.g. -2e-10 on a fully amortised contract) prints as 0, never "-0 €". */
export const fmtEur = (n: number | null | undefined, decimals: 0 | 2 = 0) =>
  isNum(n) ? (decimals === 2 ? eur2 : eur0).format(Math.abs(n) < 0.005 ? 0 : n) : "—";

export const fmtNum = (n: number | null | undefined, decimals = 2) =>
  isNum(n) ? n.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—";

export const fmtPct = (n: number | null | undefined, decimals = 2) =>
  isNum(n) ? `${(n * 100).toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %` : "—";

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC" }) : "—";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const fmtMonthKey = (key: number) => {
  const month = ((key - 1) % 12) + 1;
  return `${MONTHS[month - 1]}-${String((key - month) / 12).slice(2)}`;
};
