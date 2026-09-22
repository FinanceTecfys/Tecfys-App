import type { NextRequest } from "next/server";
import { loadLoanBook } from "@/modules/contracts/data";
import { loanBookToPdf, loanBookToXlsx } from "@/modules/contracts/document/export-loan-book";
import {
  DEFAULT_SORT,
  filterLoanBook,
  isLoanBookSort,
  LOAN_BOOK_SORTS,
  sortLoanBook,
  toLoanBookRow,
} from "@/modules/contracts/domain/loan-book-view";

const TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} as const;

/** Export the loan book honouring the filters and the sort of the listing. */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
  const q = sp.get("q")?.trim() ?? "";
  const status = sp.get("status") ?? "";
  const sortParam = sp.get("sort") ?? undefined;
  const sort = isLoanBookSort(sortParam) ? sortParam : DEFAULT_SORT;

  const book = await loadLoanBook({ includeDrafts: true });
  const rows = sortLoanBook(filterLoanBook(book.map(toLoanBookRow), { q, status }), sort);

  const filters = [
    q ? `búsqueda "${q}"` : null,
    status ? `estado ${status}` : "todos los estados",
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
