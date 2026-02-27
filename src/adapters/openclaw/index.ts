import type { KernelInput } from "../../core/types.js";

export interface OpenClawEnvelope {
  sessionKey: string;
  timestamp: string;
  messages: Array<{ role: string; content: string }>;
  images?: Array<{ name?: string }>;
  metadata?: Record<string, unknown>;
  estimatedTokens?: number;
}

export function fromOpenClawEnvelope(input: OpenClawEnvelope): KernelInput {
  return {
    sessionId: input.sessionKey,
    timestamp: input.timestamp,
    messages: input.messages.map((m) => ({
      role: normalizeRole(m.role),
      content: m.content
    })),
    attachments: (input.images ?? []).map((img) => ({ type: "image" as const, name: img.name })),
    metadata: input.metadata,
    estimatedTokens: input.estimatedTokens
  };
}

function normalizeRole(role: string): "system" | "user" | "assistant" | "tool" {
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}
