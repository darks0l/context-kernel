import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryManager, defaultMemoryConfig } from "../src/core/memory-manager.js";
import type { CompactionResult } from "../src/core/compaction.js";

const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `Message ${i}: this is test content for the memory window`,
  }));

describe("MemoryManager", () => {
  let mm: MemoryManager;
  let mockSummarize: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mm = new MemoryManager(
      { ...defaultMemoryConfig, maxWindowMessages: 10, keepLastMessages: 3, compactionIntervalDecisions: 0 },
      null,
      { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: true },
    );
    mockSummarize = vi.fn().mockResolvedValue({
      summary: "Test summary of messages",
      tokensFreed: 500,
      method: "full" as const,
    });
  });

  describe("ingest", () => {
    it("accumulates messages in the window", () => {
      mm.ingest(makeMessages(3));
      expect(mm.getWindow()).toHaveLength(3);
      mm.ingest(makeMessages(2));
      expect(mm.getWindow()).toHaveLength(5);
    });

    it("respects maxWindowMessages limit", () => {
      mm.ingest(makeMessages(15));
      expect(mm.getWindow()).toHaveLength(10); // capped at maxWindowMessages
    });
  });

  describe("shouldCompact", () => {
    it("returns false when window is under limit", () => {
      mm.ingest(makeMessages(5));
      expect(mm.shouldCompact()).toBe(false);
    });

    it("returns true when window reaches maxWindowMessages", () => {
      mm.ingest(makeMessages(10));
      expect(mm.shouldCompact()).toBe(true);
    });

    it("returns false when already compacting", async () => {
      const mm2 = new MemoryManager(
        { ...defaultMemoryConfig, maxWindowMessages: 100, compactionIntervalDecisions: 1 },
        null,
        { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: true },
      );
      mm2.ingest(makeMessages(5));
      // First compact starts but we don't await — isCompacting becomes true
      const prom = mm2.compact(mockSummarize);
      // While compacting, shouldCompact returns false
      expect(mm2.shouldCompact()).toBe(false);
      await prom; // clean up
    });

    it("returns true when decision count hits compactionIntervalDecisions", () => {
      const mm2 = new MemoryManager(
        { ...defaultMemoryConfig, maxWindowMessages: 100, compactionIntervalDecisions: 3 },
        null,
        { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: true },
      );
      mm2.ingest(makeMessages(3));
      mm2.incrementDecisions(); // 1
      expect(mm2.shouldCompact()).toBe(false);
      mm2.incrementDecisions(); // 2
      expect(mm2.shouldCompact()).toBe(false);
      mm2.incrementDecisions(); // 3 — should trigger
      expect(mm2.shouldCompact()).toBe(true);
    });
  });

  describe("compact", () => {
    it("produces a MemorySnapshot with semver", async () => {
      mm.ingest(makeMessages(5));
      const snap = await mm.compact(mockSummarize);
      expect(snap.version).toBe("0.1.0");
      expect(snap.parent).toBe("0.0.0");
      expect(snap.summary).toBe("Test summary of messages");
      expect(snap.messagesCompacted).toBe(5);
    });

    it("trims window to keepLastMessages after compaction", async () => {
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      expect(mm.getWindow()).toHaveLength(3); // keepLastMessages = 3
    });

    it("calls the summarize function with messages", async () => {
      mm.ingest(makeMessages(5));
      await mm.compact(mockSummarize);
      expect(mockSummarize).toHaveBeenCalledTimes(1);
    });

    it("throws if compaction is already in progress", async () => {
      mm.ingest(makeMessages(10));
      const prom = mm.compact(mockSummarize);
      await expect(mm.compact(mockSummarize)).rejects.toThrow("Compaction already in progress");
    });

    it("updates version after compaction", async () => {
      expect(mm.getVersion()).toBe("0.0.0");
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      expect(mm.getVersion()).not.toBe("0.0.0");
    });
  });

  describe("tick", () => {
    it("returns snapshot and window status", () => {
      mm.ingest(makeMessages(5));
      const status = mm.tick();
      expect(status.needsCompaction).toBe(false);
      expect(status.windowSize).toBe(5);
      expect(status.snapshotCount).toBe(0);
    });
  });

  describe("getLatestSnapshot / getSnapshot", () => {
    it("returns null before any compaction", () => {
      expect(mm.getLatestSnapshot()).toBeNull();
    });

    it("returns the latest snapshot after compaction", async () => {
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      const snap = mm.getLatestSnapshot();
      expect(snap).not.toBeNull();
      expect(snap!.version).toBe(mm.getVersion());
    });
  });

  describe("getMemoryDiff", () => {
    it("returns null if one version does not exist in store", async () => {
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      // 0.0.0 was never stored (initial state), so diff returns null
      expect(await mm.getMemoryDiff("0.0.0", "0.1.0")).toBeNull();
      // Both exist after second compaction
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      expect(await mm.getMemoryDiff("0.1.0", "0.2.0")).not.toBeNull();
    });
  });

  describe("semver versioning", () => {
    it("minor bump for normal compaction", async () => {
      mm.ingest(makeMessages(10));
      const snap = await mm.compact(mockSummarize);
      expect(snap.version).toBe("0.1.0");
    });

    it("multiple minor bumps", async () => {
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      mm.ingest(makeMessages(10));
      const snap2 = await mm.compact(mockSummarize);
      expect(snap2.version).toBe("0.2.0");
      expect(snap2.parent).toBe("0.1.0");
    });
  });

  describe("getSnapshotVersions", () => {
    it("lists all versions", async () => {
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      mm.ingest(makeMessages(10));
      await mm.compact(mockSummarize);
      const versions = mm.getSnapshotVersions();
      expect(versions).toContain("0.1.0");
      expect(versions).toContain("0.2.0");
    });
  });

  describe("lastCompactionAt", () => {
    it("records timestamp", async () => {
      mm.ingest(makeMessages(10));
      expect(mm.getLastCompactionAt()).toBeNull();
      await mm.compact(mockSummarize);
      expect(mm.getLastCompactionAt()).not.toBeNull();
    });
  });

  describe("defaultMemoryConfig", () => {
    it("has sensible defaults", () => {
      expect(defaultMemoryConfig.maxWindowMessages).toBe(500);
      expect(defaultMemoryConfig.keepLastMessages).toBe(50);
      expect(defaultMemoryConfig.compactionIntervalDecisions).toBe(50);
      expect(defaultMemoryConfig.maxSnapshots).toBe(20);
    });
  });
});
