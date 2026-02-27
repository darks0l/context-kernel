import type { KernelInput } from "../../core/types.js";

export interface HttpEnvelope {
  id: string;
  at: string;
  payload: {
    messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }>;
    attachments?: Array<{ type: "image" | "audio" | "file"; name?: string }>;
    metadata?: Record<string, unknown>;
    estimatedTokens?: number;
  };
}

export function fromHttpEnvelope(env: HttpEnvelope): KernelInput {
  return {
    sessionId: env.id,
    timestamp: env.at,
    messages: env.payload.messages,
    attachments: env.payload.attachments,
    metadata: env.payload.metadata,
    estimatedTokens: env.payload.estimatedTokens
  };
}
