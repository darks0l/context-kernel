# Changelog

## 0.4.0 - 2026-04-22

### Added -- Context Intelligence Suite
- **`deduplication.ts`** -- semantic deduplication engine using cosine similarity on TF-IDF term vectors. Detect and merge near-duplicate context entries with configurable similarity threshold. Includes `deduplicateEntries()` for batch dedup and `findDuplicate()` for single-entry checks.
- **`priority.ts`** -- context priority scoring engine. Ranks entries by composite score of relevance (keyword overlap), recency (exponential time decay), and usage frequency (log-normalized). Configurable weights and half-life. Includes `scoreEntries()` and `topK()`.
- **`eviction.ts`** -- automatic context eviction policies. LRU (least recently used), LFU (least frequently used), and TTL (time-to-live) eviction with a unified `evict()` dispatcher. Enforces bounded context stores.
- **`pii-guard.ts`** -- PII detection and auto-redaction policy guard. Detects emails, phone numbers, and SSNs with configurable actions: `redact`, `warn`, or `block`. Integrated into the kernel policy engine as `pii_guard` rule kind. Includes `scanForPII()` and `scanMessages()`.
- **`audit-trail.ts`** -- structured audit trail with query API. Collects `KernelEvent`s into a queryable ledger with sequential numbering, flexible filters (session, event type, time range), pagination, and JSONL export/import. Includes `createAuditHook()` for automatic kernel integration.
- **`shared-memory.ts`** -- cross-session context sharing via named memory pools. Publish/subscribe model for multi-agent coordination with membership tracking, pool capacity limits, and entry isolation. Includes `createSharedMemoryRegistry()`, `publish()`, `subscribe()`, `readPool()`.
- **`snapshots.ts`** -- context snapshots for session replay. Save and restore full context state (entries + usage records) with deep-copy isolation, session-scoped listing, and JSON export/import.
- **`bulk.ts`** -- bulk operations for context stores. Batch insert, upsert, delete, get, and query with per-item success/failure tracking, pagination, and predicate-based filtering.
- Added `pii_guard` policy rule kind to kernel policy engine and Zod schema.
- Re-exported all new modules and types from `src/core/index.ts` and `src/core/types.ts`.

## 0.2.0 - 2026-04-01

### Added -- Context Compaction Engine + Memory Prompts
- **`compaction.ts`** -- full context compaction engine adapted from Claude Code's battle-tested system. Includes 9-section structured compact prompt, auto-compact threshold calculations (`shouldAutoCompact`, `calculateTokenWarningState`), summary formatting (`formatCompactSummary` strips analysis scratchpad, extracts `<summary>` block), and effective context window math. Constants: `MAX_OUTPUT_TOKENS_FOR_SUMMARY` (20k), `AUTOCOMPACT_BUFFER_TOKENS` (13k), `WARNING_THRESHOLD_BUFFER_TOKENS` (20k), `MANUAL_COMPACT_BUFFER_TOKENS` (3k).
- **`memory-prompts.ts`** -- memory extraction and consolidation prompt builders. `buildExtractMemoryPrompt` generates a per-turn memory extraction instruction with manifest of existing files to avoid duplicates. Consolidation prompt builder for dream-cycle periodic memory organization.
- Re-exported both modules from `src/core/index.ts`.

## 0.1.1
- feat: validate `KernelInput` with Zod schema (rejects empty sessionId, empty messages, invalid roles, negative token counts)
- fix: emit `"failed"` audit event before re-throwing when `decide()` encounters an error (the event type was defined but never used)
- test: add 4 new tests covering input validation and failed-event emission
- docs: retrofit README to SHIP_STANDARD format with validated quickstart and configuration table
- chore: add MIT LICENSE file
- chore: add repository metadata fields (`homepage`, `bugs`, `repository`) to package.json

## 0.1.0
- Initial Context Kernel MVP
- Core routing + token budget compression trigger
- Policy guards (post-only, quiet-hours, secret guard)
- Policy DSL rules (`action_allowlist`, `quiet_hours`, `secret_regex`)
- Memory candidate extraction contract with confidence/source/writeback hints
- OpenClaw + generic HTTP adapters
- CLI runner
- Test suite + CI/release workflows
