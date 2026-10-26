import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FileDown, FileSpreadsheet, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FilterBar, filterBoxClass, FilterCell, filterChipClass, filterSubmitClass } from "@/components/ui/filter-bar";
import { inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { PageSizeSelect } from "@/components/ui/page-size-select";
import { Pagination } from "@/components/ui/pagination";
import { Stat } from "@/components/ui/stat";
import { fmtDate, fmtEur } from "@/lib/format";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, paginate, parsePage, parsePageSize } from "@/lib/pagination";
import { requireRole } from "@/lib/supabase/auth";
import { LoanBookTable } from "@/modules/contracts/components/loan-book-table";
import { loadLoanBook } from "@/modules/contracts/data";
import { toLoanBookTableRow } from "@/modules/contracts/domain/loan-book-columns";
import {
  asOfForMonth,
  DEFAULT_SORT,
  filterLoanBook,
  type GroupFilter,
  hasLoanBookFilters,
  LOAN_BOOK_SORT_KEYS,
  LOAN_SIZE_BUCKETS,
  type LoanBookQuery,
  loanBookFilterOptions,
  loanBookSearch,
  parseLoanBookQuery,
  sortLoanBook,
  toSearchParams,
} from "@/modules/contracts/domain/loan-book-view";
import type { ContractStatus } from "@/modules/contracts/domain/schedule";

export const metadata = { title: "Loan book" };

// Labels are messages: loanBook.statusFilter.<value> and loanBook.filters.<label | all>.
const STATUSES = ["Active", "On Track", "Extended", "Finished", "draft"] as const satisfies readonly (ContractStatus | "draft")[];

const GROUP_SELECTS = [
  { name: "country", label: "country", all: "allCountries" },
  { name: "distributor", label: "distributor", all: "allDistributors" },
  { name: "cluster", label: "cluster", all: "allClusters" },
] as const satisfies readonly { name: GroupFilter; label: string; all: string }[];

