import { createWriteStream, createReadStream, existsSync } from "fs";
import { appendFile, readFile, readdir, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import type { AuditBackend, AuditFilter } from "./types.js";
import type { KernelEvent } from "../core/types.js";

/**
 * JSONL (newline-delimited JSON) audit backend.
 * Appends each event as a JSON line to a rolling log file.
 */
export class JsonlAuditBackend implements AuditBackend {
  private readonly path: string;
  private writeStream?: ReturnType<typeof createWriteStream>;
  private pending: string[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(path: string) {
    this.path = path;
  }

  private ensureDir(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      // Best-effort dir creation
      mkdir(dir, { recursive: true }).catch(() => {});
    }
  }

  private getStream(): ReturnType<typeof createWriteStream> {
    if (!this.writeStream) {
      this.ensureDir();
      this.writeStream = createWriteStream(this.path, { flags: "a", encoding: "utf8" });
      this.writeStream.on("error", (err) => {
        console.error("[audit:jsonl] write error:", err.message);
      });
    }
    return this.writeStream;
  }

  async append(event: KernelEvent): Promise<void> {
    const line = JSON.stringify(event) + "\n";
    try {
      // Simple flush-every-10 or 100ms approach
      this.pending.push(line);
      if (this.pending.length >= 10) {
        await this.flushPending();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flushPending().catch(() => {}), 100);
      }
    } catch (err) {
      console.error("[audit:jsonl] append error:", err);
    }
  }

  private async flushPending(): Promise<void> {
    if (this.pending.length === 0) return;
    const lines = this.pending.splice(0);
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    try {
      await appendFile(this.path, lines.join(""), "utf8");
    } catch (err) {
      console.error("[audit:jsonl] flush error:", err);
    }
  }

  async query(filter: AuditFilter): Promise<KernelEvent[]> {
    if (!existsSync(this.path)) return [];
    try {
      const content = await readFile(this.path, "utf8");
      const events: KernelEvent[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as KernelEvent;
          if (filter.sessionId && event.sessionId !== filter.sessionId) continue;
          if (filter.event && event.event !== filter.event) continue;
          if (filter.since && event.timestamp < filter.since) continue;
          if (filter.until && event.timestamp > filter.until) continue;
          events.push(event);
          if (filter.limit && events.length >= filter.limit) break;
        } catch {
          // Skip malformed lines
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  async replay(sessionId: string): Promise<KernelEvent[]> {
    return this.query({ sessionId });
  }

  async flush(): Promise<void> {
    await this.flushPending();
  }
}

/**
 * Webhook audit backend — POSTs events to a remote URL.
 */
export class WebhookAuditBackend implements AuditBackend {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private pending: KernelEvent[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = { "Content-Type": "application/json", ...headers };
  }

  async append(event: KernelEvent): Promise<void> {
    this.pending.push(event);
    if (this.pending.length >= 5) {
      await this.flushPending();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushPending().catch(() => {}), 500);
    }
  }

  private async flushPending(): Promise<void> {
    if (this.pending.length === 0) return;
    const events = this.pending.splice(0);
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        console.error(`[audit:webhook] HTTP ${response.status}: ${await response.text()}`);
      }
    } catch (err) {
      console.error("[audit:webhook] failed to POST events:", err);
    }
  }

  async query(_filter: AuditFilter): Promise<KernelEvent[]> {
    // Webhook backends are write-only by nature; query is not supported
    return [];
  }

  async replay(_sessionId: string): Promise<KernelEvent[]> {
    return [];
  }

  async flush(): Promise<void> {
    await this.flushPending();
  }
}
