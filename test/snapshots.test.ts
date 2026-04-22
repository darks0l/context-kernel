import { describe, expect, it } from "vitest";
import {
  createSnapshotStore,
  takeSnapshot,
  restoreSnapshot,
  listSnapshots,
  deleteSnapshot,
  exportSnapshots,
  importSnapshots
} from "../src/core/snapshots.js";
import type { ContextEntry } from "../src/core/deduplication.js";

describe("snapshots", () => {
  const entries: ContextEntry[] = [
    { id: "e1", content: "first entry", timestamp: "2026-04-03T10:00:00Z" },
    { id: "e2", content: "second entry", timestamp: "2026-04-03T11:00:00Z" }
  ];

  it("takes and restores a snapshot", () => {
    const store = createSnapshotStore();

    const snap = takeSnapshot(store, {
      id: "snap-1",
      sessionId: "sess-a",
      entries,
      label: "before refactor"
    });

    expect(snap.id).toBe("snap-1");
    expect(snap.sessionId).toBe("sess-a");
    expect(snap.entries.length).toBe(2);

    const restored = restoreSnapshot(store, "snap-1");
    expect(restored.entries.length).toBe(2);
    expect(restored.entries[0].id).toBe("e1");
  });

  it("restores deep copies (mutations do not affect snapshot)", () => {
    const store = createSnapshotStore();
    takeSnapshot(store, { id: "snap-2", sessionId: "sess-a", entries });

    const restored = restoreSnapshot(store, "snap-2");
    restored.entries[0].content = "MUTATED";

    const restoredAgain = restoreSnapshot(store, "snap-2");
    expect(restoredAgain.entries[0].content).toBe("first entry");
  });

  it("lists snapshots for a session sorted by creation time", () => {
    const store = createSnapshotStore();
    const snapA = takeSnapshot(store, { id: "snap-a", sessionId: "sess-1", entries });
    const snapB = takeSnapshot(store, { id: "snap-b", sessionId: "sess-1", entries });
    takeSnapshot(store, { id: "snap-c", sessionId: "sess-2", entries });

    // Force distinct timestamps to avoid same-ms race
    snapA.createdAt = "2026-04-03T10:00:00Z";
    snapB.createdAt = "2026-04-03T11:00:00Z";

    const list = listSnapshots(store, "sess-1");
    expect(list.length).toBe(2);
    // Most recent first
    expect(list[0].id).toBe("snap-b");
  });

  it("deletes a snapshot", () => {
    const store = createSnapshotStore();
    takeSnapshot(store, { id: "snap-del", sessionId: "sess-1", entries });

    expect(deleteSnapshot(store, "snap-del")).toBe(true);
    expect(deleteSnapshot(store, "snap-del")).toBe(false);
    expect(() => restoreSnapshot(store, "snap-del")).toThrow("Snapshot not found");
  });

  it("exports and imports snapshots", () => {
    const store1 = createSnapshotStore();
    takeSnapshot(store1, { id: "s1", sessionId: "sess-1", entries });
    takeSnapshot(store1, { id: "s2", sessionId: "sess-1", entries });

    const exported = exportSnapshots(store1);
    expect(exported.length).toBe(2);

    const store2 = createSnapshotStore();
    const count = importSnapshots(store2, exported);
    expect(count).toBe(2);

    const restored = restoreSnapshot(store2, "s1");
    expect(restored.entries.length).toBe(2);
  });

  it("throws on missing id or sessionId", () => {
    const store = createSnapshotStore();
    expect(() => takeSnapshot(store, { id: "", sessionId: "s", entries })).toThrow();
    expect(() => takeSnapshot(store, { id: "x", sessionId: "", entries })).toThrow();
  });
});
