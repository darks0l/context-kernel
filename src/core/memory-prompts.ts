/**
 * Memory Extraction & Consolidation Prompts
 * Adapted from Claude Code's memory system.
 *
 * Two prompt types:
 * 1. extractMemoryPrompt — runs after each turn, extracts durable memories
 * 2. consolidationPrompt — runs periodically (dream cycle), organizes memories
 */

// ============================================================================
// Memory Extraction
// ============================================================================

/**
 * Build the prompt for automatic memory extraction from recent messages.
 *
 * @param messageCount - Approximate number of new messages to analyze
 * @param existingMemories - Formatted manifest of existing memory files
 * @param memoryDir - Path to the memory directory
 */
export function buildExtractMemoryPrompt(
  messageCount: number,
  existingMemories: string,
  memoryDir: string,
): string {
  const manifest = existingMemories.length > 0
    ? `\n\n## Existing memory files\n\n${existingMemories}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
    : "";

  return `You are the memory extraction subagent. Analyze the most recent ~${messageCount} messages and update persistent memory.

Available tools: Read, Grep, Glob, read-only Bash, and Edit/Write for paths inside ${memoryDir} only.

You MUST only use content from the last ~${messageCount} messages. Do not investigate or verify further.${manifest}

## What to save

**Preferences** — User preferences, coding style, tool configuration
**Project Knowledge** — Architecture decisions, file structure, naming conventions
**Interaction Patterns** — How the user works, common workflows, recurring requests
**Decisions & Rationale** — Technical decisions with reasoning, tradeoffs, rejected alternatives

## What NOT to save

- Transient information (current file contents, temporary state)
- Easily searchable information (docs, API references)
- Sensitive data (API keys, passwords, tokens, private keys)
- Obvious facts any model would know
- Raw conversation without synthesis
- Duplicates — always check existing memories first

## How to save

Write each memory to its own file with frontmatter:

\`\`\`markdown
---
type: preference | project_knowledge | interaction_pattern | decision
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Title

Content here...
\`\`\`

Then add a pointer in MEMORY.md: \`- [Title](file.md) — one-line hook\`
Keep MEMORY.md under 200 lines. It's an index, not a dump.`;
}

// ============================================================================
// Dream Consolidation
// ============================================================================

/**
 * Build the consolidation prompt for periodic memory review (dream cycle).
 *
 * @param memoryRoot - Path to the memory directory
 * @param transcriptDir - Path to session transcripts
 * @param extra - Additional context (session list, constraints)
 */
export function buildConsolidationPrompt(
  memoryRoot: string,
  transcriptDir: string,
  extra: string = "",
): string {
  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over your memory files. Synthesize recent learnings into durable, well-organized memories so future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
Session transcripts: \`${transcriptDir}\` (large files — grep narrowly, don't read whole files)

---

## Phase 1 — Orient

- \`ls\` the memory directory to see what exists
- Read \`MEMORY.md\` to understand the current index
- Skim existing topic files to improve rather than duplicate

## Phase 2 — Gather recent signal

Sources in priority order:
1. **Daily logs** if present — the append-only stream
2. **Existing memories that drifted** — facts contradicted by current codebase
3. **Transcript search** — grep narrowly for specific terms:
   \`grep -rn "<term>" ${transcriptDir}/ --include="*.jsonl" | tail -50\`

Don't exhaustively read transcripts. Look only for things you suspect matter.

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file. Focus on:
- Merging into existing topic files rather than near-duplicates
- Converting relative dates to absolute dates
- Deleting contradicted facts at the source

## Phase 4 — Prune and index

Update \`MEMORY.md\` — keep under 200 lines and ~25KB. It's an index:
\`- [Title](file.md) — one-line hook\` (each under ~150 chars)

- Remove stale/wrong/superseded pointers
- Shorten verbose entries — move detail to topic files
- Add pointers to newly important memories
- Resolve contradictions between files

---

Return a brief summary of what you consolidated, updated, or pruned.${extra ? `\n\n## Additional context\n\n${extra}` : ""}`;
}
