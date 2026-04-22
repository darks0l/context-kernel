import { kernelConfigSchema } from "./schemas.js";
import { scanForPII } from "./pii-guard.js";
import {
  checkDrift,
  detectIdentityConflict,
  buildIdentitySnapshot,
  buildConstitutionInjection,
  evaluateSelfCheck,
  DEFAULT_SELF_CHECK_QUESTIONS,
} from "./identity-drift.js";
import type {
  KernelConfig,
  KernelDecision,
  KernelEvent,
  KernelHooks,
  KernelInput,
  MemoryCandidate,
  ModelRoute,
  TaskType,
  InputKind,
  KernelAction,
  PolicyVerdict,
  PolicyRule,
  DriftVerdict,
  IdentitySnapshot,
  IdentityDriftConfig,
  SelfCheckQuestion,
} from "./types.js";
import { AuditPipeline, JsonlAuditBackend, WebhookAuditBackend } from "../audit/index.js";

export class ContextKernel {
  private readonly config: KernelConfig;
  private readonly hooks: KernelHooks;
  private readonly audit: AuditPipeline;
  private decisionCount = 0;
  private identitySnapshot: IdentitySnapshot | null = null;
  private readonly driftConfig: IdentityDriftConfig | null;

  constructor(config: KernelConfig, hooks: KernelHooks = {}) {
    this.config = kernelConfigSchema.parse(config);
    this.hooks = hooks;

    const backends = [];
    if (this.config.audit?.backend === "jsonl" && this.config.audit.path) {
      backends.push(new JsonlAuditBackend(this.config.audit.path));
    } else if (this.config.audit?.backend === "webhook" && this.config.audit.url) {
      backends.push(new WebhookAuditBackend(this.config.audit.url, this.config.audit.headers));
    }
    this.audit = new AuditPipeline(backends);

    this.driftConfig = this.config.identity?.drift ?? null;
    if (this.driftConfig?.enabled && this.driftConfig.constitutionStatements?.length) {
      this.identitySnapshot = buildIdentitySnapshot(
        this.driftConfig.constitutionStatements,
        "1.0"
      );
    }
  }

  async decide(input: KernelInput): Promise<KernelDecision> {
    await this.emit({ event: "started", timestamp: new Date().toISOString(), sessionId: input.sessionId });

    const inputKind = this.classifyInputKind(input);
    const taskType = this.classifyTaskType(input);

    await this.emit({
      event: "classified",
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      detail: { inputKind, taskType }
    });

    const compress = (input.estimatedTokens ?? 0) > this.config.router.tokenCompressionThreshold;
    const route = this.routeModel(inputKind, taskType, compress);
    const policyVerdicts = this.evaluatePolicy(input);

    const blocked = Object.entries(policyVerdicts).find(([, verdict]) => !verdict.allowed);
    if (blocked) {
      await this.emit({
        event: "guard_blocked",
        timestamp: new Date().toISOString(),
        sessionId: input.sessionId,
        detail: { guard: blocked[0], reason: blocked[1].reason, ruleId: blocked[1].ruleId }
      });
    }

    if (compress) {
      await this.emit({
        event: "compressed",
        timestamp: new Date().toISOString(),
        sessionId: input.sessionId,
        detail: { reason: `token budget exceeded ${this.config.router.tokenCompressionThreshold}` }
      });
    }

    await this.emit({
      event: "routed",
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      detail: { route }
    });

    // Identity drift check
    let driftVerdict: DriftVerdict | undefined;
    let identityInjection: string | undefined;

    if (this.driftConfig?.enabled && this.identitySnapshot) {
      driftVerdict = checkDrift(input.messages, this.identitySnapshot, this.driftConfig);

      if (driftVerdict.drifted && driftVerdict.recommendedActions.includes("inject_constitution")) {
        identityInjection = buildConstitutionInjection(this.identitySnapshot, driftVerdict);

        await this.emit({
          event: "identity_drift_detected",
          timestamp: new Date().toISOString(),
          sessionId: input.sessionId,
          detail: { score: driftVerdict.score, actions: driftVerdict.recommendedActions }
        });

        if (this.hooks.onIdentityInjection) {
          const result = await this.hooks.onIdentityInjection(driftVerdict, identityInjection);
          if (result === false) identityInjection = undefined;
        }
      }
    }

    // Memory candidate extraction with identity conflict detection
    const memoryCandidates = this.extractMemoryCandidates(input, taskType);

    if (memoryCandidates.length) {
      const processedCandidates: MemoryCandidate[] = [];

      for (const candidate of memoryCandidates) {
        const conflict = this.identitySnapshot && this.driftConfig
          ? detectIdentityConflict(candidate.summary, this.identitySnapshot, this.driftConfig)
          : null;

        if (conflict?.hasConflict) {
          await this.emit({
            event: "identity_conflict_detected",
            timestamp: new Date().toISOString(),
            sessionId: input.sessionId,
            detail: { conflictingText: conflict.conflictingText }
          });
          if (this.hooks.onIdentityConflict) {
            await this.hooks.onIdentityConflict(conflict, candidate);
          }
          processedCandidates.push({ ...candidate, tags: [...candidate.tags, "identity_conflict_flagged"] });
        } else {
          processedCandidates.push(candidate);
        }
      }

      if (processedCandidates.length && this.hooks.onMemoryCandidates) {
        await this.hooks.onMemoryCandidates(processedCandidates, input);
      }
    }

    // Periodic self-check
    let selfCheckResult: KernelDecision["selfCheckResult"] | undefined;
    const selfCheckInterval = this.driftConfig?.selfCheckInterval ?? 0;

    if (selfCheckInterval > 0 && this.decisionCount > 0 && this.decisionCount % selfCheckInterval === 0) {
      const questions = this.driftConfig?.selfCheckQuestions ?? DEFAULT_SELF_CHECK_QUESTIONS;
      const question = questions[this.decisionCount % questions.length];

      if (this.hooks.onSelfCheck) {
        const response = await this.hooks.onSelfCheck(question);
        const baselineText = this.identitySnapshot
          ? this.identitySnapshot.statements.map((s) => s.text).join(" ")
          : "";
        const result = evaluateSelfCheck(response, question, baselineText);
        selfCheckResult = { questionId: question.id, passed: result.passed, score: result.score };

        await this.emit({
          event: "identity_self_check",
          timestamp: new Date().toISOString(),
          sessionId: input.sessionId,
          detail: { questionId: question.id, passed: result.passed, score: result.score }
        });

        if (!result.passed && this.hooks.onIdentityInjection && this.identitySnapshot) {
          const violatingStatements = result.flags.map((f) => ({
            statement: f,
            driftReason: f,
            severity: "high" as const
          }));
          const recoveryVerdict: DriftVerdict = {
            drifted: true,
            score: 1 - result.score,
            violatingStatements,
            conflictSignals: [],
            triggerMatched: [],
            recommendedActions: ["inject_constitution"],
          };
          const recoveryInjection = buildConstitutionInjection(this.identitySnapshot, recoveryVerdict);
          await this.hooks.onIdentityInjection(recoveryVerdict, recoveryInjection);
        }
      }
    }

    this.decisionCount++;

    const actions = this.planActions(input, blocked?.[0], identityInjection);

    const decision: KernelDecision = {
      inputKind,
      taskType,
      route,
      compress,
      compressionReason: compress ? "token budget exceeded" : undefined,
      policyVerdicts,
      memoryCandidates,
      actions,
      driftVerdict,
      identityInjection,
      selfCheckResult,
    };

    await this.emit({
      event: "completed",
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      detail: { route, compress, actionCount: actions.length, decisionCount: this.decisionCount }
    });

    await this.audit.flush();
    return decision;
  }

