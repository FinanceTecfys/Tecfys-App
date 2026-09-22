/**
 * Build the docxtemplater template from Tecfys' Word contract.
 *
 *   npx tsx scripts/build-contract-template.ts
 *
 * Reads  templates/source/Tecfys contract Template.docx  (never modified)
 * Writes templates/contract-template.docx                (tagged copy)
 *
 * Every rule names the exact runs it expects in a paragraph. If legal edits
 * the Word file and a paragraph no longer matches, the script fails instead of
 * silently producing a template with "xxx" left in it. The "Condiciones
 * Particulares" live in text boxes that Word stores twice (mc:Choice and the
 * VML mc:Fallback copy), so most rules must match exactly two paragraphs.
 * The field -> tag mapping is documented in templates/README.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";

const SOURCE = "templates/source/Tecfys contract Template.docx";
const TARGET = "templates/contract-template.docx";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** `sizeFrom`: copy the font size of another run of the paragraph (fixes placeholders set in a smaller font). */
type Edit = { run: number; text: string; sizeFrom?: number };
interface Rule {
  name: string;
  /** Exact texts of the paragraph's direct runs. */
  runs: string[];
  edits: Edit[];
  expected: number;
}

const RULES: Rule[] = [
  {
    name: "Nº de contrato (cabecera)",
    runs: ["    ", "Contrato ", "nº", ": "],
    edits: [{ run: 3, text: ": {contract_number}" }],
    expected: 1,
  },
  {
    name: "Cliente",
    runs: ["xxx", " (en adelante El Cliente) con CIF ", "xxx", " y domicilio fiscal en Calle ", "xxx", ", representada por ", "xxx", " con DNI ", "xxx", " y domicilio ", "xxx"],
    edits: [
      { run: 0, text: "{client_name}" },
      { run: 2, text: "{client_cif}" },
      { run: 4, text: "{client_fiscal_address}" },
      { run: 6, text: "{signatory_name}" },
      { run: 8, text: "{signatory_nif}" },
      { run: 9, text: "{#signatory_address} y domicilio " },
      { run: 10, text: "{signatory_address}{/signatory_address}" },
    ],
    expected: 2,
  },
  {
    // Also fixes the template's "(en adelante El Cliente)" on the guarantor line.
    name: "Avalista",
    runs: ["XXX (en adelante El Cliente) con CIF ", "XXX  y", " domicilio en XXX representada por XXX con DNI XXX"],
    edits: [
      { run: 0, text: "{#has_guarantor}{guarantor_name} (en adelante El Avalista) con CIF " },
      { run: 1, text: "{guarantor_nif} y" },
      {
        run: 2,
        text:
          " domicilio en {guarantor_address}{#guarantor_representative} representada por {guarantor_representative} con DNI {guarantor_representative_nif}{/guarantor_representative}{/has_guarantor}{^has_guarantor}Sin avalista{/has_guarantor}",
      },
    ],
    expected: 2,
  },
  {
    name: "Descripción del producto",
    runs: ["XXX, ", "que será atendidos mediante el pago de un", " ", "mínimo de ", "XX cuotas ", "mensuales "],
    edits: [
      // The "XXX, " placeholder is 5 pt in the source; the paragraph text is 8 pt.
      { run: 0, text: "{product_description}, ", sizeFrom: 1 },
      { run: 4, text: "{duration_months} cuotas " },
    ],
    expected: 2,
  },
  {
    name: "Importe de la cuota",
    runs: ["Importe mensual de la cuota: XX ", "€ ", " ", "(", "I.V.A. NO incluido)", "."],
    edits: [{ run: 0, text: "Importe mensual de la cuota: {installment} " }],
    expected: 2,
  },
  {
    name: "Domicilio de entrega",
    runs: ["DOMICILIO DE ENTREGA ", "XXXX"],
    edits: [{ run: 1, text: "{delivery_address}" }],
    expected: 2,
  },
  {
    name: "SEPA - nombre del deudor",
    runs: ["Nombre del deudor/es ", "(titulares de a cuenta de cargo)", ":"],
    edits: [{ run: 2, text: ": {sepa_debtor_name}" }],
    expected: 2,
  },
  {
    name: "SEPA - dirección del deudor",
    runs: ["Dirección", " del ", "deudor", ": "],
    edits: [{ run: 3, text: ": {sepa_debtor_street}" }],
    expected: 2,
  },
  {
    name: "SEPA - código postal",
    runs: ["Código Postal: "],
    edits: [{ run: 0, text: "Código Postal: {sepa_debtor_postal_code}" }],
    expected: 2,
  },
  {
    name: "SEPA - ciudad",
    runs: ["Ciudad (Provincia): "],
    edits: [{ run: 0, text: "Ciudad (Provincia): {sepa_debtor_city}" }],
    expected: 2,
  },
  {
    name: "SEPA - IBAN",
    runs: ["IBAN", " (", "número", " de ", "cuenta", "): ", "ES"],
    edits: [{ run: 6, text: "{sepa_iban}" }],
    expected: 2,
  },
  {
    name: "SEPA - fecha",
    runs: ["Fecha", ": "],
    edits: [{ run: 1, text: ": {sepa_date}" }],
    expected: 2,
  },
  {
    name: "SEPA - lugar",
    runs: ["Lugar: "],
    edits: [{ run: 0, text: "Lugar: {sepa_place}" }],
    expected: 2,
  },
  { name: "Notificaciones - contacto", runs: ["Contacto: XXX"], edits: [{ run: 0, text: "Contacto: {contact_name}" }], expected: 2 },
  { name: "Notificaciones - teléfono", runs: ["Teléfono: XXX"], edits: [{ run: 0, text: "Teléfono: {contact_phone}" }], expected: 2 },
  { name: "Notificaciones - email", runs: ["Email: XXX"], edits: [{ run: 0, text: "Email: {contact_email}" }], expected: 2 },
  {
    name: "Remisión al Anexo I",
    runs: ["Condiciones ", "Generales :", " Ver Anexo I del contrato ", "nº", " "],
    edits: [{ run: 4, text: " {contract_number}" }],
    expected: 2,
  },
  {
    name: "Título del Anexo I",
    runs: ["Condiciones Generales del Contrato ", "nº", " "],
    edits: [{ run: 2, text: " {contract_number}" }],
    expected: 1,
  },
];

