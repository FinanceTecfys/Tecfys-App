import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/auth";
import { draftSourceFromContract, getContract } from "@/modules/contracts/data";
import { renderContractDocx } from "@/modules/contracts/document/render-contract-docx";
import { buildContractTemplateData } from "@/modules/contracts/domain/contract-template";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Download the contract filled from its stored snapshot (templates/contract-template.docx). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/contracts/[id]/draft">) {
  await requireUser();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });

  const contract = await getContract(id);
  if (!contract) return new Response("Not found", { status: 404 });
  const source = draftSourceFromContract(contract);
  if (!source) return new Response("This contract has no identification / SEPA data to fill the template", { status: 409 });

  // Literal segments (= CONTRACT_TEMPLATE_PATH) so output tracing only includes templates/.
  const template = await readFile(path.join(process.cwd(), "templates", "contract-template.docx"));
  const docx = renderContractDocx(template, buildContractTemplateData(source));

  const suffix = contract.workflow_status === "signed" ? "" : "_BORRADOR";
  return new Response(new Uint8Array(docx), {
    headers: {
      "Content-Type": DOCX,
      "Content-Disposition": `attachment; filename="Contrato_${contract.contract_number}${suffix}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
