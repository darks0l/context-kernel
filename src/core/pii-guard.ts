/**
 * PII detection policy guard.
 *
 * Detects emails, phone numbers, and SSNs in message content with
 * configurable actions: redact (mask the PII), warn (flag but allow),
 * or block (reject the request).
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type PIIAction = "redact" | "warn" | "block";

export type PIIType = "email" | "phone" | "ssn";

export interface PIIDetection {
  type: PIIType;
  match: string;
  /** Start index in the original text. */
  index: number;
}

export interface PIIGuardConfig {
  /** Action to take when PII is detected. Default "warn". */
  action?: PIIAction;
  /** Which PII types to scan for. Default all. */
  types?: PIIType[];
  /** Custom redaction string. Default "[REDACTED]". */
  redactionText?: string;
}

export interface PIIGuardResult {
  /** Whether PII was detected. */
  detected: boolean;
  /** What was found. */
  detections: PIIDetection[];
  /** Action that was (or should be) taken. */
  action: PIIAction;
  /** Redacted text (only populated when action is "redact"). */
  redactedText?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_ACTION: PIIAction = "warn";
const DEFAULT_REDACTION = "[REDACTED]";
const ALL_PII_TYPES: PIIType[] = ["email", "phone", "ssn"];

/**
 * Patterns are intentionally practical (not exhaustive RFC-compliant)
 * to minimize false positives while catching common real-world PII.
 */
const PII_PATTERNS: Record<PIIType, RegExp> = {
  // Standard email pattern
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // US phone numbers: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, +1xxxxxxxxxx
  phone: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}/g,
  // US SSN: xxx-xx-xxxx (with dashes required to reduce false positives)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g
};

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function detectPII(text: string, types: PIIType[]): PIIDetection[] {
  const detections: PIIDetection[] = [];

  for (const type of types) {
    const regex = new RegExp(PII_PATTERNS[type].source, PII_PATTERNS[type].flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      detections.push({ type, match: m[0], index: m.index });
    }
  }

  // Sort by position in text
  detections.sort((a, b) => a.index - b.index);
  return detections;
}

function redactText(text: string, detections: PIIDetection[], replacement: string): string {
  if (detections.length === 0) return text;

  // Work backwards to preserve indices
  let result = text;
  const sorted = [...detections].sort((a, b) => b.index - a.index);
  for (const det of sorted) {
    result = result.slice(0, det.index) + replacement + result.slice(det.index + det.match.length);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Scan text for PII and return detections with the configured action.
 */
export function scanForPII(text: string, config: PIIGuardConfig = {}): PIIGuardResult {
  const action = config.action ?? DEFAULT_ACTION;
  const types = config.types ?? ALL_PII_TYPES;
  const redactionText = config.redactionText ?? DEFAULT_REDACTION;

  const detections = detectPII(text, types);
  const detected = detections.length > 0;

  const result: PIIGuardResult = { detected, detections, action };

  if (detected && action === "redact") {
    result.redactedText = redactText(text, detections, redactionText);
  }

  return result;
}

/**
 * Scan all messages in a kernel input for PII. Returns a combined result
 * across all message contents.
 */
export function scanMessages(
  messages: Array<{ role: string; content: string }>,
  config: PIIGuardConfig = {}
): PIIGuardResult {
  const action = config.action ?? DEFAULT_ACTION;
  const types = config.types ?? ALL_PII_TYPES;
  const redactionText = config.redactionText ?? DEFAULT_REDACTION;

  const allDetections: PIIDetection[] = [];
  const redactedParts: string[] = [];

  for (const msg of messages) {
    const detections = detectPII(msg.content, types);
    allDetections.push(...detections);
    if (action === "redact") {
      redactedParts.push(redactText(msg.content, detections, redactionText));
    }
  }

  const detected = allDetections.length > 0;
  const result: PIIGuardResult = { detected, detections: allDetections, action };

  if (detected && action === "redact") {
    result.redactedText = redactedParts.join("\n");
  }

  return result;
}
