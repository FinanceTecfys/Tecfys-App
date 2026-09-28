import { describe, expect, it } from "vitest";
import { cleanText, parseHoldedDate, parseMoney } from "../values";

describe("parseMoney", () => {
  it("keeps numbers, rounded to the cent", () => {
    expect(parseMoney(635)).toBe(635);
    expect(parseMoney(-31.29)).toBe(-31.29);
    expect(parseMoney(10.479999)).toBe(10.48);
    expect(parseMoney(0)).toBe(0);
  });

  it("parses the formatted strings of Holded's Collected column", () => {
    expect(parseMoney("768.35€")).toBe(768.35);
    expect(parseMoney("0.00€")).toBe(0);
    expect(parseMoney("-180.29€")).toBe(-180.29);
    expect(parseMoney("14,253.72€")).toBe(14253.72);
    expect(parseMoney("1,234,567.89 €")).toBe(1234567.89);
  });

  it("parses Spanish formatting and API decimal strings", () => {
    expect(parseMoney("1.234,56 €")).toBe(1234.56);
    expect(parseMoney("12,5")).toBe(12.5);
    expect(parseMoney("1.234")).toBe(1234);
    expect(parseMoney("1.234.567")).toBe(1234567);
    expect(parseMoney("121.00")).toBe(121);
    expect(parseMoney("(50.00)")).toBe(-50);
  });

  it("returns null for blanks and garbage", () => {
    for (const v of [null, undefined, "", "  ", "€", "n/a", "12abc", NaN, Infinity, {}, true]) expect(parseMoney(v)).toBeNull();
  });
});

describe("parseHoldedDate", () => {
  it("drops the export clock time and keeps the calendar day", () => {
    expect(parseHoldedDate(new Date("2026-08-31T11:13:27.000Z"))).toBe("2026-08-31T00:00:00.000Z");
    expect(parseHoldedDate(new Date("2026-08-01T23:59:59.000Z"))).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reads API days, ISO timestamps, dd/mm/yyyy and unix seconds", () => {
    expect(parseHoldedDate("2024-01-15")).toBe("2024-01-15T00:00:00.000Z");
    expect(parseHoldedDate("2024-01-15T10:00:00+00:00")).toBe("2024-01-15T00:00:00.000Z");
    expect(parseHoldedDate("04/09/2026")).toBe("2026-09-04T00:00:00.000Z");
    expect(parseHoldedDate(1_788_220_800)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rejects impossible or missing dates", () => {
    for (const v of [null, undefined, "", "2026-02-30", "31/02/2026", "tomorrow", 0, -5, new Date("x")]) expect(parseHoldedDate(v)).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims, collapses whitespace and stringifies numbers", () => {
    expect(cleanText(" Catering  Restaurants")).toBe("Catering Restaurants");
    expect(cleanText(" Not required")).toBe("Not required");
    expect(cleanText(18096)).toBe("18096");
  });

  it("treats blanks and Holded's '-' placeholder as missing", () => {
    for (const v of [null, undefined, "", "   ", "-", " - "]) expect(cleanText(v)).toBeNull();
  });
});
