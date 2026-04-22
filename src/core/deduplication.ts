/**
 * Semantic deduplication engine for context entries.
 *
 * Uses cosine similarity on TF-IDF-style term vectors to detect near-duplicate
 * context entries and merge them. Zero external dependencies — all vector math
 * is done inline.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ContextEntry {
  id: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface DeduplicationResult {
  /** Entries that survived deduplication. */
  unique: ContextEntry[];
  /** Groups of entries that were merged together. */
  merged: Array<{
    /** The canonical entry kept from this group. */
    kept: ContextEntry;
    /** Entries that were merged into the kept entry. */
    duplicates: ContextEntry[];
    /** Similarity score that triggered the merge (0-1). */
    similarity: number;
  }>;
  /** Total entries removed. */
  removedCount: number;
}

export interface DeduplicationConfig {
  /** Cosine similarity threshold (0-1). Entries above this are considered duplicates. Default 0.85. */
  similarityThreshold?: number;
  /** Minimum token length for entries to be considered for dedup. Default 10. */
  minContentLength?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_MIN_CONTENT_LENGTH = 10;

/* ------------------------------------------------------------------ */
/*  Internal: tokenizer + TF-IDF vectors                               */
/* ------------------------------------------------------------------ */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildTermFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  const len = tokens.length || 1;
  for (const [term, count] of tf) {
    tf.set(term, count / len);
  }
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, valA] of a) {
    magA += valA * valA;
    const valB = b.get(term);
    if (valB !== undefined) dot += valA * valB;
  }
  for (const [, valB] of b) {
    magB += valB * valB;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Detect and merge near-duplicate context entries using cosine similarity
 * on term-frequency vectors.
 */
export function deduplicateEntries(
  entries: ContextEntry[],
  config: DeduplicationConfig = {}
): DeduplicationResult {
  const threshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minLen = config.minContentLength ?? DEFAULT_MIN_CONTENT_LENGTH;

  if (entries.length === 0) {
    return { unique: [], merged: [], removedCount: 0 };
  }

  // Pre-compute term vectors
  const vectors = entries.map((entry) => ({
    entry,
    tf: buildTermFrequency(tokenize(entry.content)),
    skip: entry.content.length < minLen
  }));

  const consumed = new Set<number>();
  const mergedGroups: DeduplicationResult["merged"] = [];
  const unique: ContextEntry[] = [];

  for (let i = 0; i < vectors.length; i++) {
    if (consumed.has(i)) continue;

    const vi = vectors[i];
    if (vi.skip) {
      unique.push(vi.entry);
      continue;
    }

    const duplicates: ContextEntry[] = [];
    let maxSim = 0;

    for (let j = i + 1; j < vectors.length; j++) {
      if (consumed.has(j) || vectors[j].skip) continue;

      const sim = cosineSimilarity(vi.tf, vectors[j].tf);
      if (sim >= threshold) {
        consumed.add(j);
        duplicates.push(vectors[j].entry);
        maxSim = Math.max(maxSim, sim);
      }
    }

    if (duplicates.length > 0) {
      mergedGroups.push({
        kept: vi.entry,
        duplicates,
        similarity: Math.round(maxSim * 1000) / 1000
      });
    } else {
      unique.push(vi.entry);
    }
  }

  // Kept entries from merged groups are also "unique survivors"
  const allSurvivors = [...unique, ...mergedGroups.map((g) => g.kept)];

  return {
    unique: allSurvivors,
    merged: mergedGroups,
    removedCount: entries.length - allSurvivors.length
  };
}

/**
 * Check if a single entry is a near-duplicate of any entry in a corpus.
 * Returns the best-matching entry and its similarity, or null.
 */
export function findDuplicate(
  candidate: ContextEntry,
  corpus: ContextEntry[],
  config: DeduplicationConfig = {}
): { match: ContextEntry; similarity: number } | null {
  const threshold = config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minLen = config.minContentLength ?? DEFAULT_MIN_CONTENT_LENGTH;

  if (candidate.content.length < minLen || corpus.length === 0) return null;

  const candidateTf = buildTermFrequency(tokenize(candidate.content));
  let bestMatch: ContextEntry | null = null;
  let bestSim = 0;

  for (const entry of corpus) {
    if (entry.content.length < minLen) continue;
    const entryTf = buildTermFrequency(tokenize(entry.content));
    const sim = cosineSimilarity(candidateTf, entryTf);
    if (sim >= threshold && sim > bestSim) {
      bestSim = sim;
      bestMatch = entry;
    }
  }

  return bestMatch ? { match: bestMatch, similarity: Math.round(bestSim * 1000) / 1000 } : null;
}
