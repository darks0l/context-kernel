import { describe, expect, it } from "vitest";
import {
  getCompactPrompt,
  formatCompactSummary,
  getEffectiveContextWindow,
  getAutoCompactThreshold,
  shouldAutoCompact,
  calculateTokenWarningState,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  AUTOCOMPACT_BUFFER_TOKENS,
  WARNING_THRESHOLD_BUFFER_TOKENS,
  MANUAL_COMPACT_BUFFER_TOKENS,
} from "../src/core/compaction.js";
import type { CompactionConfig } from "../src/core/compaction.js";

const standardConfig: CompactionConfig = {
  contextWindow: 100_000,
  maxOutputTokens: 20_000,
  autoCompactEnabled: true,
};

describe("getCompactPrompt", () => {
  it("returns a string containing the analysis and summary instruction markers", () => {
    const prompt = getCompactPrompt();
    // The prompt instructs the LLM to use <analysis> and <summary> tags
    expect(prompt).toContain("<analysis>");
    expect(prompt).toContain("<summary>");
    // The preamble tells the model to respond with these blocks
    expect(prompt).toContain("an <analysis> block");
    expect(prompt).toContain("<summary> block");
  });

  it("includes the no-tools preamble to prevent tool calls", () => {
    const prompt = getCompactPrompt();
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("TEXT ONLY");
    expect(prompt).toContain("Do NOT call any tools");
  });

  it("includes the 9-section compact prompt structure", () => {
    const prompt = getCompactPrompt();
    expect(prompt).toContain("Primary Request and Intent");
    expect(prompt).toContain("Key Technical Concepts");
    expect(prompt).toContain("Files and Code Sections");
    expect(prompt).toContain("Errors and fixes");
    expect(prompt).toContain("Pending Tasks");
    expect(prompt).toContain("Current Work");
    expect(prompt).toContain("Optional Next Step");
  });

  it("appends custom instructions when provided", () => {
    const custom = "Always use TypeScript. Never use `any`.";
    const prompt = getCompactPrompt(custom);
    expect(prompt).toContain("Always use TypeScript");
  });

  it("ignores empty or whitespace-only custom instructions", () => {
    const prompt = getCompactPrompt("   ");
    expect(prompt).not.toContain("Additional Instructions");
  });
});

describe("formatCompactSummary", () => {
  it("returns empty string for empty input", () => {
    expect(formatCompactSummary("")).toBe("");
    expect(formatCompactSummary("   ")).toBe("");
  });

  it("extracts content between <summary> tags", () => {
    const raw = `Some preceding text
<analysis>
Here are my thoughts...
</analysis>
<summary>
This is the actual summary content.
It has multiple lines.
</summary>
Some trailing text`;

    const result = formatCompactSummary(raw);
    expect(result).toContain("This is the actual summary content");
    expect(result).toContain("It has multiple lines");
    expect(result).not.toContain("Here are my thoughts");
  });

  it("strips <analysis> block even when no <summary> exists", () => {
    const raw = `<analysis>
Chain of thought goes here.
Lots of reasoning.
</analysis>
Just some regular text without summary tags.`;

    const result = formatCompactSummary(raw);
    expect(result).not.toContain("Chain of thought");
    expect(result).not.toContain("Lots of reasoning");
    expect(result).toContain("Just some regular text");
  });

  it("handles analysis with no summary gracefully", () => {
    const raw = `<analysis>only analysis</analysis>`;
    const result = formatCompactSummary(raw);
    expect(result).toBe("");
  });

  it("collapses multiple blank lines", () => {
    const raw = `<summary>

Line one


Line two



Line three

</summary>`;

    const result = formatCompactSummary(raw);
    // Should not contain triple+ newlines
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("handles case-insensitive summary tags", () => {
    const raw = `<SUMMARY>Brief summary</SUMMARY>`;
    const result = formatCompactSummary(raw);
    expect(result).toBe("Brief summary");
  });

  it("handles analysis with varying whitespace", () => {
    const raw = `
    <analysis>

        Mixed  whitespace

    </analysis>
    <summary>
      Trimmed content
    </summary>
    `;
    const result = formatCompactSummary(raw);
    expect(result).toContain("Trimmed content");
    expect(result).not.toContain("Mixed");
    expect(result).not.toContain("whitespace");
  });

  it("returns trimmed result", () => {
    const raw = `<summary>  leading and trailing whitespace  </summary>`;
    expect(formatCompactSummary(raw)).toBe("leading and trailing whitespace");
  });
});

describe("getEffectiveContextWindow", () => {
  it("subtracts maxOutputTokens from contextWindow", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 20_000 };
    expect(getEffectiveContextWindow(config)).toBe(80_000);
  });

  it("caps the reserve at MAX_OUTPUT_TOKENS_FOR_SUMMARY", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 30_000 };
    // Reserve is capped at 20_000, not 30_000
    expect(getEffectiveContextWindow(config)).toBe(80_000);
  });

  it("returns negative when context window is smaller than maxOutputTokens", () => {
    const config: CompactionConfig = { contextWindow: 5_000, maxOutputTokens: 20_000 };
    // Function allows negative result — callers are responsible for guarding
    expect(getEffectiveContextWindow(config)).toBe(-15_000);
  });
});

