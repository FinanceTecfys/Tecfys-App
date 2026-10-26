import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { SyncPanel } from "@/modules/erp/components/sync-panel";
import { ERP_PAGE_SIZE, lastSyncRun, listHoldedInvoices } from "@/modules/erp/data";
import { erpSearch, HOLDED_STATUSES, parseErpQuery, STATUS_TONES } from "@/modules/erp/domain/erp-view";
import { HOLDED_COLUMNS } from "@/modules/erp/domain/invoice";
import { isHoldedConfigured } from "@/modules/erp/holded/server";

export const metadata = { title: "ERP · Holded" };

/** Money as Holded shows it: two decimals, negatives (credit notes) in red. */
function Money({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-600">—</span>;
  return <span className={value < 0 ? "text-red-300" : undefined}>{fmtNum(value, 2)} €</span>;
}

export default async function ErpPage({ searchParams }: PageProps<"/erp">) {
  await requireRole("erp.view");
  const query = parseErpQuery(await searchParams);
  const t = await getTranslations("erp");
  const tCommon = await getTranslations("common");
  const [{ rows, count }, run] = await Promise.all([listHoldedInvoices(query), lastSyncRun()]);
  const pages = Math.max(1, Math.ceil(count / ERP_PAGE_SIZE));
  const filtering = Boolean(query.q || query.status);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <Card title={t("syncTitle")} className="mb-6">
        <SyncPanel
          configured={isHoldedConfigured()}
          lastRun={
            run && {
              source: run.source,
              status: run.status,
              startedAt: run.started_at,
              finishedAt: run.finished_at,
              counts: { fetched: run.fetched, created: run.created, updated: run.updated, skipped: run.skipped, invalid: run.invalid },
              error: run.error,
              messages: run.messages,
            }
          }
        />
      </Card>

      <Card bodyClassName="p-0">
        <form className="flex flex-wrap gap-3 border-b border-ink-700 p-4" role="search">
          <input name="q" defaultValue={query.q} placeholder={t("searchPlaceholder")} className={`${inputClass} max-w-sm`} aria-label={tCommon("actions.search")} />
          <select name="status" defaultValue={query.status ?? ""} className={`${inputClass} w-44`} aria-label={t("status")}>
            <option value="">{t("allStatuses")}</option>
            {HOLDED_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="rounded-md border border-ink-600 px-4 text-sm text-slate-200 hover:border-mint-500/60">{tCommon("actions.search")}</button>
          {filtering && <Link href="/erp" className="self-center text-xs text-slate-400 hover:text-mint-400">{tCommon("actions.clearFilters")}</Link>}
          <span className="ml-auto self-center text-xs text-slate-500">{t("documents", { count: count.toLocaleString("es-ES") })}</span>
        </form>
        <Table>
          <thead>
            <tr>
              {HOLDED_COLUMNS.map((c) => <Th key={c.key} right={c.kind === "money"}>{t(`columns.${c.key}`)}</Th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={HOLDED_COLUMNS.length} className="border-b border-ink-800 px-3 py-8 text-center text-sm text-slate-500">
                  {filtering ? t("noMatch") : t("empty")}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-ink-800/50">
                {HOLDED_COLUMNS.map((c) => {
                  const value = r[c.key];
                  if (c.kind === "money") return <Td key={c.key} right mono><Money value={value as number | null} /></Td>;
                  if (c.kind === "date") return <Td key={c.key}>{fmtDate(value as string | null)}</Td>;
                  if (c.key === "num") return <Td key={c.key} mono className="font-medium text-slate-100">{r.num}</Td>;
                  if (c.key === "status") {
                    return <Td key={c.key}>{r.status ? <Badge tone={STATUS_TONES[r.status] ?? "slate"}>{r.status}</Badge> : <span className="text-slate-600">—</span>}</Td>;
                  }
                  const text = value as string | null;
                  return (
                    <Td key={c.key} className="max-w-56 truncate text-slate-300" title={text ?? undefined}>
                      {text ?? <span className="text-slate-600">—</span>}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
        <nav className="flex items-center justify-between p-4 text-sm text-slate-400" aria-label={tCommon("pagination.ariaLabel")}>
          <span>{tCommon("pagination.pageOf", { page: Math.min(query.page, pages), pages })}</span>
          <div className="flex gap-2">
            {query.page > 1 && <Link href={`/erp?${erpSearch(query, { page: query.page - 1 })}`} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">{tCommon("pagination.previousShort")}</Link>}
            {query.page < pages && <Link href={`/erp?${erpSearch(query, { page: query.page + 1 })}`} className="rounded-md border border-ink-600 px-3 py-1 hover:border-mint-500/60">{tCommon("pagination.nextShort")}</Link>}
          </div>
        </nav>
      </Card>
    </>
  );
}
