/**
 * File-based storage adapter for KernelStorageAdapter.
 *
 * Persists memory snapshots and candidates to the filesystem.
 * Useful for Node.js environments without a database.
 *
 * @example
 * ```ts
 * import { FileStorageAdapter } from "@darksol/context-kernel/adapters/file";
 * import { ContextKernel } from "@darksol/context-kernel";
 *
 * const storage = new FileStorageAdapter({ dir: "./kernel-data" });
 * const kernel = new ContextKernel(config, {
 *   storage,
 * });
 * ```
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { KernelStorageAdapter, MemorySnapshot, MemoryCandidate } from "../../core/types.js";

export interface FileStorageConfig {
  /** Directory to store snapshot and candidate files. Defaults to "./kernel-data" */
  dir?: string;
  /** Suffix for snapshot files. Defaults to ".snapshot.json" */
  snapshotSuffix?: string;
  /** Suffix for candidates file. Defaults to ".candidates.json" */
  candidatesSuffix?: string;
}

const DEFAULT_CONFIG: Required<FileStorageConfig> = {
  dir: "./kernel-data",
  snapshotSuffix: ".snapshot.json",
  candidatesSuffix: ".candidates.json",
};

export class FileStorageAdapter implements KernelStorageAdapter {
  private readonly dir: string;
  private readonly snapshotSuffix: string;
  private readonly candidatesSuffix: string;

  constructor(config: FileStorageConfig = {}) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.dir = resolve(cfg.dir);
    this.snapshotSuffix = cfg.snapshotSuffix;
    this.candidatesSuffix = cfg.candidatesSuffix;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private snapshotPath(version: string): string {
    return join(this.dir, `v${version}${this.snapshotSuffix}`);
  }

  private candidatesPath(): string {
    return join(this.dir, `candidates${this.candidatesSuffix}`);
  }

  // ─── KernelStorageAdapter ─────────────────────────────────────────────────

  async saveSnapshot(snapshot: MemorySnapshot): Promise<void> {
    const path = this.snapshotPath(snapshot.version);
    writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async loadSnapshot(version: string): Promise<MemorySnapshot | null> {
    const path = this.snapshotPath(version);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as MemorySnapshot;
    } catch {
      return null;
    }
  }

  async listSnapshots(): Promise<Array<{ version: string; createdAt: string; tokenCount: number }>> {
    this.ensureDir();
    const files = readdirSync(this.dir).filter((f) => f.endsWith(this.snapshotSuffix));
    const snapshots: Array<{ version: string; createdAt: string; tokenCount: number }> = [];

    for (const file of files) {
      // Strip suffix and "v" prefix to get version
      const version = file.replace(this.snapshotSuffix, "").replace(/^v/, "");
      const path = join(this.dir, file);
      try {
        const data = JSON.parse(readFileSync(path, "utf8")) as MemorySnapshot;
        snapshots.push({
          version,
          createdAt: data.createdAt,
          tokenCount: data.tokenCount,
        });
      } catch {
        // Skip malformed files
      }
    }

    // Sort by version descending (newest first)
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return snapshots;
  }

  async deleteSnapshot(version: string): Promise<void> {
    const path = this.snapshotPath(version);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  async saveMemoryCandidates(candidates: MemoryCandidate[]): Promise<void> {
    const path = this.candidatesPath();
    writeFileSync(path, JSON.stringify(candidates, null, 2), "utf8");
  }

  async loadMemoryCandidates(): Promise<MemoryCandidate[]> {
    const path = this.candidatesPath();
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, "utf8")) as MemoryCandidate[];
    } catch {
      return [];
    }
  }
}
