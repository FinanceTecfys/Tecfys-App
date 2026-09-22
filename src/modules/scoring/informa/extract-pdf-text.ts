import "server-only";
import { getDocumentProxy } from "unpdf";

/** Text of every page, items joined with spaces (the layout the parser expects). */
export async function extractInformaText(pdf: ArrayBuffer): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  let all = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    all += `\n\n=== PAGE ${i} ===\n${text}`;
  }
  return all;
}