export default async function ContractsPage({ searchParams }: PageProps<"/contracts">) {
  const user = await requireRole("loanBook.view");
  const sp = await searchParams;
  const t = await getTranslations("loanBook");
  const tCommon = await getTranslations("common");
  const query = parseLoanBookQuery(toSearchParams(sp));
  const sort = query.sort ?? DEFAULT_SORT;
  const current: LoanBookQuery = { ...query, sort };
  const { q = "", status = "" } = query;
  const pageSize = parsePageSize(sp.pageSize);
  // Dashboard drill-downs of a past period read the book as of that month.
  const asOf = asOfForMonth(query.asof, new Date());

  const book = await loadLoanBook({ includeDrafts: true, asOf });
  const rows = book.map(toLoanBookTableRow);
  const options = loanBookFilterOptions(rows, tCommon("noValue"));
  const filtered = sortLoanBook(filterLoanBook(rows, query), sort);
  const filtering = hasLoanBookFilters(query);
  const filteredOutstanding = filtered.reduce((s, r) => s + (r.outstanding ?? 0), 0);
  const filteredDefault = filtered.reduce((s, r) => s + (r.defaultAmount ?? 0), 0);
  // A page beyond the last one (a filter or a larger page size shrank the list) is clamped.
  const paging = paginate(filtered.length, pageSize, parsePage(sp.page));
  const visible = filtered.slice(paging.start, paging.end);

  const signed = rows.filter((r) => r.lifecycleStatus !== null);
  const live = signed.filter((r) => r.lifecycleStatus !== "Finished");
  const outstanding = signed.reduce((s, r) => s + (r.outstanding ?? 0), 0);

  const params = (extra: Record<string, string>) => loanBookSearch(current, extra);
  // The page size travels with every link of the listing; the page does not, so
  // a new filter, sort or page size starts again at page 1.
  const sizeParam = (size: number): Record<string, string> => (size === DEFAULT_PAGE_SIZE ? {} : { pageSize: String(size) });
  const hrefWith = (patch: Partial<LoanBookQuery>) => `/contracts?${loanBookSearch({ ...current, ...patch }, sizeParam(pageSize))}`;
  const pageHref = (page: number) => `/contracts?${params({ ...sizeParam(pageSize), ...(page > 1 ? { page: String(page) } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Loan book"
        description={query.asof ? t("descriptionAsOf", { date: fmtDate(asOf.toISOString()) }) : t("description")}
        actions={
          <>
            <a href={`/contracts/export?${params({ format: "xlsx" })}`} className="inline-flex items-center gap-2 rounded-md border border-ink-600 px-3.5 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel
            </a>
            <a href={`/contracts/export?${params({ format: "pdf" })}`} className="inline-flex items-center gap-2 rounded-md border border-ink-600 px-3.5 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
              <FileDown className="h-4 w-4" aria-hidden /> PDF
            </a>
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Stat interactive label={t("signedContracts")} value={signed.length.toLocaleString("es-ES")} hint={t("live", { count: live.length.toLocaleString("es-ES") })} />
        <Stat interactive label={t("outstanding")} value={fmtEur(outstanding)} accent />
        <Stat interactive label={t("drafts")} value={(rows.length - signed.length).toLocaleString("es-ES")} />
      </div>

      <Card bodyClassName="p-0">
        <FilterBar
          summary={
            <>
              {query.asof && (
                <span className="inline-flex items-center gap-2 rounded-md border border-mint-500/50 px-2.5 py-1 text-xs text-mint-400">
                  <input type="hidden" name="asof" value={query.asof} />
                  {t("asOfChip", { date: fmtDate(asOf.toISOString()) })}
                  <Link href={hrefWith({ asof: undefined })} aria-label={t("viewToday")} className="text-slate-400 hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </Link>
                </span>
              )}
              {pageSize !== DEFAULT_PAGE_SIZE && <input type="hidden" name="pageSize" value={pageSize} />}
              <span>
                {t("count", { count: filtered.length })}
                {filtering && (
                  <>
                    {" · "}<span className="num text-slate-300">{fmtEur(filteredOutstanding)}</span> {t("pending")}
                    {query.defaulted && <>{" · "}<span className="num text-red-300">{fmtEur(filteredDefault, 2)}</span> {t("defaultWord")}</>}
                  </>
                )}
              </span>
            </>
          }
          actions={
            <>
              {filtering && <Link href={pageSize === DEFAULT_PAGE_SIZE ? "/contracts" : `/contracts?pageSize=${pageSize}`} className="text-xs text-slate-400 hover:text-mint-400">{tCommon("actions.clearFilters")}</Link>}
              <button className={filterSubmitClass}>{tCommon("actions.apply")}</button>
            </>
          }
        >
          <FilterCell wide>
            <input name="q" defaultValue={q} placeholder={t("filters.searchPlaceholder")} className={inputClass} aria-label={t("filters.search")} />
          </FilterCell>
          <FilterCell>
            <select name="status" defaultValue={status} className={inputClass} aria-label={t("filters.status")}>
              <option value="">{t("filters.allStatuses")}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{t(`statusFilter.${s}`)}</option>)}
            </select>
          </FilterCell>
          <FilterCell>
            <select name="client" defaultValue={query.client ?? ""} className={inputClass} aria-label={t("filters.client")}>
              <option value="">{t("filters.allClients")}</option>
              {options.client.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FilterCell>
          {GROUP_SELECTS.map(({ name, label: labelKey, all }) => {
            const label = t(`filters.${labelKey}`);
            const values = query[name] ?? [];
            // Several values only arrive from a drill-down into "Otros": kept as a chip.
            if (values.length > 1) {
              return (
                <FilterCell key={name}>
                  <span className={filterChipClass}>
                    {values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
                    <span className="truncate">{t("filters.others", { label, count: values.length })}</span>
                    <Link href={hrefWith({ [name]: [] })} aria-label={t("filters.removeFilter", { label })} className="text-slate-400 hover:text-white">
                      <X className="h-3.5 w-3.5" />
                    </Link>
                  </span>
                </FilterCell>
              );
            }
            return (
              <FilterCell key={name}>
                <select name={name} defaultValue={values[0] ?? ""} className={inputClass} aria-label={label}>
                  <option value="">{t(`filters.${all}`)}</option>
                  {options[name].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </FilterCell>
            );
          })}
          <FilterCell>
            <select name="size" defaultValue={query.size ?? ""} className={inputClass} aria-label={t("filters.size")}>
              <option value="">{t("filters.allSizes")}</option>
              {LOAN_SIZE_BUCKETS.map((b) => <option key={b.key} value={b.key}>{t("filters.sizeOption", { range: b.label })}</option>)}
            </select>
          </FilterCell>
          <FilterCell wide>
            <label className={`${filterBoxClass} py-0 pr-1 text-slate-400`}>
              <span className="shrink-0">{t("filters.defaultIn")}</span>
              <input
                type="month"
                name="defaulted"
                defaultValue={query.defaulted ?? ""}
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-100 outline-none"
                aria-label={t("filters.defaultInAria")}
              />
            </label>
          </FilterCell>
          <FilterCell>
            <select name="sort" defaultValue={sort} className={inputClass} aria-label={t("filters.sortBy")}>
              {LOAN_BOOK_SORT_KEYS.map((value) => (
                <option key={value} value={value}>{t(`sorts.${value}`)}</option>
              ))}
            </select>
          </FilterCell>
          <FilterCell>
            <label className={filterBoxClass}>
              <input type="checkbox" name="pending" value="1" defaultChecked={query.pending} className="h-4 w-4 shrink-0 accent-mint-500" />
              <span className="truncate" title={t("filters.onlyPending")}>{t("filters.onlyPending")}</span>
            </label>
          </FilterCell>
        </FilterBar>
        <LoanBookTable rows={visible} userId={user.id} />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 text-sm text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PageSizeSelect value={pageSize} options={PAGE_SIZES.map((size) => ({ size, href: `/contracts?${params(sizeParam(size))}` }))} />
            <span className="num" aria-live="polite">
              {tCommon("pagination.range", { from: paging.from.toLocaleString("es-ES"), to: paging.to.toLocaleString("es-ES"), total: paging.total.toLocaleString("es-ES") })}
            </span>
          </div>
          <Pagination items={paging.items} page={paging.page} pages={paging.pages} hrefFor={pageHref} />
        </div>
      </Card>
    </>
  );
}
