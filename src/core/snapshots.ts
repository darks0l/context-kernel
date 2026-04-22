/**
 * Context snapshots — save and restore full context state for session replay.
 *
 * Snapshots capture the complete state of a context store at a point in time
 * and allow restoring it later for debugging, replay, or branching sessions.
 */

import type { ContextEntry } from "./deduplication.js";
import type { UsageRecord } from "./priority.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ContextSnapshot {
  /** Unique snapshot identifier. */
  id: string;
  /** Session this snapshot belongs to. */
  sessionId: string;
  /** ISO timestamp of when the snapshot was taken. */
  createdAt: string;
  /** Human-readable label. */
  label?: string;
  /** Full set of context entries at snapshot time. */
  entries: ContextEntry[];
  /** Usage records at snapshot time. */
  usageRecords: UsageRecord[];
  /** Arbitrary metadata to attach. */
  metadata?: Record<string, unknown>;
}

export interface SnapshotStore {
  /** All snapshots keyed by snapshot id. */
  snapshots: Map<string, ContextSnapshot>;
}

/* ------------------------------------------------------------------ */
/*  Store management                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a new in-memory snapshot store.
 */
export function createSnapshotStore(): SnapshotStore {
  return { snapshots: new Map() };
}

/**
 * Take a snapshot of the current context state.
 */
export function takeSnapshot(
  store: SnapshotStore,
  params: {
    id: string;
    sessionId: string;
    entries: ContextEntry[];
    usageRecords?: UsageRecord[];
    label?: string;
    metadata?: Record<string, unknown>;
  }
): ContextSnapshot {
  if (!params.id || !params.sessionId) {
    throw new Error("Snapshot requires both id and sessionId");
  }

  const snapshot: ContextSnapshot = {
    id: params.id,
    sessionId: params.sessionId,
    createdAt: new Date().toISOString(),
    label: params.label,
    entries: structuredClone(params.entries),
    usageRecords: structuredClone(params.usageRecords ?? []),
    metadata: params.metadata ? structuredClone(params.metadata) : undefined
  };

  store.snapshots.set(snapshot.id, snapshot);
  return snapshot;
}

/**
 * Restore a snapshot by id. Returns deep copies of the stored entries
 * and usage records so the caller can modify them freely.
 */
export function restoreSnapshot(
  store: SnapshotStore,
  snapshotId: string
): { entries: ContextEntry[]; usageRecords: UsageRecord[] } {
  const snapshot = store.snapshots.get(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }
  return {
    entries: structuredClone(snapshot.entries),
    usageRecords: structuredClone(snapshot.usageRecords)
  };
}

/**
 * List all snapshots for a given session, sorted by creation time descending.
 */
export function listSnapshots(store: SnapshotStore, sessionId: string): ContextSnapshot[] {
  const results: ContextSnapshot[] = [];
  for (const snapshot of store.snapshots.values()) {
    if (snapshot.sessionId === sessionId) {
      results.push(snapshot);
    }
  }
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}

/**
 * Delete a snapshot by id. Returns true if it existed.
 */
export function deleteSnapshot(store: SnapshotStore, snapshotId: string): boolean {
  return store.snapshots.delete(snapshotId);
}

/**
 * Serialize a snapshot store to a JSON-compatible object.
 */
export function exportSnapshots(store: SnapshotStore): ContextSnapshot[] {
  return Array.from(store.snapshots.values());
}

/**
 * Import snapshots from a serialized array into the store.
 */
export function importSnapshots(store: SnapshotStore, snapshots: ContextSnapshot[]): number {
  let imported = 0;
  for (const snap of snapshots) {
    if (!snap.id || !snap.sessionId) continue;
    store.snapshots.set(snap.id, structuredClone(snap));
    imported++;
  }
  return imported;
}
