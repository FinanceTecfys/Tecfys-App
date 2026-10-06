import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageItem, pageItems, paginate, parsePage, parsePageSize } from "../pagination";

/** "1 2 3 4 5 … 91", with the current page in brackets. */
const show = (items: PageItem[]) => items.map((i) => (i.type === "ellipsis" ? "…" : i.current ? `[${i.page}]` : String(i.page))).join(" ");

describe("parsePageSize", () => {
  it("offers 50 / 100 / 200 / 500 and defaults to 50", () => {
    expect(PAGE_SIZES).toEqual([50, 100, 200, 500]);
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    for (const size of PAGE_SIZES) expect(parsePageSize(String(size))).toBe(size);
    expect(parsePageSize(["200", "50"])).toBe(200);
  });

  it("falls back to the default for anything it does not offer", () => {
    for (const bad of [undefined, null, "", "0", "25", "51", "5000", "-50", "50.5", "1e2", "abc", "toString", []]) {
      expect(parsePageSize(bad), String(bad)).toBe(50);
    }
  });
});

describe("parsePage", () => {
  it("reads a positive whole number", () => {
    expect(parsePage("1")).toBe(1);
    expect(parsePage("91")).toBe(91);
    expect(parsePage(["3", "9"])).toBe(3);
    expect(parsePage(" 7 ")).toBe(7);
  });

  it("is page 1 for anything else", () => {
    for (const bad of [undefined, null, "", "0", "-2", "1.5", "2e3", "abc", "9999999999", []]) expect(parsePage(bad), String(bad)).toBe(1);
  });
});

describe("pageItems", () => {
  it("shows every page while they fit", () => {
    expect(show(pageItems(1, 1))).toBe("[1]");
    expect(show(pageItems(5, 3))).toBe("1 2 [3] 4 5");
    expect(show(pageItems(7, 7))).toBe("1 2 3 4 5 6 [7]");
  });

  it("collapses the tail near the start: 1 2 3 4 5 … 91", () => {
    expect(show(pageItems(91, 1))).toBe("[1] 2 3 4 5 … 91");
    expect(show(pageItems(91, 4))).toBe("1 2 3 [4] 5 … 91");
  });

  it("collapses both sides in the middle", () => {
    expect(show(pageItems(91, 5))).toBe("1 … 4 [5] 6 … 91");
    expect(show(pageItems(91, 45))).toBe("1 … 44 [45] 46 … 91");
    expect(show(pageItems(91, 87))).toBe("1 … 86 [87] 88 … 91");
  });

  it("collapses the head near the end", () => {
    expect(show(pageItems(91, 88))).toBe("1 … 87 [88] 89 90 91");
    expect(show(pageItems(91, 91))).toBe("1 … 87 88 89 90 [91]");
    expect(show(pageItems(8, 5))).toBe("1 … 4 [5] 6 7 8");
    expect(show(pageItems(8, 4))).toBe("1 2 3 [4] 5 … 8");
  });

  it("always holds first, last and current, in order, and never hides a single page behind an ellipsis", () => {
    for (let pages = 1; pages <= 40; pages++) {
      for (let current = 1; current <= pages; current++) {
        const items = pageItems(pages, current);
        const numbers = items.flatMap((i) => (i.type === "page" ? [i.page] : []));
        const label = `${pages}/${current}`;
        expect(numbers[0], label).toBe(1);
        expect(numbers.at(-1), label).toBe(pages);
        expect(items.filter((i) => i.type === "page" && i.current).map((i) => i.type === "page" && i.page), label).toEqual([current]);
        expect(numbers.length, label).toBeLessThanOrEqual(7);
        expect([...numbers].sort((a, b) => a - b), label).toEqual(numbers);
        expect(new Set(numbers).size, label).toBe(numbers.length);
        items.forEach((item, i) => {
          const prev = items[i - 1];
          const next = items[i + 1];
          if (item.type === "ellipsis") {
            // Between two page buttons, standing for two pages or more.
            if (prev?.type !== "page" || next?.type !== "page") throw new Error(`ellipsis at the edge: ${label}`);
            expect(next.page - prev.page, label).toBeGreaterThanOrEqual(3);
          } else if (prev?.type === "page") {
            expect(item.page - prev.page, label).toBe(1);
          }
        });
        expect(new Set(items.flatMap((i) => (i.type === "ellipsis" ? [i.key] : []))).size, label).toBe(items.filter((i) => i.type === "ellipsis").length);
      }
    }
  });
});

describe("paginate", () => {
  it("slices the rows and reports the range shown", () => {
    expect(paginate(4512, 50, 1)).toMatchObject({ page: 1, pages: 91, from: 1, to: 50, start: 0, end: 50, total: 4512 });
    expect(paginate(4512, 50, 91)).toMatchObject({ page: 91, from: 4501, to: 4512, start: 4500, end: 4512 });
    expect(paginate(4512, 500, 2)).toMatchObject({ page: 2, pages: 10, from: 501, to: 1000 });
    expect(show(paginate(4512, 50, 1).items)).toBe("[1] 2 3 4 5 … 91");
  });

  it("has exactly one page when the rows fit, and when there are none", () => {
    expect(paginate(50, 50, 1)).toMatchObject({ pages: 1, from: 1, to: 50 });
    expect(paginate(51, 50, 2)).toMatchObject({ pages: 2, from: 51, to: 51 });
    expect(paginate(0, 50, 1)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0, start: 0, end: 0 });
    expect(show(paginate(0, 50, 1).items)).toBe("[1]");
  });

  it("clamps a page beyond the last one (a filter or a larger page size shrank the list)", () => {
    expect(paginate(120, 50, 99)).toMatchObject({ page: 3, from: 101, to: 120 });
    expect(paginate(120, 200, 3)).toMatchObject({ page: 1, pages: 1, from: 1, to: 120 });
    expect(paginate(120, 50, 0).page).toBe(1);
    expect(paginate(120, 50, Number.NaN).page).toBe(1);
  });

  it("never divides by a broken page size", () => {
    for (const size of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) expect(paginate(120, size, 1), String(size)).toMatchObject({ pageSize: 50, pages: 3 });
  });
});
