import type { NextRequest } from "next/server";
import { dataScopeFor } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { downloadAttachment, findAttachment } from "@/modules/contracts/data";
import { serveAttachment } from "@/modules/contracts/domain/attachments";

/** Stream a contract attachment from the private bucket (never a public or signed URL). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/contracts/[id]/attachments/[kind]">) {
  const scope = dataScopeFor(await requireRole("contract.view"));
  // Outside the user's scope the attachment does not exist: 404, same as a wrong id.
  return serveAttachment(await ctx.params, { find: (id, kind) => findAttachment(id, kind, scope), download: downloadAttachment });
}