describe("getAutoCompactThreshold", () => {
  it("returns effective window minus AUTOCOMPACT_BUFFER_TOKENS", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 20_000 };
    // Effective = 80_000, buffer = 13_000
    expect(getAutoCompactThreshold(config)).toBe(67_000);
  });
});

describe("shouldAutoCompact", () => {
  it("returns true when token count is at or above auto-compact threshold", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: true };
    expect(shouldAutoCompact(67_000, config)).toBe(true);
    expect(shouldAutoCompact(70_000, config)).toBe(true);
  });

  it("returns false when token count is below threshold", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: true };
    expect(shouldAutoCompact(66_999, config)).toBe(false);
  });

  it("returns false when autoCompactEnabled is false", () => {
    const config: CompactionConfig = { contextWindow: 100_000, maxOutputTokens: 20_000, autoCompactEnabled: false };
    expect(shouldAutoCompact(100_000, config)).toBe(false);
  });
});

describe("calculateTokenWarningState", () => {
  it("returns isAboveAutoCompactThreshold true when tokens exceed threshold", () => {
    const state = calculateTokenWarningState(70_000, standardConfig);
    expect(state.isAboveAutoCompactThreshold).toBe(true);
  });

  it("returns isAboveAutoCompactThreshold false when tokens are below threshold", () => {
    const state = calculateTokenWarningState(60_000, standardConfig);
    expect(state.isAboveAutoCompactThreshold).toBe(false);
  });

  it("returns isAtBlockingLimit true near effective window limit", () => {
    // effective window = 80_000, blocking limit = 80_000 - 3_000 = 77_000
    const state = calculateTokenWarningState(78_000, standardConfig);
    expect(state.isAtBlockingLimit).toBe(true);
  });

  it("returns isAtBlockingLimit false when far from limit", () => {
    const state = calculateTokenWarningState(50_000, standardConfig);
    expect(state.isAtBlockingLimit).toBe(false);
  });

  it("returns isAboveWarningThreshold true when above warning buffer", () => {
    // threshold = 67_000, warning buffer = 47_000; 50_000 > 47_000 so true
    const state = calculateTokenWarningState(50_000, standardConfig);
    expect(state.isAboveWarningThreshold).toBe(true);
  });

  it("percentLeft decreases as token count increases", () => {
    const stateLow = calculateTokenWarningState(20_000, standardConfig);
    const stateHigh = calculateTokenWarningState(60_000, standardConfig);
    expect(stateLow.percentLeft).toBeGreaterThan(stateHigh.percentLeft);
  });

  it("percentLeft is capped at 0 for high token counts", () => {
    const state = calculateTokenWarningState(100_000, standardConfig);
    expect(state.percentLeft).toBeGreaterThanOrEqual(0);
  });
});

describe("constants are exported correctly", () => {
  it("MAX_OUTPUT_TOKENS_FOR_SUMMARY equals 20_000", () => {
    expect(MAX_OUTPUT_TOKENS_FOR_SUMMARY).toBe(20_000);
  });

  it("AUTOCOMPACT_BUFFER_TOKENS is a positive number", () => {
    expect(AUTOCOMPACT_BUFFER_TOKENS).toBeGreaterThan(0);
  });

  it("WARNING_THRESHOLD_BUFFER_TOKENS is a positive number", () => {
    expect(WARNING_THRESHOLD_BUFFER_TOKENS).toBeGreaterThan(0);
  });

  it("MANUAL_COMPACT_BUFFER_TOKENS is a positive number", () => {
    expect(MANUAL_COMPACT_BUFFER_TOKENS).toBeGreaterThan(0);
  });

  it("WARNING_THRESHOLD_BUFFER_TOKENS is greater than AUTOCOMPACT_BUFFER_TOKENS", () => {
    expect(WARNING_THRESHOLD_BUFFER_TOKENS).toBeGreaterThan(AUTOCOMPACT_BUFFER_TOKENS);
  });

  it("AUTOCOMPACT_BUFFER_TOKENS is greater than MANUAL_COMPACT_BUFFER_TOKENS", () => {
    expect(AUTOCOMPACT_BUFFER_TOKENS).toBeGreaterThan(MANUAL_COMPACT_BUFFER_TOKENS);
  });
});
