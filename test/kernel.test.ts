import { describe, expect, it } from "vitest";
import { ContextKernel } from "../src/core/kernel.js";

describe("ContextKernel", () => {
  const kernel = new ContextKernel({
    router: { tokenCompressionThreshold: 10000, allowPremiumEscalation: true },
    policy: {
      postOnlyMode: false,
      blockedSecretPatterns: ["password", "token"],
      rules: [
        {
          id: "allow-send-and-post",
          kind: "action_allowlist",
          actions: ["send", "post"]
        }
      ]
    }
  });

  it("routes multimodal input to qwen3-vl", async () => {
    const decision = await kernel.decide({
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "describe this" }],
      attachments: [{ type: "image", name: "screen.png" }]
    });

    expect(decision.route).toBe("qwen3-vl");
  });

  it("marks compression when token budget exceeded", async () => {
    const decision = await kernel.decide({
      sessionId: "s2",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "refactor repo" }],
      estimatedTokens: 12000
    });

    expect(decision.compress).toBe(true);
  });

  it("blocks potential secret leakage", async () => {
    const decision = await kernel.decide({
      sessionId: "s3",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "my password is 123" }]
    });

    expect(decision.policyVerdicts.noSecretGuard.allowed).toBe(false);
  });

  it("applies action allowlist DSL rule", async () => {
    const decision = await kernel.decide({
      sessionId: "s4",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "ship it" }],
      metadata: { requestedActions: ["delete"] }
    });

    expect(decision.policyVerdicts["rule:allow-send-and-post"].allowed).toBe(false);
  });

  it("returns memory candidates with confidence and writeback hint", async () => {
    const decision = await kernel.decide({
      sessionId: "s5",
      timestamp: new Date().toISOString(),
      messages: [{ role: "user", content: "Remember I prefer concise status updates." }]
    });

    expect(decision.memoryCandidates[0].confidence).toBeGreaterThan(0.8);
    expect(decision.memoryCandidates[0].writebackHint?.namespace).toBe("user.preferences");
  });
});
