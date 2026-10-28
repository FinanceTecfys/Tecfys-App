import { describe, expect, it } from "vitest";
import { currentScoring, effectiveDate, orderScoringHistory, type ScoringHistoryEntry } from "../history";

const entry = (id: string, reportDate: string | null, createdAt: string, rating = "BB"): ScoringHistoryEntry => ({
  id, rating, status: "approved", totalScore: 5, reportSource: reportDate ? "pdf" : null, reportDate, createdAt,
});

describe("scoring history", () => {
  it("orders by the report's own date first, then by when the scoring was made", () => {
    const history = [
      entry("old-report-new-scoring", "2025-06-01", "2026-10-20T10:00:00Z"),
      entry("new-report", "2026-08-13", "2026-08-14T09:00:00Z"),
      entry("same-day-later", "2026-08-13", "2026-08-15T09:00:00Z"),
      entry("manual", null, "2026-01-10T12:00:00Z"),
    ];
    expect(orderScoringHistory(history).map((e) => e.id)).toEqual(["same-day-later", "new-report", "manual", "old-report-new-scoring"]);
  });

  it("the current rating is the most recent scoring's, not the last one made", () => {
    const history = [entry("recent-report", "2026-08-13", "2026-08-14T09:00:00Z", "A"), entry("re-scored-old-report", "2024-12-31", "2026-10-26T09:00:00Z", "CCC")];
    expect(currentScoring(history)?.rating).toBe("A");
    expect(currentScoring([])).toBeNull();
  });

  it("a scoring typed by hand counts by the day it was made", () => {
    expect(effectiveDate(entry("m", null, "2026-03-04T23:00:00Z"))).toBe("2026-03-04");
  });

  it("does not reorder the input array", () => {
    const history = [entry("a", "2020-01-01", "2020-01-01T00:00:00Z"), entry("b", "2021-01-01", "2021-01-01T00:00:00Z")];
    orderScoringHistory(history);
    expect(history.map((e) => e.id)).toEqual(["a", "b"]);
  });
});
