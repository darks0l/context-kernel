import { z } from "zod";

const severitySchema = z.enum(["low", "medium", "high"]);

const policyRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("action_allowlist"),
    actions: z.array(z.string()).min(1),
    severity: severitySchema.optional(),
    reason: z.string().optional()
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("quiet_hours"),
    startHour: z.number().min(0).max(23),
    endHour: z.number().min(0).max(23),
    timezone: z.string().optional(),
    severity: severitySchema.optional(),
    reason: z.string().optional()
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("secret_regex"),
    patterns: z.array(z.string()).min(1),
    severity: severitySchema.optional(),
    reason: z.string().optional()
  })
]);

export const kernelConfigSchema = z.object({
  router: z.object({
    tokenCompressionThreshold: z.number().int().positive().default(10000),
    allowPremiumEscalation: z.boolean().default(true),
    modelRegistry: z.record(z.object({ provider: z.string().optional(), model: z.string().min(1) })).optional(),
    routeMap: z
      .object({
        textDefault: z.string().optional(),
        multimodal: z.string().optional(),
        urgent: z.string().optional(),
        codeHighContext: z.string().optional(),
        premiumFallback: z.string().optional()
      })
      .optional()
  }),
  policy: z.object({
    postOnlyMode: z.boolean().default(false),
    quietHours: z
      .object({
        startHour: z.number().min(0).max(23),
        endHour: z.number().min(0).max(23),
        timezone: z.string().optional()
      })
      .optional(),
    blockedSecretPatterns: z.array(z.string()).default([
      "api[_-]?key",
      "password",
      "token",
      "secret",
      "AKIA[0-9A-Z]{16}"
    ]),
    rules: z.array(policyRuleSchema).default([])
  })
});

export type KernelConfigSchema = z.infer<typeof kernelConfigSchema>;
