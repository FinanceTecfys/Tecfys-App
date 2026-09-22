/**
 * SEPA helpers: IBAN / BIC validation for the direct-debit mandate.
 * Pure functions, shared by the operation form (live feedback) and the
 * server action (authoritative validation).
 */

/** IBAN length per country, SEPA scheme members (ISO 13616 registry). */
const IBAN_LENGTH: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

/**
 * BIC of the main Spanish entities, by the 4-digit bank code (IBAN chars 5-8).
 * Used only to prefill the BIC; the analyst can always overwrite it.
 */
const SPANISH_BANK_BIC: Record<string, string> = {
  "0019": "DEUTESBBXXX", // Deutsche Bank
  "0049": "BSCHESMMXXX", // Banco Santander
  "0061": "BMARES2MXXX", // Banca March
  "0073": "OPENESMMXXX", // Openbank
  "0075": "POPUESMMXXX", // Banco Popular (Santander)
  "0081": "BSABESBBXXX", // Banco Sabadell
  "0128": "BKBKESMMXXX", // Bankinter
  "0182": "BBVAESMMXXX", // BBVA
  "0186": "BFIVESBBXXX", // Banco Mediolanum
  "0216": "CMCIESMMXXX", // Targobank
  "0237": "CSURES2CXXX", // Cajasur
  "0239": "EVOBESMMXXX", // EVO Banco
  "1465": "INGDESMMXXX", // ING
  "1491": "TRIOESMMXXX", // Triodos Bank
  "2038": "CAHMESMMXXX", // Bankia (CaixaBank)
  "2080": "CAGLESMMXXX", // Abanca
  "2085": "CAZRES2ZXXX", // Ibercaja
  "2095": "BASKES2BXXX", // Kutxabank
  "2100": "CAIXESBBXXX", // CaixaBank
  "2103": "UCJAES2MXXX", // Unicaja
  "3025": "CDENESBBXXX", // Caixa d'Enginyers
  "3035": "CLPEES2MXXX", // Laboral Kutxa
  "3058": "CCRIES2AXXX", // Cajamar
};

/** Upper-case and strip spaces / separators ("es91 2100-0418 ..." -> "ES9121000418..."). */
export const normalizeIban = (raw: string) => raw.replace(/[\s.-]/g, "").toUpperCase();

/** "ES9121000418450200051332" -> "ES91 2100 0418 4502 0005 1332". */
export const formatIban = (iban: string) => normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();

export type IbanError = "empty" | "format" | "country" | "length" | "checksum" | "national_check";

export function validateIban(raw: string): { ok: true; iban: string } | { ok: false; error: IbanError } {
  const iban = normalizeIban(raw);
  if (!iban) return { ok: false, error: "empty" };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { ok: false, error: "format" };
  const expected = IBAN_LENGTH[iban.slice(0, 2)];
  if (!expected) return { ok: false, error: "country" };
  if (iban.length !== expected) return { ok: false, error: "length" };
  if (mod97(iban.slice(4) + iban.slice(0, 4)) !== 1) return { ok: false, error: "checksum" };
  if (iban.startsWith("ES") && !validSpanishControlDigits(iban)) return { ok: false, error: "national_check" };
  return { ok: true, iban };
}

export const IBAN_ERROR_MESSAGES: Record<IbanError, string> = {
  empty: "Indica el IBAN",
  format: "Formato de IBAN no válido",
  country: "País no admitido en SEPA",
  length: "Longitud incorrecta para el país",
  checksum: "Dígitos de control del IBAN incorrectos",
  national_check: "Dígitos de control de la cuenta (CCC) incorrectos",
};

/** ISO 7064 mod 97-10 over the IBAN with letters mapped A=10 .. Z=35. */
function mod97(value: string): number {
  let remainder = 0;
  for (const ch of value) {
    const digits = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder;
}

/** Spanish CCC: 2 check digits over (entity + branch) and over the account number. */
function validSpanishControlDigits(iban: string): boolean {
  const bban = iban.slice(4); // EEEE OOOO DD NNNNNNNNNN
  const digit = (value: string, weights: number[]) => {
    const sum = [...value].reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = 11 - (sum % 11);
    return r === 11 ? 0 : r === 10 ? 1 : r;
  };
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const first = digit(`00${bban.slice(0, 8)}`, weights);
  const second = digit(bban.slice(10, 20), weights);
  return `${first}${second}` === bban.slice(8, 10);
}

export const normalizeBic = (raw: string) => raw.replace(/\s/g, "").toUpperCase();

/** ISO 9362: 4 bank + 2 country + 2 location (+ 3 branch). */
export const isValidBic = (raw: string) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(raw));

/** BIC for a Spanish IBAN when the entity is known; null otherwise. */
export function deriveBic(raw: string): string | null {
  const iban = normalizeIban(raw);
  if (!iban.startsWith("ES") || iban.length < 8) return null;
  return SPANISH_BANK_BIC[iban.slice(4, 8)] ?? null;
}

/** A BIC whose country (chars 5-6) differs from the IBAN's is almost always a typo. */
export const bicMatchesIbanCountry = (bic: string, iban: string) =>
  normalizeBic(bic).slice(4, 6) === normalizeIban(iban).slice(0, 2);
