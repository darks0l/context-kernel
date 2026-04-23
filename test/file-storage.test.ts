import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FileStorageAdapter } from "../src/adapters/file/index.js";
import type { MemorySnapshot, MemoryCandidate } from "../src/core/types.js";

const TEST_DIR = join(process.cwd(), ".test-file-storage");

function makeCandidate(override: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    summary: "test candidate",
    tags: ["test"],
    priority: "medium",
    confidence: 0.8,
    source: { messageIndexes: [0], strategy: "decision" },
    ...override,
  };
}

function makeSnapshot(version: string, overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    version,
    parent: null,
    summary: `snapshot ${version}`,
    memoryEntries: [],
    createdAt: new Date().toISOString(),
    tokenCount: 100,
    messagesCompacted: 10,
    ...overrides,
  };
}

describe("FileStorageAdapter", () => {
  let adapter: FileStorageAdapter;

  beforeEach(() => {
    // Clean slate
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    adapter = new FileStorageAdapter({ dir: TEST_DIR });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  // ─── saveSnapshot / loadSnapshot ─────────────────────────────────────────

  it("saves and loads a snapshot", async () => {
    const snap = makeSnapshot("1.0.0");
    await adapter.saveSnapshot(snap);
    const loaded = await adapter.loadSnapshot("1.0.0");
    expect(loaded).toEqual(snap);
  });

  it("loadSnapshot returns null for nonexistent version", async () => {
    const result = await adapter.loadSnapshot("99.99.99");
    expect(result).toBeNull();
  });

  it("loadSnapshot returns null for malformed file", async () => {
    const snap = makeSnapshot("0.0.1");
    await adapter.saveSnapshot(snap);
    // Corrupt the file
    const path = join(TEST_DIR, "v0.0.1.snapshot.json");
    const content = readFileSync(path, "utf8");
    // Write invalid JSON
    require("node:fs").writeFileSync(path, "{ broken json", "utf8");
    const result = await adapter.loadSnapshot("0.0.1");
    expect(result).toBeNull();
  });

  // ─── listSnapshots ───────────────────────────────────────────────────────

  it("lists snapshots sorted by createdAt descending", async () => {
    await adapter.saveSnapshot(makeSnapshot("1.0.0", { createdAt: "2026-01-01T00:00:00Z" }));
    await adapter.saveSnapshot(makeSnapshot("2.0.0", { createdAt: "2026-02-01T00:00:00Z" }));
    await adapter.saveSnapshot(makeSnapshot("3.0.0", { createdAt: "2026-03-01T00:00:00Z" }));

    const list = await adapter.listSnapshots();
    expect(list).toHaveLength(3);
    expect(list[0].version).toBe("3.0.0");
    expect(list[1].version).toBe("2.0.0");
    expect(list[2].version).toBe("1.0.0");
  });

  it("listSnapshots skips malformed files", async () => {
    await adapter.saveSnapshot(makeSnapshot("1.0.0"));
    // Corrupt a file
    const path = join(TEST_DIR, "v1.0.0.snapshot.json");
    require("node:fs").writeFileSync(path, "not json", "utf8");
    await adapter.saveSnapshot(makeSnapshot("2.0.0"));

    const list = await adapter.listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("2.0.0");
  });

  // ─── deleteSnapshot ─────────────────────────────────────────────────────

  it("deletes a snapshot", async () => {
    await adapter.saveSnapshot(makeSnapshot("1.0.0"));
    expect(await adapter.loadSnapshot("1.0.0")).not.toBeNull();

    await adapter.deleteSnapshot("1.0.0");
    expect(await adapter.loadSnapshot("1.0.0")).toBeNull();
  });

  it("deleteSnapshot handles nonexistent version gracefully", async () => {
    await expect(adapter.deleteSnapshot("99.99.99")).resolves.not.toThrow();
  });

  // ─── saveMemoryCandidates / loadMemoryCandidates ─────────────────────────

  it("saves and loads memory candidates", async () => {
    const candidates = [makeCandidate({ summary: "first" }), makeCandidate({ summary: "second" })];
    await adapter.saveMemoryCandidates(candidates);
    const loaded = await adapter.loadMemoryCandidates();
    expect(loaded).toEqual(candidates);
  });

  it("loadMemoryCandidates returns empty array when file missing", async () => {
    const result = await adapter.loadMemoryCandidates();
    expect(result).toEqual([]);
  });

  it("loadMemoryCandidates returns empty array when file is malformed", async () => {
    const path = join(TEST_DIR, "candidates.snapshot.json");
    require("node:fs").writeFileSync(path, "not json", "utf8");
    const result = await adapter.loadMemoryCandidates();
    expect(result).toEqual([]);
  });

  // ─── Constructor / path resolution ──────────────────────────────────────

  it("creates directory if missing", () => {
    const nested = join(TEST_DIR, "nested", "deep");
    rmSync(TEST_DIR, { recursive: true });
    const a = new FileStorageAdapter({ dir: nested });
    expect(existsSync(nested)).toBe(true);
  });

  it("resolves relative dir paths", () => {
    const a = new FileStorageAdapter({ dir: "./test-rel" });
    // Should not throw — path resolved relative to cwd
    expect(existsSync("./test-rel")).toBe(true);
    rmSync("./test-rel", { recursive: true });
  });
});
