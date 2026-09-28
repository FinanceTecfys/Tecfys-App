/**
 * Reader for the Holded sales export ("Holded_data_base_API.xlsx"): sheet
 * "Holded", title rows 1-3, header row 5, one document per row from row 6
 * until the first blank row (the export ends with a blank row and a
 * "Report powered automatically by Holded" footer).
 *
 * Every row goes through the same pure mapper as the API sync would use for
 * the target shape (src/modules/erp/domain/map-excel.ts).
 */
import ExcelJS from "exceljs";
import type { MapResult } from "../../src/modules/erp/domain/invoice";
import { buildHeaderIndex, HOLDED_HEADER_ROW, HOLDED_SHEET, isBlankRow, mapExcelRow } from "../../src/modules/erp/domain/map-excel";

/** Plain value of a cell: rich text flattened, formula results and hyperlinks unwrapped. */
function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  if ("richText" in value) return value.richText.map((t) => t.text).join("");
  if ("result" in value) return plain(value.result as ExcelJS.CellValue);
  if ("text" in value) return value.text;
  if ("error" in value) return null;
  return null;
}

const rowValues = (row: ExcelJS.Row, width: number) => Array.from({ length: width }, (_, i) => plain(row.getCell(i + 1).value));

export async function readHoldedWorkbook(path: string): Promise<MapResult[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet(HOLDED_SHEET);
  if (!ws) throw new Error(`Sheet "${HOLDED_SHEET}" not found in ${path}`);
  const width = ws.columnCount;
  const index = buildHeaderIndex(rowValues(ws.getRow(HOLDED_HEADER_ROW), width));

  const results: MapResult[] = [];
  for (let r = HOLDED_HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const cells = rowValues(ws.getRow(r), width);
    if (isBlankRow(cells)) break;
    results.push(mapExcelRow(cells, index, r));
  }
  return results;
}
