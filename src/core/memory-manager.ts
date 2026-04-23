/**
 * Lossless Context Memory (LCM) — Versioned Memory Manager for context-kernel
 *
 * Manages the full memory lifecycle: sliding message window, versioned snapshots,
 * semantic versioning, and automatic compaction integration.
 *
 * Design principles:
 * - Kernel owns the memory state; harness passes messages at decide() time
 * - Compaction runs automatically via tick() or decision-count triggers
 * - Storage adapter lets harness persist snapshots to any backend
 * - IdentityDriftGuard runs during every compaction cycle
 */

import { checkDrift, buildIdentitySnapshot } from "./identity-drift.js";
import type {
  MemoryCandidate,
  IdentitySnapshot,
  IdentityDriftConfig,
  KernelStorageAdapter,
  MemoryConfig,
  MemorySnapshot,
  MemoryDiff,
  DriftVerdict,
} from "./types.js";
import type { CompactionConfig, CompactionResult } from "./compaction.js";

export type { KernelStorageAdapter, MemoryConfig, MemorySnapshot, MemoryDiff };
export type { CompactionConfig } from "./compaction.js";

// Default config
export const defaultMemoryConfig: MemoryConfig = {
  maxWindowMessages: 500,
  keepLastMessages: 50,
  compactionIntervalDecisions: 50,
  maxSnapshots: 20,
  autoCompactBuffer: 13_000,
};

// ============================================================================
// Memory Manager
// ============================================================================

export class MemoryManager {
  private messageWindow: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [];
  private snapshotStore = new Map<string, MemorySnapshot>();
  private currentVersion = "0.0.0";
  private parentVersion: string | null = null;
  private decisionCount = 0;
  private isCompacting = false;
  private lastCompactionAt: string | null = null;
  private identitySnapshot: IdentitySnapshot | null = null;

  constructor(
    private memoryConfig: Required<MemoryConfig>,
    private driftConfig: IdentityDriftConfig | null,
    private compactionConfig: CompactionConfig,
  ) {
    // Apply defaults — user-provided values override defaults
    this.memoryConfig = { ...defaultMemoryConfig, ...memoryConfig } as Required<MemoryConfig>;
    if (this.driftConfig?.enabled && this.driftConfig.constitutionStatements?.length) {
      this.identitySnapshot = buildIdentitySnapshot(this.driftConfig.constitutionStatements, "1.0");
    }
    // Load persisted snapshots from storage adapter (non-blocking, best-effort)
    this.loadFromStorage().catch((err) => {
      // Swallow: storage is best-effort, kernel must remain operational without it
    });
  }

  /**
   * Load existing snapshots from storage adapter.
   * Called once on construction to restore state from prior runs.
   * Errors are swallowed — storage is optional.
   */
  private async loadFromStorage(): Promise<void> {
    const { storage } = this.memoryConfig;
    if (!storage) return;

    try {
      const snapshots = await storage.listSnapshots();
      for (const meta of snapshots) {
        const snap = await storage.loadSnapshot(meta.version);
        if (snap) {
          this.snapshotStore.set(snap.version, snap);
          // Track the highest version as current
          if (this.compareVersions(snap.version, this.currentVersion) > 0) {
            this.currentVersion = snap.version;
            this.parentVersion = snap.parent;
          }
        }
      }
    } catch {
      // Storage read failed — proceed without restored state
    }
  }

  /**
   * Compare two semver strings. Returns positive if a > b, negative if a < b, 0 if equal.
   */
  private compareVersions(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const da = pa[i] ?? 0;
      const db = pb[i] ?? 0;
      if (da !== db) return da - db;
    }
    return 0;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Feed new messages into the memory window.
   * Called by kernel.decide() on every invocation.
   */
  ingest(messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>): void {
    this.messageWindow.push(...messages);
    const { maxWindowMessages } = this.memoryConfig;
    if (this.messageWindow.length > maxWindowMessages) {
      this.messageWindow = this.messageWindow.slice(-maxWindowMessages);
    }
  }

  /**
   * Check if compaction should run (call this on each decide()).
   */
  shouldCompact(): boolean {
    if (this.isCompacting) return false;
    const { compactionIntervalDecisions, maxWindowMessages } = this.memoryConfig;
    if (compactionIntervalDecisions > 0 && this.decisionCount > 0 && this.decisionCount % compactionIntervalDecisions === 0) {
      return true;
    }
    if (this.messageWindow.length >= maxWindowMessages) {
      return true;
    }
    return false;
  }

  /**
   * Periodic tick — called by harness heartbeat (non-blocking).
   */
  tick(): { needsCompaction: boolean; snapshotCount: number; windowSize: number } {
    return {
      needsCompaction: this.shouldCompact(),
      snapshotCount: this.snapshotStore.size,
      windowSize: this.messageWindow.length,
    };
  }

