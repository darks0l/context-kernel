import { describe, expect, it } from "vitest";
import {
  createSharedMemoryRegistry,
  createPool,
  getPool,
  deletePool,
  listPools,
  publish,
  subscribe,
  readPool,
  removeEntry,
  poolStats
} from "../src/core/shared-memory.js";
import type { ContextEntry } from "../src/core/deduplication.js";

describe("shared memory pools", () => {
  const entry = (id: string): ContextEntry => ({
    id,
    content: `content for ${id}`,
    timestamp: new Date().toISOString()
  });

  it("creates and lists pools", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "workspace");
    createPool(reg, "global");

    expect(listPools(reg)).toEqual(["workspace", "global"]);
  });

  it("throws on duplicate pool name", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "shared");
    expect(() => createPool(reg, "shared")).toThrow("already exists");
  });

  it("publishes and reads entries across sessions", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "team");

    const r1 = publish(reg, "team", "session-a", entry("e1"));
    expect(r1.accepted).toBe(true);

    publish(reg, "team", "session-b", entry("e2"));

    // session-a reads all entries
    const all = readPool(reg, "team");
    expect(all.length).toBe(2);

    // session-a reads only entries from other sessions
    const others = readPool(reg, "team", { excludeSessionId: "session-a" });
    expect(others.length).toBe(1);
    expect(others[0].id).toBe("e2");
  });

  it("enforces maxEntries on pool", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "limited", 2);

    publish(reg, "limited", "s1", entry("e1"));
    publish(reg, "limited", "s1", entry("e2"));
    const r3 = publish(reg, "limited", "s1", entry("e3"));

    expect(r3.accepted).toBe(false);
    expect(r3.reason).toBe("pool is full");
  });

  it("returns not-found on publish to missing pool", () => {
    const reg = createSharedMemoryRegistry();
    const result = publish(reg, "missing", "s1", entry("e1"));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("pool not found");
  });

  it("subscribe adds session membership", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "team");
    subscribe(reg, "team", "session-x");

    const stats = poolStats(reg, "team");
    expect(stats.memberCount).toBe(1);
  });

  it("removes entries from pool", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "team");
    publish(reg, "team", "s1", entry("e1"));

    expect(removeEntry(reg, "team", "e1")).toBe(true);
    expect(removeEntry(reg, "team", "e1")).toBe(false);
    expect(readPool(reg, "team").length).toBe(0);
  });

  it("deletes a pool", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "temp");
    expect(deletePool(reg, "temp")).toBe(true);
    expect(deletePool(reg, "temp")).toBe(false);
  });

  it("poolStats returns correct counts", () => {
    const reg = createSharedMemoryRegistry();
    createPool(reg, "team", 100);
    publish(reg, "team", "s1", entry("e1"));
    publish(reg, "team", "s2", entry("e2"));

    const stats = poolStats(reg, "team");
    expect(stats.entryCount).toBe(2);
    expect(stats.memberCount).toBe(2);
    expect(stats.maxEntries).toBe(100);
  });
});
