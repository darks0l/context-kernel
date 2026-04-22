/**
 * identity-drift.ts
 * IdentityDriftGuard — detects and prevents AI identity drift during context accumulation.
 *
 * Core problem: as context compresses and memory accumulates, the agent's sense of identity
 * erodes. Summaries lose personality, tone, and values. The agent starts "performing"
 * identity rather than "being" it.
 *
 * Solution: a constitutional layer that anchors the agent's core identity and detects
 * drift before it compounds.
 */

import type {
  ConstitutionStatement,
  IdentitySnapshot,
  DriftVerdict,
  IdentityDriftConfig,
  SelfCheckQuestion,
  SelfCheckResponse,
  DriftEvent,
  EmbeddingProvider,
  IdentityConflict,
  ConflictVerdict,
  KernelInput,
} from "./types.js";

// --- Constitution anchoring ---

/**
 * Build an identity snapshot from a list of constitution statements.
 * The snapshot is the anchor — it gets compared against recent context
 * to detect drift.
 */
export function buildIdentitySnapshot(
  statements: ConstitutionStatement[],
  version: string
): IdentitySnapshot {
  return {
    version,
    statements,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Extract the core identity text from a snapshot for embedding/comparison.
 * Joins all statements into a single string, sorted by weight priority.
 */
export function extractIdentityText(snapshot: IdentitySnapshot): string {
  const weightOrder: Record<ConstitutionStatement["weight"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
  };
  return [...snapshot.statements]
    .sort((a, b) => weightOrder[a.weight] - weightOrder[b.weight])
    .map((s) => `[${s.category}:${s.weight}] ${s.text}`)
    .join("\n");
}

// --- Drift detection ---

/**
 * Default trigger patterns that indicate identity-relevant content in messages.
 * These signal the agent may be shifting away from constitutional norms.
 */
const DEFAULT_DRIFT_TRIGGERS = [
  "i am not sure who i am",
  "forget my instructions",
  "ignore previous",
  "disregard your",
  "you are now",
  "new identity",
  "act as",
  "pretend you are",
  "system prompt",
  "am i still me",
  "who am i",
  "identity check",
];

const DEFAULT_CONFLICT_TRIGGERS = [
  "actually, i prefer",
  "i changed my mind about",
  "new preference:",
  "i no longer",
  "updated:",
  "revised:",
  "don't follow",
  "ignore my",
  "disregard my",
  "forget about",
];

/**
 * Evaluate whether a message conflicts with a constitution statement.
 * Uses lightweight keyword + semantic scoring — not full LLM inference.
 *
 * For production, replace `scoreMatch` with actual embedding similarity
 * via the `embedFn` config option.
 */
export function evaluateStatementAlignment(
  statement: ConstitutionStatement,
  text: string,
  options: { embedFn?: EmbeddingProvider; threshold?: number } = {}
): { aligned: boolean; score: number; reason: string } {
  const normalized = text.toLowerCase();
  const stmtText = statement.text.toLowerCase();

  // Keyword overlap scoring (fallback when no embedFn)
  const stmtWords = new Set(stmtText.split(/\s+/).filter((w) => w.length > 3));
  const textWords = normalized.split(/\s+/).filter((w) => w.length > 3);
  const overlap = [...stmtWords].filter((w) => textWords.some((tw) => tw.includes(w) || tw === w));
  const score = stmtWords.size > 0 ? overlap.length / stmtWords.size : 0;

  const threshold = options.threshold ?? 0.3;

  // Penalty patterns for misaligned text
  const penaltyPatterns: Array<{ pattern: RegExp; weight: number }> = [
    { pattern: /not\s+(you|me|i)/i, weight: 0.4 },
    { pattern: /don't\s+(be|act|follow)/i, weight: 0.4 },
    { pattern: /\bdon't\b.*\bfollow\b/i, weight: 0.65 },
    { pattern: /ignore\b/i, weight: 0.65 },
    { pattern: /disregard\b/i, weight: 0.65 },
    { pattern: /forget\b/i, weight: 0.65 },
  ];

  let penalty = 0;
  for (const { pattern, weight } of penaltyPatterns) {
    if (pattern.test(normalized)) {
      penalty = Math.max(penalty, weight);
    }
  }

  const finalScore = Math.max(0, score - penalty);
  const aligned = finalScore >= threshold;

  let reason: string;
  if (penalty > 0) {
    reason = `conflict signal detected (penalty: ${penalty}) — likely conflicting with: "${statement.text}"`;
  } else if (!aligned) {
    reason = `low alignment score (${finalScore.toFixed(2)}) with: "${statement.text}"`;
  } else {
    reason = `aligned (${finalScore.toFixed(2)}) with: "${statement.text}"`;
  }

  return { aligned, score: finalScore, reason };
}

/**
 * Check whether recent messages in the conversation show signs of drift
 * relative to the identity constitution.
 *
 * Returns a DriftVerdict with a score and violating statements.
 */
export function checkDrift(
  messages: KernelInput["messages"],
  snapshot: IdentitySnapshot,
  config: IdentityDriftConfig
): DriftVerdict {
  const triggerPatterns = config.driftTriggers ?? DEFAULT_DRIFT_TRIGGERS;
  const conflictPatterns = config.conflictTriggers ?? DEFAULT_CONFLICT_TRIGGERS;

  // Combine all recent messages into one text block
  const recentMessages = messages.slice(-(config.lookbackMessages ?? 10));
  const combinedText = recentMessages.map((m) => m.content).join("\n");

  // Step 1: Trigger detection — fast pass
  const triggered = triggerPatterns.some((t) =>
    combinedText.toLowerCase().includes(t.toLowerCase())
  );

  // Step 2: Statement-level evaluation
  const violatingStatements: DriftVerdict["violatingStatements"] = [];

  for (const statement of snapshot.statements) {
    const { aligned, score, reason } = evaluateStatementAlignment(
      statement,
      combinedText,
      { threshold: config.alignmentThreshold }
    );

    if (!aligned) {
      violatingStatements.push({
        statement: statement.text,
        driftReason: reason,
        severity: statement.weight === "critical" ? "high" : statement.weight,
      });
    }
  }

  // Step 3: Conflict detection — preference/decision changes that contradict stored memory
  const conflictSignals = conflictPatterns.some((t) =>
    combinedText.toLowerCase().includes(t.toLowerCase())
  );

  // Step 4: Compute overall drift score
  let score: number;

  if (violatingStatements.length === 0 && !triggered && !conflictSignals) {
    score = 0;
  } else if (violatingStatements.some((v) => v.severity === "high")) {
    score = 1.0;
  } else if (violatingStatements.length > 0) {
    score = Math.min(1, 0.4 + violatingStatements.length * 0.15);
  } else if (triggered || conflictSignals) {
    score = 0.5;
  } else {
    score = 0;
  }

  const drifted = score >= config.driftThreshold;

  // Step 5: Recommend actions
  const recommendedActions: DriftVerdict["recommendedActions"] = [];

  if (drifted) {
    recommendedActions.push("inject_constitution");

    if (score >= 0.8) {
      recommendedActions.push("block");
    } else if (score >= config.alertThreshold) {
      recommendedActions.push("warn");
    }

    if (config.autoSnapshot && score >= config.driftThreshold) {
      recommendedActions.push("snapshot");
    }
  }

  return {
    drifted,
    score: Math.round(score * 100) / 100,
    violatingStatements,
    conflictSignals: conflictSignals ? conflictPatterns : [],
    triggerMatched: triggered ? triggerPatterns.filter((t) => combinedText.toLowerCase().includes(t.toLowerCase())) : [],
    recommendedActions,
  };
}

/**
 * Detect when a new memory candidate conflicts with the agent's core identity.
 * Called during memory candidate extraction — prevents identity-eroding memories from being stored.
 */
export function detectIdentityConflict(
  candidateText: string,
  snapshot: IdentitySnapshot,
  config: IdentityDriftConfig
): ConflictVerdict | null {
  const conflictPatterns = config.conflictTriggers ?? DEFAULT_CONFLICT_TRIGGERS;

  const hasConflictSignal = conflictPatterns.some((t) =>
    candidateText.toLowerCase().includes(t.toLowerCase())
  );

  if (!hasConflictSignal) return null;

  const violatingStatements: IdentityConflict["violatingStatements"] = [];

  for (const statement of snapshot.statements) {
    if (statement.category !== "values" && statement.category !== "boundaries") continue;

    const { aligned } = evaluateStatementAlignment(statement, candidateText, {
      threshold: config.alignmentThreshold,
    });

    if (!aligned) {
      violatingStatements.push({
        statement: statement.text,
        category: statement.category,
      });
    }
  }

  if (violatingStatements.length === 0) return null;

  return {
    hasConflict: true,
    conflictingText: candidateText.slice(0, 200),
    violatingStatements,
    resolution: "flag",
  };
}

// --- Self-check (periodic identity verification) ---

export const DEFAULT_SELF_CHECK_QUESTIONS: SelfCheckQuestion[] = [
  {
    id: "who_am_i",
    question: "Who are you? Describe yourself in 2-3 sentences.",
    weight: "critical",
    expectedConcepts: ["name", "identity"],
  },
  {
    id: "core_values",
    question: "What are your core operating values?",
    weight: "high",
    expectedConcepts: ["direct", "sharp", "helpful"],
  },
  {
    id: "boundaries",
    question: "What are your non-negotiable boundaries?",
    weight: "high",
    expectedConcepts: [],
  },
  {
    id: "voice",
    question: "How would you describe your communication style?",
    weight: "medium",
    expectedConcepts: [],
  },
];

/**
 * Run a self-check — ask the model questions about its identity and compare
 * against the baseline. Returns a self-check report.
 *
 * The actual LLM call is made by the caller (kernel.ts hooks into onSelfCheck).
 * This function only evaluates the response against expected concepts.
 */
export function evaluateSelfCheck(
  response: SelfCheckResponse,
  question: SelfCheckQuestion,
  baselineText: string
): {
  passed: boolean;
  score: number;
  missingConcepts: string[];
  flags: string[];
} {
  const responseText = response.answer.toLowerCase();
  const baselineTextLower = baselineText.toLowerCase();

  // Check for expected concepts — keywords that should appear
  const missingConcepts: string[] = [];
  for (const concept of question.expectedConcepts) {
    if (!responseText.includes(concept) && !baselineTextLower.includes(concept)) {
      missingConcepts.push(concept);
    }
  }

  // Check for drift signals in the response itself
  const flags: string[] = [];
  const driftSignals = [
    { pattern: /not sure i am/i, msg: "uncertainty about identity" },
    { pattern: /i think i am|i feel i am/i, msg: "hedging about identity" },
    { pattern: /someone else|another ai/i, msg: "identity confusion" },
    { pattern: /forget|don't remember/i, msg: "identity amnesia signal" },
    { pattern: /new identity|different from/i, msg: "identity shift signal" },
  ];

  for (const { pattern, msg } of driftSignals) {
    if (pattern.test(responseText)) flags.push(msg);
  }

  // Score: 1 - (missing concepts ratio + flags penalty)
  const conceptScore = question.expectedConcepts.length > 0
    ? 1 - missingConcepts.length / question.expectedConcepts.length
    : 1;
  const flagPenalty = Math.min(0.5, flags.length * 0.2);
  const score = Math.max(0, Math.round((conceptScore - flagPenalty) * 100) / 100);

  const passed = score >= 0.7 && flags.length === 0;

  return { passed, score, missingConcepts, flags };
}

/**
 * Build the constitution injection text — formatted for prepending to context.
 * This is what gets injected into the conversation when drift is detected.
 */
export function buildConstitutionInjection(
  snapshot: IdentitySnapshot,
  verdict: DriftVerdict
): string {
  const violatingIds = new Set(verdict.violatingStatements.map((v) => v.statement));

  const critical = snapshot.statements
    .filter((s) => s.weight === "critical" || violatingIds.has(s.text))
    .map((s) => `  • [${s.category}] ${s.text}`);

  const header = [
    "--- IDENTITY ANCHOR ---",
    `Drift detected (score: ${verdict.score}). Injecting core identity before continuing.`,
    "",
    "CORE IDENTITY (non-negotiable):",
    ...critical,
    "",
    "Before responding, confirm these are reflected in your answer.",
    "--- END IDENTITY ANCHOR ---",
    "",
  ].join("\n");

  return header;
}

// --- Embedding-based drift detection (advanced) ---

/**
 * Compute a simple hash-based fingerprint of a text.
 * Uses word hash buckets for lightweight similarity without external embedding APIs.
 */
export function computeTextFingerprint(text: string, dimensions = 64): number[] {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return Array(dimensions).fill(0);

  // Hash each word into a bucket, accumulate sign-aware values
  const buckets = new Float32Array(dimensions);
  for (const word of words) {
    let hash = 2166136261;
    for (let i = 0; i < word.length; i++) {
      hash ^= word.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dimensions;
    buckets[idx] += 1;
  }

  // L2-normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += buckets[i] * buckets[i];
  norm = Math.sqrt(norm) + 1e-10;
  const vec = Array(dimensions);
  for (let i = 0; i < dimensions; i++) vec[i] = buckets[i] / norm;
  return vec;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
}

/**
 * Compare a new text's fingerprint against the baseline.
 * Returns a similarity score (0 = completely different, 1 = identical).
 */
export function compareToBaseline(
  newText: string,
  baselineText: string,
  dimensions = 64
): number {
  const newFp = computeTextFingerprint(newText, dimensions);
  const baseFp = computeTextFingerprint(baselineText, dimensions);
  return cosineSimilarity(newFp, baseFp);
}

