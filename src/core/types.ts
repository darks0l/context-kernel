export type TaskType = "chat" | "code" | "memory" | "admin" | "urgent";
export type InputKind = "text" | "multimodal";

export type ModelRoute = string;

export interface KernelInput {
  sessionId: string;
  timestamp: string;
  messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
  attachments?: Array<{ type: "image" | "audio" | "file"; name?: string }>;
  metadata?: Record<string, unknown>;
  estimatedTokens?: number;
}

export interface MemoryCandidate {
  summary: string;
  tags: string[];
  priority: "low" | "medium" | "high";
  confidence: number;
  source: {
    messageIndexes: number[];
    strategy: "preference" | "decision" | "fact" | "summary";
  };
  writebackHint?: {
    namespace: string;
    upsertKey?: string;
    ttlDays?: number;
  };
}

export interface KernelAction {
  type: "send" | "post" | "tool_call" | "store_memory";
  target?: string;
  payload: Record<string, unknown>;
}

export interface PolicyVerdict {
  allowed: boolean;
  reason?: string;
  ruleId?: string;
  severity?: "low" | "medium" | "high";
}

export interface KernelDecision {
  inputKind: InputKind;
  taskType: TaskType;
  route: ModelRoute;
  compress: boolean;
  compressionReason?: string;
  policyVerdicts: Record<string, PolicyVerdict>;
  memoryCandidates: MemoryCandidate[];
  actions: KernelAction[];
  driftVerdict?: DriftVerdict;
  identityInjection?: string;
  selfCheckResult?: {
    questionId: string;
    passed: boolean;
    score: number;
  };
  memorySnapshot?: {
    version: string;
    summary: string;
    driftScore?: number;
    memoryEntryCount: number;
  };
}

export interface KernelEvent {
  event:
    | "started"
    | "classified"
    | "guard_blocked"
    | "routed"
    | "compressed"
    | "completed"
    | "failed"
    | "identity_drift_detected"
    | "identity_drift_corrected"
    | "identity_self_check"
    | "identity_conflict_detected"
    | "identity_injected"
    | "memory_compacted"
    | "memory_compaction_failed";
  timestamp: string;
  sessionId: string;
  detail?: Record<string, unknown>;
}

export interface RouterConfig {
  tokenCompressionThreshold: number;
  allowPremiumEscalation: boolean;
  modelRegistry?: Record<string, { provider?: string; model: string }>;
  routeMap?: {
    textDefault?: string;
    multimodal?: string;
    urgent?: string;
    codeHighContext?: string;
    premiumFallback?: string;
  };
}

export type PolicyRule =
  | {
      id: string;
      kind: "action_allowlist";
      actions: string[];
      severity?: "low" | "medium" | "high";
      reason?: string;
    }
  | {
      id: string;
      kind: "quiet_hours";
      startHour: number;
      endHour: number;
      timezone?: string;
      severity?: "low" | "medium" | "high";
      reason?: string;
    }
  | {
      id: string;
      kind: "secret_regex";
      patterns: string[];
      severity?: "low" | "medium" | "high";
      reason?: string;
    }
  | {
      id: string;
      kind: "pii_guard";
      action: "redact" | "warn" | "block";
      types?: Array<"email" | "phone" | "ssn">;
      severity?: "low" | "medium" | "high";
      reason?: string;
    };

export interface PolicyConfig {
  postOnlyMode: boolean;
  quietHours?: { startHour: number; endHour: number; timezone?: string };
  blockedSecretPatterns?: string[];
  rules?: PolicyRule[];
}

export interface KernelConfig {
  router: RouterConfig;
  policy: PolicyConfig;
  audit?: AuditConfig;
  identity?: {
    drift?: IdentityDriftConfig;
  };
  memory?: MemoryConfig;
}

export interface KernelStorageAdapter {
  saveSnapshot(snapshot: MemorySnapshot): Promise<void>;
  loadSnapshot(version: string): Promise<MemorySnapshot | null>;
  listSnapshots(): Promise<Array<{ version: string; createdAt: string; tokenCount: number }>>;
  deleteSnapshot(version: string): Promise<void>;
  saveMemoryCandidates(candidates: MemoryCandidate[]): Promise<void>;
  loadMemoryCandidates(): Promise<MemoryCandidate[]>;
}

export interface MemoryConfig {
  maxWindowMessages?: number;
  keepLastMessages?: number;
  compactionIntervalDecisions?: number;
  maxSnapshots?: number;
  autoCompactBuffer?: number;
  storage?: KernelStorageAdapter;
}

export interface MemorySnapshot {
  version: string;
  parent: string | null;
  summary: string;
  memoryEntries: MemoryCandidate[];
  createdAt: string;
  driftScore?: number;
  tokenCount: number;
  messagesCompacted: number;
  driftVerdict?: DriftVerdict;
}

export interface MemoryDiff {
  from: string;
  to: string;
  added: MemoryCandidate[];
  removed: string[];
  modified: Array<{ id: string; delta: string }>;
  driftDetected: boolean;
  tokensSaved: number;
}

