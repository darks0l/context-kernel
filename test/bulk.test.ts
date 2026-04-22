import { describe, expect, it } from "vitest";
import {
  createContextStore,
  bulkInsert,
  bulkUpsert,
  bulkDelete,
  bulkGet,
  bulkQuery,
  bulkGetAll,
  storeSize
} from "../src/core/bulk.js";
import type { ContextEntry } from "../src/core/deduplication.js";

describe("bulk operations", () => {
  const entry = (id: string, content?: string): ContextEntry => ({
    id,
    content: content ?? `content for ${id}`,
    timestamp: new Date().toISOString()
  });

  describe("bulkInsert", () => {
    it("inserts multiple entries", () => {
      const store = createContextStore();
      const result = bulkInsert(store, [entry("a"), entry("b"), entry("c")]);

      expect(result.inserted).toBe(3);
      expect(result.failed).toBe(0);
      expect(storeSize(store)).toBe(3);
    });

    it("skips entries with duplicate ids", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a")]);

      const result = bulkInsert(store, [entry("a"), entry("b")]);
      expect(result.inserted).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[0].reason).toBe("duplicate id");
      expect(storeSize(store)).toBe(2);
    });

    it("rejects entries with missing id", () => {
      const store = createContextStore();
      const result = bulkInsert(store, [entry("")]);

      expect(result.failed).toBe(1);
      expect(result.results[0].reason).toBe("missing id");
    });

    it("stores deep copies", () => {
      const store = createContextStore();
      const original = entry("x", "original");
      bulkInsert(store, [original]);

      original.content = "mutated";
      const retrieved = bulkGet(store, ["x"]);
      expect(retrieved[0].content).toBe("original");
    });
  });

  describe("bulkUpsert", () => {
    it("inserts new entries and overwrites existing", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a", "old content")]);

      const result = bulkUpsert(store, [entry("a", "new content"), entry("b")]);
      expect(result.inserted).toBe(2);
      expect(result.failed).toBe(0);

      const retrieved = bulkGet(store, ["a"]);
      expect(retrieved[0].content).toBe("new content");
    });
  });

  describe("bulkDelete", () => {
    it("deletes multiple entries by id", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a"), entry("b"), entry("c")]);

      const result = bulkDelete(store, ["a", "c"]);
      expect(result.deleted).toBe(2);
      expect(result.notFound).toBe(0);
      expect(storeSize(store)).toBe(1);
    });

    it("reports not-found ids", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a")]);

      const result = bulkDelete(store, ["a", "missing"]);
      expect(result.deleted).toBe(1);
      expect(result.notFound).toBe(1);
    });
  });

  describe("bulkGet", () => {
    it("retrieves multiple entries by id", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a"), entry("b"), entry("c")]);

      const results = bulkGet(store, ["a", "c"]);
      expect(results.length).toBe(2);
      expect(results.map((e) => e.id)).toEqual(["a", "c"]);
    });

    it("silently skips missing ids", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a")]);

      const results = bulkGet(store, ["a", "missing"]);
      expect(results.length).toBe(1);
    });
  });

  describe("bulkQuery", () => {
    it("filters entries with predicate", () => {
      const store = createContextStore();
      bulkInsert(store, [
        entry("a", "TypeScript generics guide"),
        entry("b", "Python data science basics"),
        entry("c", "TypeScript type inference patterns")
      ]);

      const result = bulkQuery(store, (e) => e.content.includes("TypeScript"));
      expect(result.total).toBe(2);
      expect(result.entries.length).toBe(2);
    });

    it("supports pagination with limit and offset", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a"), entry("b"), entry("c"), entry("d"), entry("e")]);

      const page1 = bulkQuery(store, () => true, { limit: 2, offset: 0 });
      expect(page1.entries.length).toBe(2);
      expect(page1.total).toBe(5);

      const page2 = bulkQuery(store, () => true, { limit: 2, offset: 2 });
      expect(page2.entries.length).toBe(2);
    });

    it("returns empty result for no matches", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a")]);

      const result = bulkQuery(store, () => false);
      expect(result.total).toBe(0);
      expect(result.entries.length).toBe(0);
    });
  });

  describe("bulkGetAll and storeSize", () => {
    it("returns all entries", () => {
      const store = createContextStore();
      bulkInsert(store, [entry("a"), entry("b")]);

      const all = bulkGetAll(store);
      expect(all.length).toBe(2);
    });

    it("reports correct store size", () => {
      const store = createContextStore();
      expect(storeSize(store)).toBe(0);

      bulkInsert(store, [entry("a"), entry("b")]);
      expect(storeSize(store)).toBe(2);

      bulkDelete(store, ["a"]);
      expect(storeSize(store)).toBe(1);
    });
  });
});