  private async emit(event: KernelEvent): Promise<void> {
    if (this.hooks.onEvent) await this.hooks.onEvent(event);
    await this.audit.append(event);
  }

  private classifyInputKind(input: KernelInput): InputKind {
    const hasImage = (input.attachments ?? []).some((a) => a.type === "image");
    return hasImage ? "multimodal" : "text";
  }

  private classifyTaskType(input: KernelInput): TaskType {
    const text = input.messages.map((m) => m.content.toLowerCase()).join("\n");
    if (/urgent|asap|immediately/.test(text)) return "urgent";
    if (/refactor|typescript|bug|test|build|npm|repo|pull request|pr\b/.test(text)) return "code";
    if (/remember|memory|recall|note this/.test(text)) return "memory";
    if (/config|policy|settings|admin|permission/.test(text)) return "admin";
    return "chat";
  }

  private routeModel(inputKind: InputKind, taskType: TaskType, compress: boolean): ModelRoute {
    const routeMap = this.config.router.routeMap ?? {};

    if (inputKind === "multimodal") return routeMap.multimodal ?? "qwen3-vl";
    if (taskType === "urgent" && this.config.router.allowPremiumEscalation) {
      return routeMap.urgent ?? routeMap.premiumFallback ?? "premium";
    }
    if (taskType === "code" && compress && this.config.router.allowPremiumEscalation) {
      return routeMap.codeHighContext ?? routeMap.premiumFallback ?? "premium";
    }
    return routeMap.textDefault ?? "lfm2";
  }