function directRuns(p: Element): Element[] {
  const out: Element[] = [];
  for (let n = p.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === "r") out.push(n as Element);
  }
  return out;
}

function runText(r: Element): string {
  let s = "";
  const ts = r.getElementsByTagNameNS(W, "t");
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent ?? "";
  return s;
}

function setRunText(r: Element, text: string) {
  const ts = r.getElementsByTagNameNS(W, "t");
  const first = ts[0];
  for (let i = ts.length - 1; i >= 1; i--) ts[i].parentNode?.removeChild(ts[i]);
  first.textContent = text;
  first.setAttribute("xml:space", "preserve");
}

function copyFontSize(target: Element, source: Element) {
  for (const tag of ["sz", "szCs"]) {
    const src = source.getElementsByTagNameNS(W, tag)[0];
    const dst = target.getElementsByTagNameNS(W, tag)[0];
    if (src && dst) dst.setAttributeNS(W, "w:val", src.getAttributeNS(W, "val") ?? "");
    else if (src && !dst) target.getElementsByTagNameNS(W, "rPr")[0]?.appendChild(src.cloneNode(true));
  }
}

function main() {
  const zip = new PizZip(readFileSync(SOURCE));
  const xml = zip.file("word/document.xml")!.asText();
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const paragraphs = doc.getElementsByTagNameNS(W, "p");

  const hits = new Map<string, number>();
  for (let i = 0; i < paragraphs.length; i++) {
    const runs = directRuns(paragraphs[i]);
    const texts = runs.map(runText);
    for (const rule of RULES) {
      if (texts.length !== rule.runs.length || texts.some((t, k) => t !== rule.runs[k])) continue;
      for (const e of rule.edits) {
        setRunText(runs[e.run], e.text);
        if (e.sizeFrom !== undefined) copyFontSize(runs[e.run], runs[e.sizeFrom]);
      }
      hits.set(rule.name, (hits.get(rule.name) ?? 0) + 1);
    }
  }

  const problems = RULES.filter((r) => (hits.get(r.name) ?? 0) !== r.expected).map(
    (r) => `  - ${r.name}: expected ${r.expected} paragraph(s), matched ${hits.get(r.name) ?? 0}`,
  );
  if (problems.length) throw new Error(`The source template no longer matches:\n${problems.join("\n")}`);

  const out = new XMLSerializer().serializeToString(doc);
  const leftovers = (out.match(/<w:t[^>]*>[^<]*\b(?:x{2,}|X{2,})\b[^<]*<\/w:t>/g) ?? []).length;
  if (leftovers) throw new Error(`${leftovers} "xxx" markers left untagged`);

  zip.file("word/document.xml", out);
  writeFileSync(TARGET, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`Wrote ${TARGET}: ${RULES.length} rules, ${[...hits.values()].reduce((a, b) => a + b, 0)} paragraphs tagged`);
}

main();
