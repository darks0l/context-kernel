import type { KernelEvent } from "../core/types.js";

/**
 * Audit backend interface — pluggable storage for kernel events.
 */
export interface AuditBackend {
  /**
   * Append a kernel event to the audit log.
   * Failures should be logged but not thrown (non-blocking).
   */
  append(event: KernelEvent): Promise<void>;

  /**
   * Query events matching the given filter.
   */
  query(filter: AuditFilter): Promise<KernelEvent[]>;

  /**
   * Get all events for a given session.
   */
  replay(sessionId: string): Promise<KernelEvent[]>;

  /**
   * Flush any pending writes. Implementations may be no-ops.
   */
  flush?(): Promise<void>;
}

export interface AuditFilter {
  sessionId?: string;
  event?: string;
  since?: string; // ISO timestamp
  until?: string;
  limit?: number;
}

/**
 * Audit pipeline — fans out append() to multiple backends.
 */
export class AuditPipeline {
  constructor(private readonly backends: AuditBackend[]) {}

  async append(event: KernelEvent): Promise<void> {
    await Promise.allSettled(
      this.backends.map((b) => b.append(event))
    );
  }

  async query(filter: AuditFilter): Promise<KernelEvent[]> {
    if (this.backends.length === 0) return [];
    return this.backends[0].query(filter);
  }

  async replay(sessionId: string): Promise<KernelEvent[]> {
    if (this.backends.length === 0) return [];
    return this.backends[0].replay(sessionId);
  }

  async flush(): Promise<void> {
    await Promise.allSettled(
      this.backends.map((b) => b.flush?.())
    );
  }
}
