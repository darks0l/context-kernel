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
}

export interface KernelEvent {
  event:
    | "started"
    | "classified"
    | "guard_blocked"
    | "routed"
    | "compressed"
    | "completed"
    | "failed";
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
}

// Re-export compaction types
export type { CompactionConfig, CompactionResult, TokenWarningState } from "./compaction.js";

// Re-export new module types
export type { ContextEntry, DeduplicationResult, DeduplicationConfig } from "./deduplication.js";
export type { ScoredEntry, PriorityScoringConfig, UsageRecord } from "./priority.js";
export type { EvictionPolicy, EvictionConfig, EvictionAccessRecord, EvictionResult } from "./eviction.js";
export type { ContextSnapshot, SnapshotStore } from "./snapshots.js";
export type { SharedMemoryPool, SharedMemoryRegistry, SharedEntry, PublishResult } from "./shared-memory.js";
export type { PIIAction, PIIType, PIIDetection, PIIGuardConfig, PIIGuardResult } from "./pii-guard.js";
export type { AuditEntry, AuditTrail, AuditQuery, AuditQueryResult } from "./audit-trail.js";
export type { BulkInsertResult, BulkDeleteResult, BulkQueryResult, ContextStore } from "./bulk.js";