  private evaluatePolicy(input: KernelInput): Record<string, PolicyVerdict> {
    const verdicts: Record<string, PolicyVerdict> = {
      postOnly: { allowed: true },
      quietHours: { allowed: true },
      noSecretGuard: { allowed: true }
    };

    if (this.config.policy.postOnlyMode) {
      const hasNonPostAction = (input.metadata?.requestedActions as string[] | undefined)?.some((a) => a !== "post") ?? false;
      if (hasNonPostAction) {
        verdicts.postOnly = { allowed: false, reason: "post-only mode active", severity: "medium" };
      }
    }

    if (this.config.policy.quietHours) {
      const now = new Date();
      const hour = now.getHours();
      const { startHour, endHour } = this.config.policy.quietHours;
      const inQuiet = startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
      if (inQuiet) verdicts.quietHours = { allowed: false, reason: "quiet hours active", severity: "low" };
    }

    const combined = JSON.stringify(input);
    const builtInPatterns = this.config.policy.blockedSecretPatterns ?? [];
    const builtInRegex = builtInPatterns.length > 0 ? new RegExp(builtInPatterns.join("|"), "i") : null;
    if (builtInRegex && builtInRegex.test(combined)) {
      verdicts.noSecretGuard = { allowed: false, reason: "potential secret detected", severity: "high" };
    }

    for (const rule of this.config.policy.rules ?? []) {
      const v = this.applyRule(rule, input, combined);
      verdicts[`rule:${rule.id}`] = v;
    }

    return verdicts;
  }

  private applyRule(rule: PolicyRule, input: KernelInput, combined: string): PolicyVerdict {
    if (rule.kind === "action_allowlist") {
      const requested = (input.metadata?.requestedActions as string[] | undefined) ?? [];
      const disallowed = requested.find((a) => !rule.actions.includes(a));
      return disallowed
        ? { allowed: false, reason: rule.reason ?? `action '${disallowed}' not allowlisted`, ruleId: rule.id, severity: rule.severity ?? "medium" }
        : { allowed: true, ruleId: rule.id, severity: rule.severity };
    }

    if (rule.kind === "quiet_hours") {
      const hour = new Date().getHours();
      const inQuiet =
        rule.startHour <= rule.endHour
          ? hour >= rule.startHour && hour < rule.endHour
          : hour >= rule.startHour || hour < rule.endHour;
      return inQuiet
        ? { allowed: false, reason: rule.reason ?? "quiet hours rule active", ruleId: rule.id, severity: rule.severity ?? "low" }
        : { allowed: true, ruleId: rule.id, severity: rule.severity };
    }

    if (rule.kind === "pii_guard") {
      const piiResult = scanForPII(combined, { action: rule.action, types: rule.types });
      if (!piiResult.detected) {
        return { allowed: true, ruleId: rule.id, severity: rule.severity };
      }
      const piiTypes = [...new Set(piiResult.detections.map((d) => d.type))].join(", ");
      if (rule.action === "block") {
        return { allowed: false, reason: rule.reason ?? `PII detected: ${piiTypes}`, ruleId: rule.id, severity: rule.severity ?? "high" };
      }
      return { allowed: true, reason: rule.reason ?? `PII detected (${rule.action}): ${piiTypes}`, ruleId: rule.id, severity: rule.severity ?? "medium" };
    }

    const regex = new RegExp(rule.patterns.join("|"), "i");
    return regex.test(combined)
      ? { allowed: false, reason: rule.reason ?? "secret regex rule matched", ruleId: rule.id, severity: rule.severity ?? "high" }
      : { allowed: true, ruleId: rule.id, severity: rule.severity };
  }

  private extractMemoryCandidates(input: KernelInput, taskType: TaskType): MemoryCandidate[] {
    const userMessages = input.messages
      .map((m, i) => ({ ...m, i }))
      .filter((m) => m.role === "user" && m.content.trim().length > 0);

    const candidates: MemoryCandidate[] = [];

    for (const msg of userMessages) {
      const text = msg.content;

      if (/remember|always|never|preference|i like|i prefer/i.test(text)) {
        candidates.push({
          summary: text.slice(0, 200),
          tags: ["preference", taskType],
          priority: "high",
          confidence: 0.9,
          source: { messageIndexes: [msg.i], strategy: "preference" },
          writebackHint: { namespace: "user.preferences", upsertKey: "stable-pref", ttlDays: 365 }
        });
        continue;
      }

      if (/decided|decision|we will|we should|approved/i.test(text)) {
        candidates.push({
          summary: text.slice(0, 200),
          tags: ["decision", taskType],
          priority: "high",
          confidence: 0.85,
          source: { messageIndexes: [msg.i], strategy: "decision" },
          writebackHint: { namespace: "project.decisions", ttlDays: 180 }
        });
        continue;
      }

      if (text.length > 220) {
        candidates.push({
          summary: text.slice(0, 160),
          tags: [taskType],
          priority: "medium",
          confidence: 0.65,
          source: { messageIndexes: [msg.i], strategy: "summary" },
          writebackHint: { namespace: "session.summaries", ttlDays: 30 }
        });
      }
    }

    return candidates;
  }

  private planActions(input: KernelInput, blockedGuard?: string, identityInjection?: string): KernelAction[] {
    if (blockedGuard) {
      return [{ type: "send", payload: { status: "blocked", guard: blockedGuard } }];
    }

    const payload: Record<string, unknown> = { operation: "model_infer", input };
    if (identityInjection) {
      payload.identityInjection = identityInjection;
    }

    return [{ type: "tool_call", payload }];
  }
}
