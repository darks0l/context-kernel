# context-kernel v0.7.0 roadmap

## Goal

Turn `context-kernel` from a promising internal-feeling toolkit into a sharper public package for agent infrastructure builders.

## Main problems to solve

### 1. Positioning is too broad
The package currently reads like it does everything in agent memory, routing, safety, and orchestration.
That makes it harder to understand the real value:

> a pre-generation decision layer for agent runtimes

### 2. Core kernel and utility suite are mixed together
The package has a solid kernel, but it also ships a growing set of standalone utilities.
That is useful, but the docs need to separate:

- **core decision engine**
- **optional context utilities**

### 3. Example quality needs tightening
A few metadata/docs issues make the package feel less maintained than it actually is.
Examples and package metadata should be trustworthy enough to copy-paste.

## Recommended v0.7.0 deliverables

### A. Product clarity
- rewrite README around the decision-layer thesis
- add a short "what it is / what it is not" section
- document 3-5 high-value use cases instead of listing every feature equally
- separate core API from optional utilities in docs

### B. API and DX improvements
- add a `createKernelPreset(...)` helper for common configurations
- add explicit route resolution examples using `modelRegistry`
- expose a cleaner typed result for blocked decisions
- add a first-class `decision.explain` or similar human-readable reasoning summary
- document stable hook contracts more clearly

### C. Memory and compaction polish
- document when to use `MemoryManager` directly vs via `ContextKernel`
- make auto-compaction behavior easier to reason about
- add snapshot lineage examples
- add one practical storage adapter example for local JSON or file-backed workflows

### D. Utility-suite organization
- either keep utilities in one package but group docs clearly,
  or prepare future split candidates such as:
  - `context-kernel/core`
  - `context-kernel/memory`
  - `context-kernel/utils`
- decide whether shared-memory/snapshots/bulk belong in the public top-level story or as advanced extras

### E. Quality gates
- fix package metadata issues
- validate every example JSON file in CI
- add README example smoke tests where practical
- ensure assets referenced by README and published files actually exist

## Specific issues found in this review

- README was doing too much at once and burying the real value proposition
- package metadata contained duplicate `keywords`
- published file list referenced `assets/darksol-banner.png`, but the repo assets present are `darksol-logo.png` and `darksol-logo.svg`
- example preset JSON files were malformed and not safe to copy-paste

## Suggested milestone checklist

### Must-have
- [ ] README repositioned
- [ ] example configs fixed and validated
- [ ] package metadata cleaned up
- [ ] release notes updated with the new thesis

### Strong next adds
- [ ] preset helper API
- [ ] better blocked-decision ergonomics
- [ ] one end-to-end OpenClaw integration example
- [ ] one end-to-end generic HTTP integration example

### Nice-to-have
- [ ] split advanced utilities into clearer subpaths
- [ ] benchmark or note expected overhead
- [ ] richer audit querying examples

## My recommendation

v0.7.0 should be a **clarity release**, not a feature-stuffing release.
The package already has real substance. The bigger win now is making it obvious:

- what the kernel actually owns
- what the host runtime still owns
- why an agent builder should adopt it
