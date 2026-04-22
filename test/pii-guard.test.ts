import { describe, expect, it } from "vitest";
import { scanForPII, scanMessages } from "../src/core/pii-guard.js";
import { ContextKernel } from "../src/core/kernel.js";

describe("PII guard", () => {
  describe("scanForPII", () => {
    it("detects email addresses", () => {
      const result = scanForPII("Contact me at john@example.com please");
      expect(result.detected).toBe(true);
      expect(result.detections.length).toBe(1);
      expect(result.detections[0].type).toBe("email");
      expect(result.detections[0].match).toBe("john@example.com");
    });

    it("detects phone numbers", () => {
      const result = scanForPII("Call me at (555) 123-4567 anytime");
      expect(result.detected).toBe(true);
      expect(result.detections[0].type).toBe("phone");
    });

    it("detects SSNs", () => {
      const result = scanForPII("My SSN is 123-45-6789");
      expect(result.detected).toBe(true);
      expect(result.detections[0].type).toBe("ssn");
      expect(result.detections[0].match).toBe("123-45-6789");
    });

    it("detects multiple PII types in one string", () => {
      const result = scanForPII("Email: test@foo.com, SSN: 999-88-7777, Phone: 555-123-4567");
      expect(result.detected).toBe(true);
      expect(result.detections.length).toBe(3);
    });

    it("returns clean result when no PII found", () => {
      const result = scanForPII("This is a normal message with no personal data");
      expect(result.detected).toBe(false);
      expect(result.detections.length).toBe(0);
    });

    it("redacts PII when action is redact", () => {
      const result = scanForPII("Email me at john@example.com", { action: "redact" });
      expect(result.redactedText).toBe("Email me at [REDACTED]");
    });

    it("uses custom redaction text", () => {
      const result = scanForPII("SSN: 123-45-6789", {
        action: "redact",
        redactionText: "***"
      });
      expect(result.redactedText).toBe("SSN: ***");
    });

    it("filters by PII type", () => {
      const result = scanForPII("Email: a@b.com SSN: 111-22-3333", { types: ["ssn"] });
      expect(result.detections.length).toBe(1);
      expect(result.detections[0].type).toBe("ssn");
    });
  });

  describe("scanMessages", () => {
    it("scans across multiple messages", () => {
      const result = scanMessages([
        { role: "user", content: "My email is user@test.com" },
        { role: "user", content: "My SSN is 123-45-6789" }
      ]);

      expect(result.detected).toBe(true);
      expect(result.detections.length).toBe(2);
    });

    it("redacts across messages", () => {
      const result = scanMessages(
        [
          { role: "user", content: "Email: user@test.com" },
          { role: "user", content: "SSN: 111-22-3333" }
        ],
        { action: "redact" }
      );

      expect(result.redactedText).toContain("[REDACTED]");
      expect(result.redactedText).not.toContain("user@test.com");
      expect(result.redactedText).not.toContain("111-22-3333");
    });
  });

  describe("PII guard as kernel policy rule", () => {
    it("blocks request when pii_guard rule action is block", async () => {
      const kernel = new ContextKernel({
        router: { tokenCompressionThreshold: 10000, allowPremiumEscalation: true },
        policy: {
          postOnlyMode: false,
          blockedSecretPatterns: [],
          rules: [
            { id: "no-pii", kind: "pii_guard", action: "block", severity: "high" }
          ]
        }
      });

      const decision = await kernel.decide({
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        messages: [{ role: "user", content: "My email is test@example.com" }]
      });

      expect(decision.policyVerdicts["rule:no-pii"].allowed).toBe(false);
      expect(decision.policyVerdicts["rule:no-pii"].reason).toContain("PII detected");
    });

    it("allows request with warn when pii_guard action is warn", async () => {
      const kernel = new ContextKernel({
        router: { tokenCompressionThreshold: 10000, allowPremiumEscalation: true },
        policy: {
          postOnlyMode: false,
          blockedSecretPatterns: [],
          rules: [
            { id: "pii-warn", kind: "pii_guard", action: "warn" }
          ]
        }
      });

      const decision = await kernel.decide({
        sessionId: "s2",
        timestamp: new Date().toISOString(),
        messages: [{ role: "user", content: "Call me at 555-123-4567" }]
      });

      expect(decision.policyVerdicts["rule:pii-warn"].allowed).toBe(true);
      expect(decision.policyVerdicts["rule:pii-warn"].reason).toContain("PII detected");
    });

    it("passes cleanly when no PII in messages", async () => {
      const kernel = new ContextKernel({
        router: { tokenCompressionThreshold: 10000, allowPremiumEscalation: true },
        policy: {
          postOnlyMode: false,
          blockedSecretPatterns: [],
          rules: [
            { id: "pii-check", kind: "pii_guard", action: "block" }
          ]
        }
      });

      const decision = await kernel.decide({
        sessionId: "s3",
        timestamp: new Date().toISOString(),
        messages: [{ role: "user", content: "Hello, how are you?" }]
      });

      expect(decision.policyVerdicts["rule:pii-check"].allowed).toBe(true);
    });
  });
});
