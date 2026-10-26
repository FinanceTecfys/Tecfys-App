/**
 * Provenance of the Informa report behind a scoring, computed in memory.
 *
 * Tecfys does not retain Informa reports: neither the uploaded PDF nor the raw
 * API response is stored or logged anywhere. What is kept is the mapped data
 * the scoring needs plus this provenance: where the data came from, the
 * report's own date, and - for a PDF - its file name and the SHA-256 of its
 * bytes, so a scoring can later be matched to the exact file the analyst
 * used without Tecfys holding that file.
 */

export type ReportSource = "pdf" | "api";

export interface ReportProvenance {
  source: ReportSource;
  /** The report's own date (ISO yyyy-mm-dd), when the report states one. */
  reportDate: string | null;
  /** pdf only: the uploaded file's name. */
  fileName: string | null;
  /** pdf only: lowercase hex SHA-256 of the uploaded bytes. */
  fileSha256: string | null;
  /** api only: when the report was fetched (ISO timestamp). */
  fetchedAt: string | null;
}

/** The informa_reports receipt columns a scoring's provenance is copied from. */
export interface ProvenanceReceipt {
  source: "informa_pdf" | "informa_api" | "manual";
  file_name: string | null;
  file_sha256: string | null;
  report_date: string | null;
  fetched_at: string | null;
}

/** A receipt as scoring provenance: file fields for a pdf only, fetch time for the api only. */
export function receiptProvenance(receipt: ProvenanceReceipt): ReportProvenance | null {
  if (receipt.source === "manual") return null;
  const pdf = receipt.source === "informa_pdf";
  return {
    source: pdf ? "pdf" : "api",
    reportDate: receipt.report_date,
    fileName: pdf ? receipt.file_name : null,
    fileSha256: pdf ? receipt.file_sha256 : null,
    fetchedAt: pdf ? null : receipt.fetched_at,
  };
}

/** Lowercase hex SHA-256 of the bytes (Web Crypto: the same in Node and the edge). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "dd/mm/yyyy" -> "yyyy-mm-dd" when it is a real calendar date, else null. */
export function dmyToIso(dmy: string): string | null {
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  return date.getUTCFullYear() === +y && date.getUTCMonth() === +mo - 1 && date.getUTCDate() === +d ? `${y}-${mo}-${d}` : null;
}

/**
 * The issue date of an Informa Comercial PDF: every page header reads
 * "Usuario: <portal user> Fecha: dd/mm/yyyy". Only the date is taken - never the
 * portal user, which is not ours to keep.
 */
export function pdfReportDate(text: string): string | null {
  const m = text.match(/Usuario:\s*\S+\s+Fecha:\s*(\d{2}\/\d{2}\/\d{4})/);
  return m ? dmyToIso(m[1]) : null;
}

/**
 * The date of an API report: datosGenerales.fechaUltimoDatoIncluidoInforme
 * ("date of the latest data included in this report", ISO), the closest the
 * API has to an issue date. Reads that one field of the response and nothing else.
 */
export function apiReportDate(report: unknown): string | null {
  const at = (v: unknown, key: string) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined);
  const value = at(at(at(at(report, "datosProducto"), "informacionComercial"), "datosGenerales"), "fechaUltimoDatoIncluidoInforme");
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}