  /**
   * Run compaction: produce a new MemorySnapshot, update version DAG.
   * The harness provides the summarization function (LLM call is harness's responsibility).
   */
  async compact(
    summaryFn: (messages: Array<{ role: string; content: string }>, config: CompactionConfig) => Promise<CompactionResult>,
  ): Promise<MemorySnapshot> {
    if (this.isCompacting) {
      throw new Error("Compaction already in progress");
    }
    this.isCompacting = true;
    const messagesToCompact = this.messageWindow.length;
    const previousVersion = this.currentVersion;

    try {
      // 1. Build LCM summary (harness provides the LLM summarization function)
      const msgs = this.messageWindow as Array<{ role: string; content: string }>;
      const result = await summaryFn(msgs, this.compactionConfig);

      // 2. Identity drift check
      let driftVerdict: DriftVerdict | undefined;
      if (this.identitySnapshot) {
        driftVerdict = checkDrift(
          this.messageWindow,
          this.identitySnapshot,
          this.driftConfig!,
        );
      }

      // 3. Determine version bump
      const { version, parent } = this.bumpVersion(previousVersion, driftVerdict);

      // 4. Extract memory candidates from the window
      const memoryEntries = this.extractMemoryEntries(this.messageWindow);

      // 5. Build snapshot
      const snapshot: MemorySnapshot = {
        version,
        parent,
        summary: result.summary,
        memoryEntries,
        createdAt: new Date().toISOString(),
        driftScore: driftVerdict?.score,
        tokenCount: result.tokensFreed,
        messagesCompacted: messagesToCompact,
        driftVerdict,
      };

      // 6. Persist via adapter
      this.snapshotStore.set(version, snapshot);
      if (this.memoryConfig.storage) {
        await this.memoryConfig.storage.saveSnapshot(snapshot);
      }

      // 7. Trim window (keep survivors)
      this.messageWindow = this.messageWindow.slice(-this.memoryConfig.keepLastMessages);
      this.currentVersion = version;
      this.parentVersion = parent;
      this.lastCompactionAt = snapshot.createdAt;

      // 8. Garbage collect old snapshots
      await this.gcSnapshots();

      return snapshot;
    } finally {
      this.isCompacting = false;
    }
  }

  /** Get the latest snapshot */
  getLatestSnapshot(): MemorySnapshot | null {
    if (this.currentVersion === "0.0.0") return null;
    return this.snapshotStore.get(this.currentVersion) ?? null;
  }

  /** Get a specific version */
  getSnapshot(version: string): MemorySnapshot | null {
    return this.snapshotStore.get(version) ?? null;
  }

  /** Get the current version string */
  getVersion(): string {
    return this.currentVersion;
  }

  /** Get memory diff between two versions */
  async getMemoryDiff(from: string, to: string): Promise<MemoryDiff | null> {
    const fromSnap = this.snapshotStore.get(from);
    const toSnap = this.snapshotStore.get(to);
    if (!fromSnap || !toSnap) return null;

    const fromIds = new Set(fromSnap.memoryEntries.map((e) => e.summary));
    const toIds = new Set(toSnap.memoryEntries.map((e) => e.summary));

    const added = toSnap.memoryEntries.filter((e) => !fromIds.has(e.summary));
    const removed = fromSnap.memoryEntries
      .filter((e) => !toIds.has(e.summary))
      .map((e) => e.summary);

    return {
      from,
      to,
      added,
      removed,
      modified: [],
      driftDetected: (toSnap.driftScore ?? 0) > (fromSnap.driftScore ?? 0),
      tokensSaved: toSnap.tokenCount,
    };
  }

  /** Increment decision counter */
  incrementDecisions(): void {
    this.decisionCount++;
  }

  /** Get current window */
  getWindow(): Array<{ role: string; content: string }> {
    return [...this.messageWindow] as Array<{ role: string; content: string }>;
  }

  /** Get all snapshot versions sorted */
  getSnapshotVersions(): string[] {
    return Array.from(this.snapshotStore.keys()).sort();
  }

  /** Last compaction timestamp */
  getLastCompactionAt(): string | null {
    return this.lastCompactionAt;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private bumpVersion(current: string, driftVerdict?: DriftVerdict): { version: string; parent: string } {
    const parts = current.split(".").map(Number);
    const [major, minor, patch] = parts;

    // Major bump: identity drift detected
    if (driftVerdict?.drifted) {
      return { version: `${major + 1}.0.0`, parent: current };
    }
    // Minor bump: new memory absorbed
    if (minor < 9) {
      return { version: `${major}.${minor + 1}.0`, parent: current };
    }
    // Patch bump
    return { version: `${major}.${minor}.${patch + 1}`, parent: current };
  }

  private extractMemoryEntries(
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>,
  ): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const userMessages = messages.filter((m) => m.role === "user" && m.content.trim().length > 0);

    for (const msg of userMessages) {
      const text = msg.content;
      if (/remember|always|never|preference|i like|i prefer/i.test(text)) {
        candidates.push({
          summary: text.slice(0, 200),
          tags: ["preference"],
          priority: "high",
          confidence: 0.9,
          source: { messageIndexes: [], strategy: "preference" },
        });
      } else if (/decided|decision|we will|we should|approved/i.test(text)) {
        candidates.push({
          summary: text.slice(0, 200),
          tags: ["decision"],
          priority: "high",
          confidence: 0.85,
          source: { messageIndexes: [], strategy: "decision" },
        });
      }
    }
    return candidates;
  }

  private async gcSnapshots(): Promise<void> {
    const { storage, maxSnapshots } = this.memoryConfig;
    if (!storage || maxSnapshots <= 0) return;
    if (this.snapshotStore.size <= maxSnapshots) return;

    const all = await storage.listSnapshots();
    const toDelete = all
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, this.snapshotStore.size - maxSnapshots);

    for (const { version } of toDelete) {
      this.snapshotStore.delete(version);
      await storage.deleteSnapshot(version);
    }
  }
}
