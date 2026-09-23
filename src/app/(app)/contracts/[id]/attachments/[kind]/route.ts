import type { NextRequest } from "next/server";
import { downloadAttachment, findAttachment } from "@/modules/contracts/data";
import { serveAttachment } from "@/modules/contracts/domain/attachments";

/** Stream a contract attachment from the private bucket (never a public or signed URL). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/contracts/[id]/attachments/[kind]">) {
  return serveAttachment(await ctx.params, { find: findAttachment, download: downloadAttachment });
}
