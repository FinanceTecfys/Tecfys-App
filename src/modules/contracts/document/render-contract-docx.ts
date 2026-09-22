import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { ContractTemplateData } from "../domain/contract-template";

/** Path of the tagged template, relative to the project root. */
export const CONTRACT_TEMPLATE_PATH = "templates/contract-template.docx";

/**
 * Fill the tagged Word template. Throws on malformed tags or on a tag the data
 * does not provide, so a broken template never produces a half-filled contract.
 */
export function renderContractDocx(template: Buffer | Uint8Array, data: ContractTemplateData): Buffer {
  const doc = new Docxtemplater(new PizZip(template), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part) => {
      throw new Error(`Contract template tag without data: ${part.value}`);
    },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}
