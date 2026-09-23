import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/auth";
import { loadLoanBook } from "@/modules/contracts/data";
import { loanBookToPdf, loanBookToXlsx } from "@/modules/contracts/document/export-loan-book";
import {
  asOfForMonth,
  DEFAULT_SORT,
  filterLoanBook,
  LOAN_BOOK_SORTS,
  LOAN_SIZE_BUCKETS,
  parseLoanBookQuery,
  sortLoanBook,
  toLoanBookRow,
} from "@/modules/contracts/domain/loan-book-view";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

/** Export the loan book honouring the filters and the sort of the listing. */
export async function GET(request: NextRequest) {
  await requireUser();
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const query = parseLoanBookQuery(sp);
  const sort = query.sort ?? DEFAULT_SORT;

  const book = await loadLoanBook({ includeDrafts: true, asOf: asOfForMonth(query.asof, new Date()) });
  const rows = sortLoanBook(filterLoanBook(book.map(toLoanBookRow), query), sort);

  const list = (label: string, values: string[] | undefined) => (values?.length ? `${label} ${values.join(", ")}` : null);
  const filters = [
    query.q ? `búsqueda "${query.q}"` : null,
    query.status ? `estado ${query.status}` : "todos los estados",
    query.client ? `cliente ${query.client}` : null,
    list("país", query.country),
    list("distribuidor", query.distributor),
    list("grupo de activo", query.cluster),
    query.size ? `pendiente ${LOAN_SIZE_BUCKETS.find((b) => b.key === query.size)?.label}` : null,
    query.defaulted ? `default en ${query.defaulted}` : null,
    query.pending ? "solo con principal pendiente" : null,
    query.asof ? `cartera a ${query.asof}` : null,
    `orden: ${LOAN_BOOK_SORTS[sort].label}`,
  ].filter(Boolean).join(" · ");
  const ctx = { filters, generatedAt: new Date() };

  const file = format === "pdf" ? await loanBookToPdf(rows, ctx) : await loanBookToXlsx(rows, ctx);
  const name = `Loan_book_${ctx.generatedAt.toISOString().slice(0, 10)}.${format}`;

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
