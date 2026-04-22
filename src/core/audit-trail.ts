/**
 * Structured audit trail export with query API.
 *
 * Collects KernelEvents into a queryable ledger and supports exporting
 * in JSON Lines (JSONL) format for log ingestion pipelines.
 */

import type { KernelEvent } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  /** Monotonically increasing sequence number. */
  seq: number;
  /** The kernel event. */
  event: KernelEvent;
}

export interface AuditTrail {
  entries: AuditEntry[];
  nextSeq: number;
}

export interface AuditQuery {
  /** Filter by session id. */
  sessionId?: string;
  /** Filter by event type(s). */
  eventTypes?: KernelEvent["event"][];
  /** Only include events after this ISO timestamp. */
  after?: string;
  /** Only include events before this ISO timestamp. */
  before?: string;
  /** Maximum number of results. */
  limit?: number;
  /** Skip this many results (for pagination). */
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/*  Trail management                                                   */
/* ------------------------------------------------------------------ */

/**
 * Create a new empty audit trail.
 */
export function createAuditTrail(): AuditTrail {
  return { entries: [], nextSeq: 1 };
}

/**
 * Record a kernel event into the audit trail.
 */
export function recordEvent(trail: AuditTrail, event: KernelEvent): AuditEntry {
  const entry: AuditEntry = {
    seq: trail.nextSeq++,
    event: structuredClone(event)
  };
  trail.entries.push(entry);
  return entry;
}

/**
 * Create an `onEvent` hook that automatically records to a trail.
 */
export function createAuditHook(trail: AuditTrail): (event: KernelEvent) => void {
  return (event: KernelEvent) => {
    recordEvent(trail, event);
  };
}

/* ------------------------------------------------------------------ */
/*  Query API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Query the audit trail with flexible filters.
 */
export function queryAuditTrail(trail: AuditTrail, query: AuditQuery = {}): AuditQueryResult {
  let filtered = trail.entries;

  if (query.sessionId) {
    filtered = filtered.filter((e) => e.event.sessionId === query.sessionId);
  }

  if (query.eventTypes && query.eventTypes.length > 0) {
    const types = new Set(query.eventTypes);
    filtered = filtered.filter((e) => types.has(e.event.event));
  }

  if (query.after) {
    const afterTime = new Date(query.after).getTime();
    filtered = filtered.filter((e) => new Date(e.event.timestamp).getTime() > afterTime);
  }

  if (query.before) {
    const beforeTime = new Date(query.before).getTime();
    filtered = filtered.filter((e) => new Date(e.event.timestamp).getTime() < beforeTime);
  }

  const total = filtered.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? filtered.length;

  const paged = filtered.slice(offset, offset + limit);

  return {
    entries: paged,
    total,
    hasMore: offset + limit < total
  };
}

/* ------------------------------------------------------------------ */
/*  Export: JSON Lines                                                  */
/* ------------------------------------------------------------------ */

/**
 * Export the audit trail (or a subset) as JSON Lines format.
 * Each line is a self-contained JSON object.
 */
export function exportJSONL(trail: AuditTrail, query?: AuditQuery): string {
  const { entries } = query ? queryAuditTrail(trail, query) : { entries: trail.entries };

  return entries
    .map((entry) =>
      JSON.stringify({
        seq: entry.seq,
        event: entry.event.event,
        timestamp: entry.event.timestamp,
        sessionId: entry.event.sessionId,
        detail: entry.event.detail ?? {}
      })
    )
    .join("\n");
}

/**
 * Parse a JSONL string back into audit entries.
 */
export function importJSONL(jsonl: string): AuditEntry[] {
  const lines = jsonl.split("\n").filter((l) => l.trim().length > 0);
  const entries: AuditEntry[] = [];

  for (const line of lines) {
    const parsed = JSON.parse(line) as {
      seq: number;
      event: KernelEvent["event"];
      timestamp: string;
      sessionId: string;
      detail?: Record<string, unknown>;
    };

    entries.push({
      seq: parsed.seq,
      event: {
        event: parsed.event,
        timestamp: parsed.timestamp,
        sessionId: parsed.sessionId,
        detail: parsed.detail
      }
    });
  }

  return entries;
}

/**
 * Get summary statistics for the audit trail.
 */
export function auditStats(trail: AuditTrail): {
  totalEvents: number;
  eventCounts: Record<string, number>;
  sessionIds: string[];
  firstEvent?: string;
  lastEvent?: string;
} {
  const eventCounts: Record<string, number> = {};
  const sessionSet = new Set<string>();

  for (const entry of trail.entries) {
    eventCounts[entry.event.event] = (eventCounts[entry.event.event] ?? 0) + 1;
    sessionSet.add(entry.event.sessionId);
  }

  return {
    totalEvents: trail.entries.length,
    eventCounts,
    sessionIds: Array.from(sessionSet),
    firstEvent: trail.entries.length > 0 ? trail.entries[0].event.timestamp : undefined,
    lastEvent: trail.entries.length > 0 ? trail.entries[trail.entries.length - 1].event.timestamp : undefined
  };
}
