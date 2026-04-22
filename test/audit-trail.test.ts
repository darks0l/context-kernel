import { describe, expect, it } from "vitest";
import {
  createAuditTrail,
  recordEvent,
  createAuditHook,
  queryAuditTrail,
  exportJSONL,
  importJSONL,
  auditStats
} from "../src/core/audit-trail.js";
import { ContextKernel } from "../src/core/kernel.js";
import type { KernelEvent } from "../src/core/types.js";

describe("audit trail", () => {
  const makeEvent = (
    event: KernelEvent["event"],
    sessionId: string,
    timestamp: string
  ): KernelEvent => ({
    event,
    sessionId,
    timestamp,
    detail: { test: true }
  });

  it("records events with sequential numbering", () => {
    const trail = createAuditTrail();

    const e1 = recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    const e2 = recordEvent(trail, makeEvent("completed", "s1", "2026-04-03T10:01:00Z"));

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(trail.entries.length).toBe(2);
  });

  it("queries by sessionId", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("started", "s2", "2026-04-03T10:01:00Z"));
    recordEvent(trail, makeEvent("completed", "s1", "2026-04-03T10:02:00Z"));

    const result = queryAuditTrail(trail, { sessionId: "s1" });
    expect(result.total).toBe(2);
    expect(result.entries.every((e) => e.event.sessionId === "s1")).toBe(true);
  });

  it("queries by event type", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("routed", "s1", "2026-04-03T10:01:00Z"));
    recordEvent(trail, makeEvent("completed", "s1", "2026-04-03T10:02:00Z"));

    const result = queryAuditTrail(trail, { eventTypes: ["started", "completed"] });
    expect(result.total).toBe(2);
  });

  it("queries by time range", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-01T10:00:00Z"));
    recordEvent(trail, makeEvent("completed", "s1", "2026-04-02T10:00:00Z"));
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));

    const result = queryAuditTrail(trail, {
      after: "2026-04-01T12:00:00Z",
      before: "2026-04-03T00:00:00Z"
    });

    expect(result.total).toBe(1);
    expect(result.entries[0].event.timestamp).toBe("2026-04-02T10:00:00Z");
  });

  it("supports pagination with limit and offset", () => {
    const trail = createAuditTrail();
    for (let i = 0; i < 10; i++) {
      recordEvent(trail, makeEvent("started", "s1", `2026-04-03T10:0${i}:00Z`));
    }

    const page1 = queryAuditTrail(trail, { limit: 3, offset: 0 });
    expect(page1.entries.length).toBe(3);
    expect(page1.total).toBe(10);
    expect(page1.hasMore).toBe(true);

    const page2 = queryAuditTrail(trail, { limit: 3, offset: 3 });
    expect(page2.entries.length).toBe(3);
    expect(page2.entries[0].seq).toBe(4);
  });

  it("exports to JSONL format", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("completed", "s1", "2026-04-03T10:01:00Z"));

    const jsonl = exportJSONL(trail);
    const lines = jsonl.split("\n");

    expect(lines.length).toBe(2);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.seq).toBe(1);
    expect(parsed.event).toBe("started");
    expect(parsed.sessionId).toBe("s1");
  });

  it("exports filtered JSONL via query", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("completed", "s2", "2026-04-03T10:01:00Z"));

    const jsonl = exportJSONL(trail, { sessionId: "s1" });
    const lines = jsonl.split("\n");
    expect(lines.length).toBe(1);
  });

  it("round-trips JSONL import/export", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("routed", "s1", "2026-04-03T10:01:00Z"));

    const jsonl = exportJSONL(trail);
    const imported = importJSONL(jsonl);

    expect(imported.length).toBe(2);
    expect(imported[0].event.event).toBe("started");
    expect(imported[1].event.event).toBe("routed");
  });

  it("computes audit stats", () => {
    const trail = createAuditTrail();
    recordEvent(trail, makeEvent("started", "s1", "2026-04-03T10:00:00Z"));
    recordEvent(trail, makeEvent("completed", "s1", "2026-04-03T10:01:00Z"));
    recordEvent(trail, makeEvent("started", "s2", "2026-04-03T10:02:00Z"));

    const stats = auditStats(trail);
    expect(stats.totalEvents).toBe(3);
    expect(stats.eventCounts.started).toBe(2);
    expect(stats.eventCounts.completed).toBe(1);
    expect(stats.sessionIds).toContain("s1");
    expect(stats.sessionIds).toContain("s2");
  });

  it("integrates with ContextKernel via audit hook", async () => {
    const trail = createAuditTrail();
    const hook = createAuditHook(trail);

    const kernel = new ContextKernel(
      {
        router: { tokenCompressionThreshold: 10000, allowPremiumEscalation: true },
        policy: { postOnlyMode: false, blockedSecretPatterns: [] }
      },
      { onEvent: hook }
    );

    await kernel.decide({
      sessionId: "audit-test",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "hello world" }]
    });

    const result = queryAuditTrail(trail, { sessionId: "audit-test" });
    expect(result.total).toBeGreaterThanOrEqual(3); // started, classified, routed, completed
    expect(result.entries.some((e) => e.event.event === "started")).toBe(true);
    expect(result.entries.some((e) => e.event.event === "completed")).toBe(true);
  });
});
