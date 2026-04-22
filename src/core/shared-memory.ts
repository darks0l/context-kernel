/**
 * Cross-session context sharing via shared memory pools.
 *
 * Allows multiple sessions to publish context entries into named pools
 * and subscribe to entries from other sessions. Useful for multi-agent
 * coordination or shared workspace contexts.
 */

import type { ContextEntry } from "./deduplication.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SharedMemoryPool {
  /** Pool name (unique identifier). */
  name: string;
  /** ISO timestamp when the pool was created. */
  createdAt: string;
  /** Sessions that have published to or subscribed to this pool. */
  members: Set<string>;
  /** Context entries in the pool, keyed by entry id. */
  entries: Map<string, SharedEntry>;
  /** Maximum number of entries the pool can hold. 0 = unlimited. */
  maxEntries: number;
}

export interface SharedEntry {
  entry: ContextEntry;
  /** Session that published this entry. */
  publishedBy: string;
  /** ISO timestamp when published. */
  publishedAt: string;
}

export interface SharedMemoryRegistry {
  pools: Map<string, SharedMemoryPool>;
}

export interface PublishResult {
  poolName: string;
  entryId: string;
  accepted: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/*  Registry management                                                */
/* ------------------------------------------------------------------ */

/**
 * Create a new shared memory registry.
 */
export function createSharedMemoryRegistry(): SharedMemoryRegistry {
  return { pools: new Map() };
}

/**
 * Create a named shared memory pool.
 */
export function createPool(
  registry: SharedMemoryRegistry,
  name: string,
  maxEntries: number = 0
): SharedMemoryPool {
  if (registry.pools.has(name)) {
    throw new Error(`Pool already exists: ${name}`);
  }
  const pool: SharedMemoryPool = {
    name,
    createdAt: new Date().toISOString(),
    members: new Set(),
    entries: new Map(),
    maxEntries
  };
  registry.pools.set(name, pool);
  return pool;
}

/**
 * Get a pool by name, or throw if it doesn't exist.
 */
export function getPool(registry: SharedMemoryRegistry, name: string): SharedMemoryPool {
  const pool = registry.pools.get(name);
  if (!pool) throw new Error(`Pool not found: ${name}`);
  return pool;
}

/**
 * Delete a pool and all its entries.
 */
export function deletePool(registry: SharedMemoryRegistry, name: string): boolean {
  return registry.pools.delete(name);
}

/**
 * List all pool names in the registry.
 */
export function listPools(registry: SharedMemoryRegistry): string[] {
  return Array.from(registry.pools.keys());
}

/* ------------------------------------------------------------------ */
/*  Publish / Subscribe                                                */
/* ------------------------------------------------------------------ */

/**
 * Publish a context entry to a shared pool.
 */
export function publish(
  registry: SharedMemoryRegistry,
  poolName: string,
  sessionId: string,
  entry: ContextEntry
): PublishResult {
  const pool = registry.pools.get(poolName);
  if (!pool) {
    return { poolName, entryId: entry.id, accepted: false, reason: "pool not found" };
  }

  if (pool.maxEntries > 0 && pool.entries.size >= pool.maxEntries) {
    return { poolName, entryId: entry.id, accepted: false, reason: "pool is full" };
  }

  pool.members.add(sessionId);
  pool.entries.set(entry.id, {
    entry: structuredClone(entry),
    publishedBy: sessionId,
    publishedAt: new Date().toISOString()
  });

  return { poolName, entryId: entry.id, accepted: true };
}

/**
 * Subscribe a session to a pool (registers membership without publishing).
 */
export function subscribe(
  registry: SharedMemoryRegistry,
  poolName: string,
  sessionId: string
): void {
  const pool = getPool(registry, poolName);
  pool.members.add(sessionId);
}

/**
 * Retrieve all entries from a pool, optionally excluding entries
 * published by the requesting session.
 */
export function readPool(
  registry: SharedMemoryRegistry,
  poolName: string,
  options: { excludeSessionId?: string } = {}
): ContextEntry[] {
  const pool = getPool(registry, poolName);
  const results: ContextEntry[] = [];

  for (const shared of pool.entries.values()) {
    if (options.excludeSessionId && shared.publishedBy === options.excludeSessionId) continue;
    results.push(structuredClone(shared.entry));
  }

  return results;
}

/**
 * Remove a specific entry from a pool. Returns true if it existed.
 */
export function removeEntry(
  registry: SharedMemoryRegistry,
  poolName: string,
  entryId: string
): boolean {
  const pool = registry.pools.get(poolName);
  if (!pool) return false;
  return pool.entries.delete(entryId);
}

/**
 * Get the count of entries and members for a pool.
 */
export function poolStats(
  registry: SharedMemoryRegistry,
  poolName: string
): { entryCount: number; memberCount: number; maxEntries: number } {
  const pool = getPool(registry, poolName);
  return {
    entryCount: pool.entries.size,
    memberCount: pool.members.size,
    maxEntries: pool.maxEntries
  };
}
