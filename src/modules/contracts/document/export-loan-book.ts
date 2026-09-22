/**
 * Loan book exports. Both formats render the same columns, in the same order,
 * from the same rows (src/modules/contracts/domain/loan-book-view.ts), so the
 * Excel and the PDF can never disagree with the screen.
 */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  EXPORT_COLUMNS,
  EXPORT_TOTAL_COLUMNS,
  exportTotals,
  type ExportColumn,
  type LoanBookRowView,
} from "../domain/loan-book-view";

export interface ExportContext {
  /** Human description of the filters in force, printed on the export. */
  filters: string;
  generatedAt: Date;
}

const EXCEL_FORMAT: Record<ExportColumn["type"], string | undefined> = {
  text: undefined,
  number: "0",
  money: "#,##0.00",
  percent: "0.00%",
  date: "dd/mm/yyyy",
};

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export async function loanBookToXlsx(rows: LoanBookRowView[], ctx: ExportContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tecfys";
  wb.created = ctx.generatedAt;
  const ws = wb.addWorksheet("Loan book", { views: [{ state: "frozen", ySplit: 3 }] });

  ws.mergeCells(1, 1, 1, EXPORT_COLUMNS.length);
  ws.getCell(1, 1).value = `Tecfys · Loan book · ${ctx.generatedAt.toLocaleDateString("es-ES")}`;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, EXPORT_COLUMNS.length);
  ws.getCell(2, 1).value = `${rows.length} contratos · ${ctx.filters}`;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF666666" } };

  const header = ws.addRow(EXPORT_COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0C2618" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
  });
  EXPORT_COLUMNS.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.width = c.width;
    column.numFmt = EXCEL_FORMAT[c.type];
    column.alignment = { horizontal: c.type === "text" ? "left" : "right" };
  });

  for (const row of rows) {
    ws.addRow(
      EXPORT_COLUMNS.map((c) => {
        const v = c.value(row);
        if (v === null) return null;
        return c.type === "date" && typeof v === "string" ? toDate(v) : v;
      }),
    );
  }

  const totals = exportTotals(rows);
  const totalRow = ws.addRow(
    EXPORT_COLUMNS.map((c, i) => {
      if (i === 0) return "TOTAL";
      return (EXPORT_TOTAL_COLUMNS as readonly string[]).includes(c.key) ? totals[c.key] : null;
    }),
  );
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "thin" } };
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: EXPORT_COLUMNS.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const es = (n: number, decimals = 2) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: "always" });

/** Cell text for the PDF (and for any plain-text rendering of a row). */
export function formatExportCell(column: ExportColumn, row: LoanBookRowView): string {
  const v = column.value(row);
  if (v === null || v === "") return "—";
  switch (column.type) {
    case "money":
      return es(Number(v));
    case "percent":
      return `${es(Number(v) * 100, 1)} %`;
    case "number":
      return es(Number(v), 0);
    case "date":
      return toDate(String(v)).toLocaleDateString("es-ES", { timeZone: "UTC" });
    default:
      return String(v);
  }
}

export function loanBookToPdf(rows: LoanBookRowView[], ctx: ExportContext): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const totalWidth = EXPORT_COLUMNS.reduce((s, c) => s + c.width, 0);
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const widths = EXPORT_COLUMNS.map((c) => (c.width / totalWidth) * usable);
  const rowHeight = 14;

  const drawHeader = () => {
    doc.fontSize(13).fillColor("#0C2618").text(`Tecfys · Loan book`, { continued: false });
    doc.fontSize(8).fillColor("#555").text(`${rows.length} contratos · ${ctx.filters} · generado el ${ctx.generatedAt.toLocaleString("es-ES")}`);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(doc.page.margins.left, y - 2, usable, rowHeight).fill("#0C2618");
    doc.fontSize(6.5).fillColor("#FFFFFF");
    let x = doc.page.margins.left;
    EXPORT_COLUMNS.forEach((c, i) => {
      doc.text(c.header, x + 2, y + 2, { width: widths[i] - 4, align: c.type === "text" ? "left" : "right", lineBreak: false });
      x += widths[i];
    });
    doc.y = y + rowHeight;
  };

  drawHeader();
  doc.fontSize(6.5);
  for (const [index, row] of rows.entries()) {
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
      doc.fontSize(6.5);
    }
    const y = doc.y;
    if (index % 2 === 1) doc.rect(doc.page.margins.left, y - 1, usable, rowHeight).fill("#F2F5F2");
    doc.fillColor("#111111");
    let x = doc.page.margins.left;
    EXPORT_COLUMNS.forEach((c, i) => {
      doc.text(formatExportCell(c, row), x + 2, y + 2, { width: widths[i] - 4, align: c.type === "text" ? "left" : "right", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + rowHeight;
  }

  const totals = exportTotals(rows);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + usable, y).stroke("#0C2618");
  let x = doc.page.margins.left;
  doc.fillColor("#0C2618").fontSize(7);
  EXPORT_COLUMNS.forEach((c, i) => {
    const text = i === 0 ? "TOTAL" : (EXPORT_TOTAL_COLUMNS as readonly string[]).includes(c.key) ? es(totals[c.key]) : "";
    doc.text(text, x + 2, y + 3, { width: widths[i] - 4, align: c.type === "text" ? "left" : "right", lineBreak: false });
    x += widths[i];
  });

  doc.end();
  return done;
}
