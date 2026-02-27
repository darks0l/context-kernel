import { kernelConfigSchema } from "./schemas.js";
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
  PolicyRule
} from "./types.js";

export class ContextKernel {
  private readonly config: KernelConfig;
  private readonly hooks: KernelHooks;

  constructor(config: KernelConfig, hooks: KernelHooks = {}) {
    this.config = kernelConfigSchema.parse(config);
    this.hooks = hooks;
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

    const memoryCandidates = this.extractMemoryCandidates(input, taskType);
    if (memoryCandidates.length && this.hooks.onMemoryCandidates) {
      await this.hooks.onMemoryCandidates(memoryCandidates, input);
    }

    const actions = this.planActions(input, blocked?.[0]);

    const decision: KernelDecision = {
      inputKind,
      taskType,
      route,
      compress,
      compressionReason: compress ? "token budget exceeded" : undefined,
      policyVerdicts,
      memoryCandidates,
      actions
    };

    await this.emit({
      event: "completed",
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      detail: { route, compress, actionCount: actions.length }
    });

    return decision;
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

  private planActions(input: KernelInput, blockedGuard?: string): KernelAction[] {
    if (blockedGuard) {
      return [
        {
          type: "send",
          payload: {
            status: "blocked",
            guard: blockedGuard
          }
        }
      ];
    }

    return [
      {
        type: "tool_call",
        payload: {
          operation: "model_infer",
          input
        }
      }
    ];
  }

  private async emit(event: KernelEvent): Promise<void> {
    if (this.hooks.onEvent) await this.hooks.onEvent(event);
  }
}
