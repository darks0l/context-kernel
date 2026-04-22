/**
 * Context Compaction Engine
 * Adapted from Claude Code's battle-tested compaction system.
 *
 * Provides structured prompts for summarizing conversations,
 * auto-compact threshold calculations, and summary formatting.
 */

// ============================================================================
// Constants
// ============================================================================

/** Reserve for LLM output during compaction (p99.99 = 17,387 tokens) */
export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000;

/** Buffer below effective context window that triggers auto-compact */
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** Buffer for "getting close" warning */
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000;

/** Buffer for blocking limit (manual compact needed) */
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000;

/** Stop trying after N consecutive failures */
export const MAX_CONSECUTIVE_FAILURES = 3;

// ============================================================================
// Types
// ============================================================================

export interface CompactionConfig {
  contextWindow: number;
  maxOutputTokens: number;
  customInstructions?: string;
  autoCompactEnabled?: boolean;
}

export interface CompactionResult {
  summary: string;
  tokensFreed: number;
  method: "full" | "partial";
}

export interface TokenWarningState {
  percentLeft: number;
  isAboveWarningThreshold: boolean;
  isAboveAutoCompactThreshold: boolean;
  isAtBlockingLimit: boolean;
}

// ============================================================================
// Analysis Template
// ============================================================================

const ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`;

// ============================================================================
// 9-Section Compact Prompt
// ============================================================================

const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

${ANALYSIS_INSTRUCTION}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. Critical for understanding changing intent.
7. Pending Tasks: Outline any pending tasks explicitly asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.
9. Optional Next Step: List the next step directly in line with the user's most recent explicit requests. Include direct quotes showing exactly what task you were working on.

Respond with an <analysis> block followed by a <summary> block.`;

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.
Your entire response must be plain text: an <analysis> block followed by a <summary> block.\n\n`;

const NO_TOOLS_TRAILER = `\n\nREMINDER: Do NOT call any tools. Respond with plain text only.`;

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build the full compaction prompt with optional custom instructions.
 */
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT;
  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`;
  }
  prompt += NO_TOOLS_TRAILER;
  return prompt;
}

// ============================================================================
// Summary Formatting
// ============================================================================

/**
 * Format a raw compaction response:
 * 1. Strip the <analysis> scratchpad (improves quality but not needed in output)
 * 2. Extract <summary> content
 * 3. Clean up whitespace
 */
export function formatCompactSummary(raw: string): string {
  if (!raw) return "";
  let result = raw;

  // Strip analysis (chain-of-thought scratchpad)
  result = result.replace(/<analysis>[\s\S]*?<\/analysis>/i, "");

  // Extract summary content
  const match = result.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (match) {
    result = match[1].trim();
  }

  result = result.replace(/\n\n+/g, "\n\n").trim();
  return result;
}

// ============================================================================
// Auto-Compact Thresholds
// ============================================================================

/**
 * Get the effective usable context window (total minus output reserve).
 */
export function getEffectiveContextWindow(config: CompactionConfig): number {
  const reserved = Math.min(config.maxOutputTokens, MAX_OUTPUT_TOKENS_FOR_SUMMARY);
  return config.contextWindow - reserved;
}

/**
 * Get the token threshold that triggers auto-compaction.
 */
export function getAutoCompactThreshold(config: CompactionConfig): number {
  return getEffectiveContextWindow(config) - AUTOCOMPACT_BUFFER_TOKENS;
}

/**
 * Check if auto-compaction should trigger.
 */
export function shouldAutoCompact(
  tokenCount: number,
  config: CompactionConfig,
): boolean {
  if (config.autoCompactEnabled === false) return false;
  return tokenCount >= getAutoCompactThreshold(config);
}

/**
 * Calculate comprehensive token warning state.
 */
export function calculateTokenWarningState(
  tokenCount: number,
  config: CompactionConfig,
): TokenWarningState {
  const threshold = getAutoCompactThreshold(config);
  const effectiveWindow = getEffectiveContextWindow(config);

  const percentLeft = Math.max(0, Math.round(((threshold - tokenCount) / threshold) * 100));
  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS;
  const blockingLimit = effectiveWindow - MANUAL_COMPACT_BUFFER_TOKENS;

  return {
    percentLeft,
    isAboveWarningThreshold: tokenCount >= warningThreshold,
    isAboveAutoCompactThreshold: tokenCount >= threshold,
    isAtBlockingLimit: tokenCount >= blockingLimit,
  };
}
