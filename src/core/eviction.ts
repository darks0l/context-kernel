/**
 * Automatic context eviction policies.
 *
 * Provides LRU (Least Recently Used), LFU (Least Frequently Used), and
 * TTL-based eviction for bounded context stores. Policies can be composed
 * via the unified `evict()` function.
 */

import type { ContextEntry } from "./deduplication.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EvictionPolicy = "lru" | "lfu" | "ttl";

export interface EvictionConfig {
  /** Maximum number of entries to retain. Required for lru/lfu. */
  maxEntries?: number;
  /** TTL in milliseconds. Entries older than this are evicted. Required for ttl. */
  ttlMs?: number;
  /** Reference time for TTL calculation. Defaults to now. */
  referenceTime?: Date;
}

export interface EvictionAccessRecord {
  entryId: string;
  accessCount: number;
  lastAccessed: string;
}

export interface EvictionResult {
  /** Entries that survived eviction. */
  retained: ContextEntry[];
  /** Entries that were evicted. */
  evicted: ContextEntry[];
  /** The policy that was applied. */
  policy: EvictionPolicy;
}

/* ------------------------------------------------------------------ */
/*  LRU - Least Recently Used                                          */
/* ------------------------------------------------------------------ */

/**
 * Evict the least recently used entries to enforce a max entry count.
 * Uses `lastAccessed` from access records, falling back to entry timestamp.
 */
export function evictLRU(
  entries: ContextEntry[],
  accessRecords: EvictionAccessRecord[],
  config: EvictionConfig
): EvictionResult {
  const max = config.maxEntries;
  if (max === undefined || max < 0) {
    throw new Error("evictLRU requires maxEntries");
  }
  if (entries.length <= max) {
    return { retained: [...entries], evicted: [], policy: "lru" };
  }

  const accessMap = new Map<string, string>();
  for (const rec of accessRecords) {
    accessMap.set(rec.entryId, rec.lastAccessed);
  }

  // Sort by last access time descending (most recent first)
  const sorted = [...entries].sort((a, b) => {
    const aTime = new Date(accessMap.get(a.id) ?? a.timestamp).getTime();
    const bTime = new Date(accessMap.get(b.id) ?? b.timestamp).getTime();
    return bTime - aTime;
  });

  return {
    retained: sorted.slice(0, max),
    evicted: sorted.slice(max),
    policy: "lru"
  };
}

/* ------------------------------------------------------------------ */
/*  LFU - Least Frequently Used                                        */
/* ------------------------------------------------------------------ */

/**
 * Evict the least frequently used entries to enforce a max entry count.
 * Ties broken by recency (older entries evicted first).
 */
export function evictLFU(
  entries: ContextEntry[],
  accessRecords: EvictionAccessRecord[],
  config: EvictionConfig
): EvictionResult {
  const max = config.maxEntries;
  if (max === undefined || max < 0) {
    throw new Error("evictLFU requires maxEntries");
  }
  if (entries.length <= max) {
    return { retained: [...entries], evicted: [], policy: "lfu" };
  }

  const accessMap = new Map<string, EvictionAccessRecord>();
  for (const rec of accessRecords) {
    accessMap.set(rec.entryId, rec);
  }

  // Sort by access count descending, then by recency descending
  const sorted = [...entries].sort((a, b) => {
    const aCount = accessMap.get(a.id)?.accessCount ?? 0;
    const bCount = accessMap.get(b.id)?.accessCount ?? 0;
    if (bCount !== aCount) return bCount - aCount;
    const aTime = new Date(a.timestamp).getTime();
    const bTime = new Date(b.timestamp).getTime();
    return bTime - aTime;
  });

  return {
    retained: sorted.slice(0, max),
    evicted: sorted.slice(max),
    policy: "lfu"
  };
}

/* ------------------------------------------------------------------ */
/*  TTL - Time to Live                                                 */
/* ------------------------------------------------------------------ */

/**
 * Evict entries that have exceeded their time-to-live.
 */
export function evictTTL(
  entries: ContextEntry[],
  config: EvictionConfig
): EvictionResult {
  const ttlMs = config.ttlMs;
  if (ttlMs === undefined || ttlMs < 0) {
    throw new Error("evictTTL requires ttlMs");
  }

  const refTime = (config.referenceTime ?? new Date()).getTime();
  const retained: ContextEntry[] = [];
  const evicted: ContextEntry[] = [];

  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();
    if (Number.isNaN(entryTime) || refTime - entryTime > ttlMs) {
      evicted.push(entry);
    } else {
      retained.push(entry);
    }
  }

  return { retained, evicted, policy: "ttl" };
}

/* ------------------------------------------------------------------ */
/*  Unified evict()                                                    */
/* ------------------------------------------------------------------ */

/**
 * Apply an eviction policy to a set of context entries.
 */
export function evict(
  policy: EvictionPolicy,
  entries: ContextEntry[],
  config: EvictionConfig,
  accessRecords: EvictionAccessRecord[] = []
): EvictionResult {
  switch (policy) {
    case "lru":
      return evictLRU(entries, accessRecords, config);
    case "lfu":
      return evictLFU(entries, accessRecords, config);
    case "ttl":
      return evictTTL(entries, config);
    default:
      throw new Error(`Unknown eviction policy: ${policy as string}`);
  }
}
