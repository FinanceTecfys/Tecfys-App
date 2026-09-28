import { describe, expect, it } from "vitest";
import { erpSearch, parseErpQuery, searchPattern } from "../erp-view";
import { erpSettingsSchema, isHoldedHost } from "../settings";

describe("parseErpQuery", () => {
  it("reads q, an allow-listed status and a positive page", () => {
    expect(parseErpQuery({ q: "  acme ", status: "Overdue", page: "3" })).toEqual({ q: "acme", status: "Overdue", page: 3 });
  });

  it("drops unknown statuses (including inherited keys) and bad pages", () => {
    for (const status of ["toString", "paid", "DROP"]) expect(parseErpQuery({ status }).status).toBeNull();
    for (const page of ["0", "-2", "abc", undefined]) expect(parseErpQuery({ page }).page).toBe(1);
    expect(parseErpQuery({ q: ["a", "b"] }).q).toBe("a");
  });

  it("round-trips through erpSearch", () => {
    const q = parseErpQuery({ q: "S.L.", status: "Paid", page: "2" });
    expect(parseErpQuery(Object.fromEntries(new URLSearchParams(erpSearch(q, { page: 3 }))))).toEqual({ ...q, page: 3 });
    expect(erpSearch({ q: "", status: null, page: 1 })).toBe("");
  });
});

describe("searchPattern", () => {
  it("quotes the value so filter-grammar characters stay literal", () => {
    expect(searchPattern("ACME PLUS S.L.")).toBe('"%ACME PLUS S.L.%"');
    expect(searchPattern("a,b),num.eq.1")).toBe('"%a,b),num.eq.1%"');
    expect(searchPattern('x" \\')).toBe('"%x\\" \\\\%"');
  });

  it("drops wildcards and returns null for an empty search", () => {
    expect(searchPattern("  %*  ")).toBeNull();
    expect(searchPattern("TP-S*26")).toBe('"%TP-S 26%"');
  });
});

describe("ERP settings", () => {
  it("only allows https Holded hosts (the API key is sent there)", () => {
    expect(isHoldedHost("https://api.holded.com")).toBe(true);
    for (const url of ["http://api.holded.com", "https://holded.com.evil.io", "https://evilholded.com", "https://user:pw@api.holded.com", "nope"]) {
      expect(isHoldedHost(url), url).toBe(false);
    }
  });

  it("validates and normalises the form", () => {
    expect(erpSettingsSchema.parse({ holded_base_url: " https://api.holded.com/ ", include_credit_notes: true, sync_lookback_days: "31" })).toEqual({
      holded_base_url: "https://api.holded.com",
      include_credit_notes: true,
      sync_lookback_days: 31,
    });
    expect(erpSettingsSchema.safeParse({ holded_base_url: "https://api.holded.com", include_credit_notes: true, sync_lookback_days: 400 }).success).toBe(false);
  });
});
