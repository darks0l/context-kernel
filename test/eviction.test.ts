import { describe, expect, it } from "vitest";
import { evict, evictLRU, evictLFU, evictTTL } from "../src/core/eviction.js";
import type { ContextEntry } from "../src/core/deduplication.js";
import type { EvictionAccessRecord } from "../src/core/eviction.js";

describe("eviction policies", () => {
  const entries: ContextEntry[] = [
    { id: "a", content: "entry a", timestamp: "2026-04-01T10:00:00Z" },
    { id: "b", content: "entry b", timestamp: "2026-04-02T10:00:00Z" },
    { id: "c", content: "entry c", timestamp: "2026-04-03T10:00:00Z" }
  ];

  const accessRecords: EvictionAccessRecord[] = [
    { entryId: "a", accessCount: 10, lastAccessed: "2026-04-03T09:00:00Z" },
    { entryId: "b", accessCount: 2, lastAccessed: "2026-04-01T09:00:00Z" },
    { entryId: "c", accessCount: 5, lastAccessed: "2026-04-03T11:00:00Z" }
  ];

  describe("LRU", () => {
    it("evicts least recently accessed entries", () => {
      const result = evictLRU(entries, accessRecords, { maxEntries: 2 });

      expect(result.retained.length).toBe(2);
      expect(result.evicted.length).toBe(1);
      expect(result.evicted[0].id).toBe("b"); // least recently accessed
      expect(result.policy).toBe("lru");
    });

    it("retains all when under limit", () => {
      const result = evictLRU(entries, accessRecords, { maxEntries: 10 });
      expect(result.retained.length).toBe(3);
      expect(result.evicted.length).toBe(0);
    });

    it("throws without maxEntries", () => {
      expect(() => evictLRU(entries, accessRecords, {})).toThrow("maxEntries");
    });
  });

  describe("LFU", () => {
    it("evicts least frequently used entries", () => {
      const result = evictLFU(entries, accessRecords, { maxEntries: 2 });

      expect(result.retained.length).toBe(2);
      expect(result.evicted[0].id).toBe("b"); // lowest access count (2)
      expect(result.policy).toBe("lfu");
    });

    it("retains all when under limit", () => {
      const result = evictLFU(entries, accessRecords, { maxEntries: 5 });
      expect(result.retained.length).toBe(3);
      expect(result.evicted.length).toBe(0);
    });
  });

  describe("TTL", () => {
    it("evicts entries older than TTL", () => {
      const refTime = new Date("2026-04-03T12:00:00Z");
      const result = evictTTL(entries, {
        ttlMs: 48 * 60 * 60 * 1000, // 48 hours
        referenceTime: refTime
      });

      expect(result.evicted.length).toBe(1);
      expect(result.evicted[0].id).toBe("a"); // older than 48h
      expect(result.retained.length).toBe(2);
      expect(result.policy).toBe("ttl");
    });

    it("retains all entries within TTL", () => {
      const refTime = new Date("2026-04-03T12:00:00Z");
      const result = evictTTL(entries, {
        ttlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
        referenceTime: refTime
      });

      expect(result.retained.length).toBe(3);
      expect(result.evicted.length).toBe(0);
    });

    it("throws without ttlMs", () => {
      expect(() => evictTTL(entries, {})).toThrow("ttlMs");
    });
  });

  describe("unified evict()", () => {
    it("delegates to the correct policy", () => {
      const result = evict("lru", entries, { maxEntries: 2 }, accessRecords);
      expect(result.policy).toBe("lru");
      expect(result.retained.length).toBe(2);
    });

    it("throws on unknown policy", () => {
      expect(() => evict("unknown" as any, entries, { maxEntries: 2 })).toThrow("Unknown eviction policy");
    });
  });
});
