/**
 * Value normalisation shared by the Holded API mapper and the Excel mapper.
 * Pure: no I/O, no clock.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Money to a number rounded to the cent. Accepts numbers and the formatted
 * strings Holded exports ("768.35€", "-180.29€", "14,253.72€", "1.234,56 €",
 * "121.00"). Blank / unparseable -> null.
 *
 * Separator rule: when both "." and "," appear, the LAST one is the decimal
 * separator. With a single kind, it is decimal only if it appears once and is
 * followed by 1-2 digits ("12,5" / "0.00"); otherwise it groups thousands.
 */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : null;
  if (typeof value !== "string") return null;
  let s = value.replace(/[€\s ]/g, "").replace(/EUR$/i, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    normalized = s.split(group).join("").replace(decimal, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (!sep) normalized = s;
    else {
      const parts = s.split(sep);
      const isDecimal = parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2;
      normalized = isDecimal ? `${parts[0]}.${parts[1]}` : parts.join("");
    }
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || normalized === "" || normalized === ".") return null;
  return round2(negative ? -n : n);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const EU_DAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const dayIso = (y: number, m: number, d: number) => {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return back.toISOString();
};

/**
 * A Holded date as the ISO timestamp of that calendar day at 00:00 UTC.
 *
 * Holded dates are calendar days. The Excel export stamps every date with the
 * clock time of the export (all rows read 11:13:2x UTC), so the time of day is
 * noise and is dropped; the API returns "YYYY-MM-DD". Accepts a Date (ExcelJS
 * reads serials as UTC), an ISO string, "dd/mm/yyyy", or unix seconds (the
 * legacy v1 API format). Anything else -> null.
 */
export function parseHoldedDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : dayIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return parseHoldedDate(new Date(value * 1000));
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  const iso = ISO_DAY.exec(s);
  if (iso) return dayIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const eu = EU_DAY.exec(s);
  if (eu) return dayIso(Number(eu[3]), Number(eu[2]), Number(eu[1]));
  return null;
}

/** Trimmed text with inner whitespace runs collapsed; blank or "-" -> null. Numbers become strings. */
export function cleanText(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s === "" || s === "-" ? null : s;
}
