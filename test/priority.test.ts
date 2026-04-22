import { describe, expect, it } from "vitest";
import { scoreEntries, topK } from "../src/core/priority.js";
import type { ContextEntry } from "../src/core/deduplication.js";
import type { UsageRecord } from "../src/core/priority.js";

describe("priority scoring", () => {
  const now = new Date("2026-04-03T12:00:00Z");

  const entries: ContextEntry[] = [
    { id: "recent-relevant", content: "TypeScript generics and type inference patterns", timestamp: "2026-04-03T11:00:00Z" },
    { id: "old-relevant", content: "TypeScript generics advanced usage guide", timestamp: "2026-04-01T12:00:00Z" },
    { id: "recent-irrelevant", content: "Best pasta recipes for weeknight dinners", timestamp: "2026-04-03T11:30:00Z" },
    { id: "old-irrelevant", content: "Gardening tips for spring planting season", timestamp: "2026-03-01T12:00:00Z" }
  ];

  const usageRecords: UsageRecord[] = [
    { entryId: "recent-relevant", accessCount: 5, lastAccessed: "2026-04-03T11:00:00Z" },
    { entryId: "old-relevant", accessCount: 20, lastAccessed: "2026-04-02T12:00:00Z" },
    { entryId: "recent-irrelevant", accessCount: 1, lastAccessed: "2026-04-03T11:30:00Z" }
  ];

  it("ranks relevant + recent entries highest", () => {
    const scored = scoreEntries(entries, "TypeScript generics", usageRecords, { referenceTime: now });

    expect(scored[0].entry.id).toBe("recent-relevant");
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it("includes breakdown scores", () => {
    const scored = scoreEntries(entries, "TypeScript generics", usageRecords, { referenceTime: now });
    const top = scored[0];

    expect(top.breakdown.relevance).toBeGreaterThan(0);
    expect(top.breakdown.recency).toBeGreaterThan(0);
    expect(top.breakdown.frequency).toBeGreaterThan(0);
  });

  it("returns entries sorted by descending score", () => {
    const scored = scoreEntries(entries, "TypeScript", [], { referenceTime: now });

    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score);
    }
  });

  it("topK returns only k entries", () => {
    const top2 = topK(entries, "TypeScript", 2, usageRecords, { referenceTime: now });
    expect(top2.length).toBe(2);
  });

  it("handles empty query gracefully", () => {
    const scored = scoreEntries(entries, "", [], { referenceTime: now });
    expect(scored.length).toBe(entries.length);
    // All relevance should be 0
    for (const s of scored) {
      expect(s.breakdown.relevance).toBe(0);
    }
  });

  it("respects custom weights", () => {
    const scored = scoreEntries(entries, "TypeScript", [], {
      referenceTime: now,
      relevanceWeight: 1.0,
      recencyWeight: 0,
      frequencyWeight: 0
    });

    // With only relevance, both TS entries should tie above non-TS entries
    expect(scored[0].breakdown.relevance).toBeGreaterThan(0);
    expect(scored[2].breakdown.relevance).toBe(0);
  });
});
