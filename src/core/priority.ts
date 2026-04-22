/**
 * Context priority scoring engine.
 *
 * Ranks context entries by combining relevance (keyword overlap with query),
 * recency (time decay), and usage frequency into a single composite score.
 */

import type { ContextEntry } from "./deduplication.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ScoredEntry {
  entry: ContextEntry;
  score: number;
  breakdown: {
    relevance: number;
    recency: number;
    frequency: number;
  };
}

export interface PriorityScoringConfig {
  /** Weight for relevance score (keyword overlap). Default 0.5. */
  relevanceWeight?: number;
  /** Weight for recency score (time decay). Default 0.3. */
  recencyWeight?: number;
  /** Weight for usage frequency score. Default 0.2. */
  frequencyWeight?: number;
  /** Half-life in hours for recency decay. Default 24 (1 day). */
  recencyHalfLifeHours?: number;
  /** Reference time for recency calculation. Defaults to now. */
  referenceTime?: Date;
}

export interface UsageRecord {
  /** Context entry id. */
  entryId: string;
  /** Number of times this entry has been accessed/used. */
  accessCount: number;
  /** Timestamp of most recent access. */
  lastAccessed: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_RELEVANCE_WEIGHT = 0.5;
const DEFAULT_RECENCY_WEIGHT = 0.3;
const DEFAULT_FREQUENCY_WEIGHT = 0.2;
const DEFAULT_HALF_LIFE_HOURS = 24;

/* ------------------------------------------------------------------ */
/*  Internals                                                          */
/* ------------------------------------------------------------------ */

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

function computeRelevance(entryTokens: Set<string>, queryTokens: Set<string>): number {
  if (queryTokens.size === 0 || entryTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of queryTokens) {
    if (entryTokens.has(t)) overlap++;
  }
  return overlap / queryTokens.size;
}

function computeRecency(entryTimestamp: string, referenceTime: Date, halfLifeHours: number): number {
  const entryTime = new Date(entryTimestamp).getTime();
  const refTime = referenceTime.getTime();
  if (Number.isNaN(entryTime)) return 0;
  const ageHours = Math.max(0, (refTime - entryTime) / (1000 * 60 * 60));
  // Exponential decay: score = 0.5^(age / half_life)
  return Math.pow(0.5, ageHours / halfLifeHours);
}

function computeFrequency(accessCount: number, maxCount: number): number {
  if (maxCount === 0) return 0;
  // Log-normalized to prevent single high-frequency entry from dominating
  return Math.log(1 + accessCount) / Math.log(1 + maxCount);
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Score and rank context entries by relevance to a query, recency, and
 * usage frequency. Returns entries sorted by descending composite score.
 */
export function scoreEntries(
  entries: ContextEntry[],
  query: string,
  usageRecords: UsageRecord[] = [],
  config: PriorityScoringConfig = {}
): ScoredEntry[] {
  const wR = config.relevanceWeight ?? DEFAULT_RELEVANCE_WEIGHT;
  const wT = config.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const wF = config.frequencyWeight ?? DEFAULT_FREQUENCY_WEIGHT;
  const halfLife = config.recencyHalfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;
  const refTime = config.referenceTime ?? new Date();

  const queryTokens = tokenize(query);

  // Build usage lookup
  const usageMap = new Map<string, number>();
  let maxCount = 0;
  for (const rec of usageRecords) {
    usageMap.set(rec.entryId, rec.accessCount);
    if (rec.accessCount > maxCount) maxCount = rec.accessCount;
  }

  const scored: ScoredEntry[] = entries.map((entry) => {
    const entryTokens = tokenize(entry.content);
    const relevance = computeRelevance(entryTokens, queryTokens);
    const recency = computeRecency(entry.timestamp, refTime, halfLife);
    const frequency = computeFrequency(usageMap.get(entry.id) ?? 0, maxCount);

    const score = wR * relevance + wT * recency + wF * frequency;

    return {
      entry,
      score: Math.round(score * 1000) / 1000,
      breakdown: {
        relevance: Math.round(relevance * 1000) / 1000,
        recency: Math.round(recency * 1000) / 1000,
        frequency: Math.round(frequency * 1000) / 1000
      }
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Return the top-k highest scoring entries.
 */
export function topK(
  entries: ContextEntry[],
  query: string,
  k: number,
  usageRecords: UsageRecord[] = [],
  config: PriorityScoringConfig = {}
): ScoredEntry[] {
  return scoreEntries(entries, query, usageRecords, config).slice(0, k);
}