export interface AuditConfig {
  backend: "jsonl" | "webhook";
  path?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface KernelHooks {
  onEvent?: (event: KernelEvent) => void | Promise<void>;
  onMemoryCandidates?: (candidates: MemoryCandidate[], input: KernelInput) => void | Promise<void>;
  /**
   * Called when drift is detected and constitution is about to be injected.
   * Receives the drift verdict and the injection text. Return false to skip injection.
   */
  onIdentityInjection?: (verdict: DriftVerdict, injectionText: string) => void | Promise<void> | boolean;
  /**
   * Called when a memory candidate conflicts with the agent's identity constitution.
   */
  onIdentityConflict?: (conflict: ConflictVerdict, candidate: MemoryCandidate) => void | Promise<void>;
  /**
   * Called when self-check is triggered. Should return the model's answer to the question.
   */
  onSelfCheck?: (question: SelfCheckQuestion) => Promise<SelfCheckResponse>;
  /**
   * Called during compaction to get a summary from the LLM.
   * The harness provides the actual LLM call here.
   * If not provided, a simple truncation fallback is used.
   */
  onSummarize?: (messages: Array<{ role: string; content: string }>, prompt: string) => Promise<string>;
  /**
   * Called after a new memory snapshot is produced.
   */
  onMemorySnapshot?: (snapshot: MemorySnapshot) => void | Promise<void>;
}


// Re-export new module types
export type { ContextEntry, DeduplicationResult, DeduplicationConfig } from "./deduplication.js";
export type { ScoredEntry, PriorityScoringConfig, UsageRecord } from "./priority.js";
export type { EvictionPolicy, EvictionConfig, EvictionAccessRecord, EvictionResult } from "./eviction.js";
export type { ContextSnapshot, SnapshotStore } from "./snapshots.js";
export type { SharedMemoryPool, SharedMemoryRegistry, SharedEntry, PublishResult } from "./shared-memory.js";
export type { PIIAction, PIIType, PIIDetection, PIIGuardConfig, PIIGuardResult } from "./pii-guard.js";
export type { AuditEntry, AuditTrail, AuditQuery, AuditQueryResult } from "./audit-trail.js";

// --- Identity Drift Guard types ---

export type ConstitutionWeight = "critical" | "high" | "medium";

export interface ConstitutionStatement {
  id: string;
  text: string;
  weight: ConstitutionWeight;
  category: "identity" | "values" | "voice" | "boundaries" | "rules";
  description?: string;
}

export interface IdentitySnapshot {
  version: string;
  statements: ConstitutionStatement[];
  createdAt: string;
}

export interface DriftVerdict {
  drifted: boolean;
  score: number; // 0 = aligned, 1 = fully drifted
  violatingStatements: Array<{
    statement: string;
    driftReason: string;
    severity: "low" | "medium" | "high";
  }>;
  conflictSignals: string[];
  triggerMatched: string[];
  recommendedActions: Array<"inject_constitution" | "warn" | "block" | "snapshot" | "alert">;
}

export interface SelfCheckQuestion {
  id: string;
  question: string;
  weight: ConstitutionWeight;
  expectedConcepts: string[];
}

export interface SelfCheckResponse {
  questionId: string;
  answer: string;
  timestamp: string;
}

export type EmbeddingProvider = (text: string) => Promise<number[]>;

export interface IdentityConflict {
  hasConflict: boolean;
  conflictingText: string;
  violatingStatements: Array<{
    statement: string;
    category: ConstitutionStatement["category"];
  }>;
  resolution: "flag" | "block" | "merge" | "reject";
}

export interface ConflictVerdict {
  hasConflict: boolean;
  conflictingText: string;
  violatingStatements: Array<{
    statement: string;
    category: ConstitutionStatement["category"];
  }>;
  resolution: "flag" | "block" | "merge" | "reject";
}

export interface DriftEvent {
  event: "identity_drift_detected" | "identity_drift_corrected" | "identity_self_check" | "identity_conflict_detected";
  timestamp: string;
  sessionId: string;
  verdict?: DriftVerdict;
  conflict?: IdentityConflict;
  selfCheckResult?: {
    questionId: string;
    passed: boolean;
    score: number;
  };
}

export interface IdentityDriftConfig {
  /** Enable identity drift detection */
  enabled: boolean;
  /** Drift score threshold (0-1) to trigger constitution injection */
  driftThreshold: number;
  /** Score at which to alert (but not block) */
  alertThreshold: number;
  /** How far back in messages to look */
  lookbackMessages?: number;
  /** Minimum alignment score (0-1) to consider a statement aligned */
  alignmentThreshold?: number;
  /** Trigger patterns that fast-pass trigger drift check */
  driftTriggers?: string[];
  /** Patterns that suggest memory/identity conflicts */
  conflictTriggers?: string[];
  /** Take a snapshot when drift is corrected */
  autoSnapshot?: boolean;
  /** Custom self-check questions */
  selfCheckQuestions?: SelfCheckQuestion[];
  /** Self-check interval in decisions (0 = disabled) */
  selfCheckInterval?: number;
  /** Core identity statements for drift detection */
  constitutionStatements?: ConstitutionStatement[];
}

// Re-export compaction types
export type { CompactionConfig, CompactionResult, TokenWarningState } from "./compaction.js";
export type { BulkInsertResult, BulkDeleteResult, BulkQueryResult, ContextStore } from "./bulk.js";
