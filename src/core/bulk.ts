/**
 * Bulk operations for context entries.
 *
 * Provides batch insert, batch query, and batch delete for efficient
 * manipulation of large context stores. All operations return detailed
 * results with per-item success/failure tracking.
 */

import type { ContextEntry } from "./deduplication.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BulkInsertResult {
  /** Number of entries successfully inserted. */
  inserted: number;
  /** Number of entries that failed (e.g. duplicate id). */
  failed: number;
  /** Per-entry results. */
  results: Array<{ id: string; ok: boolean; reason?: string }>;
}

export interface BulkDeleteResult {
  /** Number of entries successfully deleted. */
  deleted: number;
  /** Number of ids that were not found. */
  notFound: number;
  /** Per-id results. */
  results: Array<{ id: string; ok: boolean }>;
}

export interface BulkQueryResult {
  /** Entries matching the query. */
  entries: ContextEntry[];
  /** Total matches found. */
  total: number;
}

export interface ContextStore {
  /** All entries keyed by id. */
  entries: Map<string, ContextEntry>;
}

/* ------------------------------------------------------------------ */
/*  Store management                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a new in-memory context store.
 */
export function createContextStore(): ContextStore {
  return { entries: new Map() };
}

/* ------------------------------------------------------------------ */
/*  Bulk Insert                                                        */
/* ------------------------------------------------------------------ */

/**
 * Insert multiple entries into the store in a single operation.
 * Entries with duplicate ids are skipped (not overwritten).
 */
export function bulkInsert(
  store: ContextStore,
  entries: ContextEntry[]
): BulkInsertResult {
  const results: BulkInsertResult["results"] = [];
  let inserted = 0;
  let failed = 0;

  for (const entry of entries) {
    if (!entry.id || entry.id.length === 0) {
      results.push({ id: entry.id ?? "", ok: false, reason: "missing id" });
      failed++;
      continue;
    }

    if (store.entries.has(entry.id)) {
      results.push({ id: entry.id, ok: false, reason: "duplicate id" });
      failed++;
      continue;
    }

    store.entries.set(entry.id, structuredClone(entry));
    results.push({ id: entry.id, ok: true });
    inserted++;
  }

  return { inserted, failed, results };
}

/**
 * Insert or update multiple entries (upsert semantics).
 * Existing entries with the same id are overwritten.
 */
export function bulkUpsert(
  store: ContextStore,
  entries: ContextEntry[]
): BulkInsertResult {
  const results: BulkInsertResult["results"] = [];
  let inserted = 0;
  let failed = 0;

  for (const entry of entries) {
    if (!entry.id || entry.id.length === 0) {
      results.push({ id: entry.id ?? "", ok: false, reason: "missing id" });
      failed++;
      continue;
    }

    store.entries.set(entry.id, structuredClone(entry));
    results.push({ id: entry.id, ok: true });
    inserted++;
  }

  return { inserted, failed, results };
}

/* ------------------------------------------------------------------ */
/*  Bulk Delete                                                        */
/* ------------------------------------------------------------------ */

/**
 * Delete multiple entries by id in a single operation.
 */
export function bulkDelete(
  store: ContextStore,
  ids: string[]
): BulkDeleteResult {
  const results: BulkDeleteResult["results"] = [];
  let deleted = 0;
  let notFound = 0;

  for (const id of ids) {
    if (store.entries.delete(id)) {
      results.push({ id, ok: true });
      deleted++;
    } else {
      results.push({ id, ok: false });
      notFound++;
    }
  }

  return { deleted, notFound, results };
}

/* ------------------------------------------------------------------ */
/*  Bulk Query                                                         */
/* ------------------------------------------------------------------ */

/**
 * Retrieve multiple entries by id. Missing ids are silently skipped.
 */
export function bulkGet(
  store: ContextStore,
  ids: string[]
): ContextEntry[] {
  const results: ContextEntry[] = [];
  for (const id of ids) {
    const entry = store.entries.get(id);
    if (entry) results.push(structuredClone(entry));
  }
  return results;
}

/**
 * Query entries with a filter predicate. Returns matching entries
 * with optional limit and offset for pagination.
 */
export function bulkQuery(
  store: ContextStore,
  predicate: (entry: ContextEntry) => boolean,
  options: { limit?: number; offset?: number } = {}
): BulkQueryResult {
  const all = Array.from(store.entries.values()).filter(predicate);
  const total = all.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? total;

  return {
    entries: all.slice(offset, offset + limit).map((e) => structuredClone(e)),
    total
  };
}

/**
 * Get all entries from the store.
 */
export function bulkGetAll(store: ContextStore): ContextEntry[] {
  return Array.from(store.entries.values()).map((e) => structuredClone(e));
}

/**
 * Get the total number of entries in the store.
 */
export function storeSize(store: ContextStore): number {
  return store.entries.size;
}
