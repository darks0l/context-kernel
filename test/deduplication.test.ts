import { describe, expect, it } from "vitest";
import { deduplicateEntries, findDuplicate } from "../src/core/deduplication.js";
import type { ContextEntry } from "../src/core/deduplication.js";

describe("deduplication", () => {
  const makeEntry = (id: string, content: string): ContextEntry => ({
    id,
    content,
    timestamp: new Date().toISOString()
  });

  it("detects and merges near-duplicate entries", () => {
    const entries = [
      makeEntry("a", "The quick brown fox jumps over the lazy dog"),
      makeEntry("b", "The quick brown fox leaps over the lazy dog"),
      makeEntry("c", "Something completely different about cats and mice")
    ];

    const result = deduplicateEntries(entries, { similarityThreshold: 0.7 });

    expect(result.merged.length).toBe(1);
    expect(result.merged[0].kept.id).toBe("a");
    expect(result.merged[0].duplicates[0].id).toBe("b");
    expect(result.unique).toContainEqual(expect.objectContaining({ id: "c" }));
    expect(result.removedCount).toBe(1);
  });

  it("returns all entries as unique when below threshold", () => {
    const entries = [
      makeEntry("a", "The quick brown fox jumps over the lazy dog"),
      makeEntry("b", "Completely unrelated content about space exploration")
    ];

    const result = deduplicateEntries(entries, { similarityThreshold: 0.85 });

    expect(result.merged.length).toBe(0);
    expect(result.unique.length).toBe(2);
    expect(result.removedCount).toBe(0);
  });

  it("handles empty input", () => {
    const result = deduplicateEntries([]);
    expect(result.unique).toEqual([]);
    expect(result.merged).toEqual([]);
    expect(result.removedCount).toBe(0);
  });

  it("skips short entries below minContentLength", () => {
    const entries = [
      makeEntry("a", "hi"),
      makeEntry("b", "hi")
    ];

    const result = deduplicateEntries(entries, { minContentLength: 10 });

    expect(result.merged.length).toBe(0);
    expect(result.unique.length).toBe(2);
  });

  it("findDuplicate returns best match from corpus", () => {
    const corpus = [
      makeEntry("x", "React hooks for state management in functional components"),
      makeEntry("y", "Database indexing strategies for PostgreSQL")
    ];

    const candidate = makeEntry("z", "React hooks for managing state in functional React components");
    const result = findDuplicate(candidate, corpus, { similarityThreshold: 0.6 });

    expect(result).not.toBeNull();
    expect(result!.match.id).toBe("x");
    expect(result!.similarity).toBeGreaterThan(0.6);
  });

  it("findDuplicate returns null when no match", () => {
    const corpus = [
      makeEntry("x", "React hooks for state management in functional components")
    ];

    const candidate = makeEntry("z", "Database indexing strategies for PostgreSQL performance tuning");
    const result = findDuplicate(candidate, corpus, { similarityThreshold: 0.85 });

    expect(result).toBeNull();
  });
});
