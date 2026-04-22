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
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("pii_guard"),
    action: z.enum(["redact", "warn", "block"]),
    types: z.array(z.enum(["email", "phone", "ssn"])).optional(),
    severity: severitySchema.optional(),
    reason: z.string().optional()
  })
]);

const constitutionStatementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  weight: z.enum(["critical", "high", "medium"]),
  category: z.enum(["identity", "values", "voice", "boundaries", "rules"]),
  description: z.string().optional()
});

const identityDriftConfigSchema = z.object({
  enabled: z.boolean().default(false),
  driftThreshold: z.number().min(0).max(1).default(0.6),
  alertThreshold: z.number().min(0).max(1).default(0.4),
  lookbackMessages: z.number().int().positive().optional().default(10),
  alignmentThreshold: z.number().min(0).max(1).optional().default(0.3),
  driftTriggers: z.array(z.string()).optional(),
  conflictTriggers: z.array(z.string()).optional(),
  autoSnapshot: z.boolean().optional().default(false),
  selfCheckQuestions: z.array(z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    weight: z.enum(["critical", "high", "medium"]),
    expectedConcepts: z.array(z.string()).default([])
  })).optional(),
  selfCheckInterval: z.number().int().nonnegative().optional().default(0),
  constitutionStatements: z.array(constitutionStatementSchema).optional()
});

const memoryConfigSchema = z.object({
  maxWindowMessages: z.number().int().positive().default(500),
  keepLastMessages: z.number().int().positive().default(50),
  compactionIntervalDecisions: z.number().int().nonnegative().default(50),
  maxSnapshots: z.number().int().nonnegative().default(20),
  autoCompactBuffer: z.number().int().positive().optional(),
  // storage adapter is not schema-validated (interface only)
});

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
  }),
  identity: z.object({
    drift: identityDriftConfigSchema.optional()
  }).optional(),
  memory: memoryConfigSchema.optional()
});

export type KernelConfigSchema = z.infer<typeof kernelConfigSchema>;
