/**
 * Number, currency and date formatting. ALWAYS es-ES, whatever the interface
 * language: "1.234,56 €" and dd/mm/yyyy in Spanish and in English alike. The
 * figures are reconciled to the Borrowing Base workbook and are read, copied
 * and compared between users; a separator that changed with each reader's
 * language ("1.234,56" vs "1,234.56") would make the same amount ambiguous.
 * The language (src/i18n) only changes words, never these formats.
 */
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
