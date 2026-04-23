import { describe, expect, it } from "vitest";
import {
  fromHttpEnvelope,
  type HttpEnvelope
} from "../src/adapters/http/index.js";
import {
  fromOpenClawEnvelope,
  type OpenClawEnvelope
} from "../src/adapters/openclaw/index.js";

describe("HTTP adapter", () => {
  describe("fromHttpEnvelope", () => {
    it("converts a minimal HTTP envelope to KernelInput", () => {
      const env: HttpEnvelope = {
        id: "session-abc",
        at: "2026-04-03T12:00:00Z",
        payload: {
          messages: [
            { role: "user", content: "Hello world" }
          ]
        }
      };

      const input = fromHttpEnvelope(env);

      expect(input.sessionId).toBe("session-abc");
      expect(input.timestamp).toBe("2026-04-03T12:00:00Z");
      expect(input.messages).toEqual([{ role: "user", content: "Hello world" }]);
      expect(input.attachments).toBeUndefined();
      expect(input.metadata).toBeUndefined();
      expect(input.estimatedTokens).toBeUndefined();
    });

    it("maps all payload fields", () => {
      const env: HttpEnvelope = {
        id: "session-full",
        at: "2026-04-03T12:00:00Z",
        payload: {
          messages: [
            { role: "system", content: "You are helpful" },
            { role: "user", content: "What's the weather?" },
            { role: "assistant", content: "It's sunny" }
          ],
          attachments: [
            { type: "image", name: "chart.png" },
            { type: "file", name: "report.pdf" }
          ],
          metadata: { userId: "u123", plan: "pro" },
          estimatedTokens: 8500
        }
      };

      const input = fromHttpEnvelope(env);

      expect(input.messages).toHaveLength(3);
      expect(input.attachments).toHaveLength(2);
      expect(input.attachments![0]).toEqual({ type: "image", name: "chart.png" });
      expect(input.attachments![1]).toEqual({ type: "file", name: "report.pdf" });
      expect(input.metadata).toEqual({ userId: "u123", plan: "pro" });
      expect(input.estimatedTokens).toBe(8500);
    });

    it("handles empty attachments and missing optional fields", () => {
      const env: HttpEnvelope = {
        id: "minimal",
        at: "2026-04-03T00:00:00Z",
        payload: {
          messages: [{ role: "user", content: "ping" }]
        }
      };

      const input = fromHttpEnvelope(env);

      expect(input.attachments).toBeUndefined();
      expect(input.metadata).toBeUndefined();
      expect(input.estimatedTokens).toBeUndefined();
    });

    it("maps audio attachments", () => {
      const env: HttpEnvelope = {
        id: "audio-session",
        at: "2026-04-03T12:00:00Z",
        payload: {
          messages: [{ role: "user", content: "listen to this" }],
          attachments: [{ type: "audio", name: "voicenote.ogg" }]
        }
      };

      const input = fromHttpEnvelope(env);
      expect(input.attachments![0].type).toBe("audio");
      expect(input.attachments![0].name).toBe("voicenote.ogg");
    });
  });
});

describe("OpenClaw adapter", () => {
  describe("fromOpenClawEnvelope", () => {
    it("converts a minimal OpenClaw envelope to KernelInput", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "claw-session-xyz",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [{ role: "user", content: "run a task" }]
      };

      const input = fromOpenClawEnvelope(env);

      expect(input.sessionId).toBe("claw-session-xyz");
      expect(input.timestamp).toBe("2026-04-03T14:00:00Z");
      expect(input.messages).toEqual([{ role: "user", content: "run a task" }]);
    });

    it("maps all envelope fields", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "full-session",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [
          { role: "system", content: "You are Darksol" },
          { role: "user", content: "Build something" },
          { role: "assistant", content: "Done." }
        ],
        images: [{ name: "mockup.png" }, { name: "design.jpg" }],
        metadata: { channel: "discord", userId: "u999" },
        estimatedTokens: 4200
      };

      const input = fromOpenClawEnvelope(env);

      expect(input.messages).toHaveLength(3);
      expect(input.attachments).toHaveLength(2);
      expect(input.attachments![0]).toEqual({ type: "image", name: "mockup.png" });
      expect(input.attachments![1]).toEqual({ type: "image", name: "design.jpg" });
      expect(input.metadata).toEqual({ channel: "discord", userId: "u999" });
      expect(input.estimatedTokens).toBe(4200);
    });

    it("normalizes unknown roles to 'user'", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "role-test",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [
          { role: "assistant", content: "I am known" },
          { role: "unknown_role", content: "What am I?" },
          { role: "system", content: "System here" },
          { role: "tool", content: "Tool result" }
        ]
      };

      const input = fromOpenClawEnvelope(env);

      expect(input.messages[0].role).toBe("assistant");
      expect(input.messages[1].role).toBe("user"); // unknown normalized to user
      expect(input.messages[2].role).toBe("system");
      expect(input.messages[3].role).toBe("tool");
    });

    it("handles empty images array", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "no-images",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [{ role: "user", content: "text only" }],
        images: []
      };

      const input = fromOpenClawEnvelope(env);
      expect(input.attachments).toEqual([]);
    });

    it("handles missing optional fields", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "minimal-claw",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [{ role: "user", content: "hello" }]
      };

      const input = fromOpenClawEnvelope(env);

      expect(input.images).toBeUndefined();
      expect(input.metadata).toBeUndefined();
      expect(input.estimatedTokens).toBeUndefined();
    });

    it("preserves message content exactly", () => {
      const env: OpenClawEnvelope = {
        sessionKey: "content-test",
        timestamp: "2026-04-03T14:00:00Z",
        messages: [
          { role: "user", content: "Hello! 👋 How are you today?" },
          { role: "assistant", content: "I'm doing great! <script>alert('xss')</script>" }
        ]
      };

      const input = fromOpenClawEnvelope(env);

      expect(input.messages[0].content).toBe("Hello! 👋 How are you today?");
      expect(input.messages[1].content).toBe("I'm doing great! <script>alert('xss')</script>");
    });
  });
});
