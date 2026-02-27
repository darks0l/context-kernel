# context-kernel (v0.1.0)

Platform-agnostic Context Kernel for agent runtimes.

## What it does

- Classifies input (`text` vs `multimodal`, task type)
- Enforces token budget threshold and compression trigger (>10k by default)
- Routes model choice via configurable route map + model registry
- Applies policy guards (post-only, quiet-hours, no-secret guard)
- Supports rule-based policy DSL (allowlist, quiet-hours, secret regex)
- Extracts memory candidates with confidence/source/writeback hints
- Emits deterministic audit events
- Supports OpenClaw + generic HTTP envelope adapters

## Install

```bash
npm install context-kernel
```

## Quick start (library)

```ts
import { ContextKernel } from "context-kernel";

const kernel = new ContextKernel({
  router: {
    tokenCompressionThreshold: 10000,
    allowPremiumEscalation: true,
    modelRegistry: {
      local_text: { provider: "ollama", model: "lfm2:latest" },
      local_vision: { provider: "ollama", model: "qwen3-vl:latest" },
      premium: { provider: "anthropic", model: "claude-sonnet-4-6" }
    },
    routeMap: {
      textDefault: "local_text",
      multimodal: "local_vision",
      urgent: "premium",
      codeHighContext: "premium"
    }
  },
  policy: {
    postOnlyMode: false,
    rules: [
      {
        id: "safe-actions",
        kind: "action_allowlist",
        actions: ["send", "post", "tool_call"]
      }
    ]
  }
});

const decision = await kernel.decide({
  sessionId: "abc",
  timestamp: new Date().toISOString(),
  messages: [{ role: "user", content: "Help me refactor this repo" }],
  estimatedTokens: 12000
});
```

## Quick start (CLI)

```bash
context-kernel --config ./examples/kernel.config.json --input ./examples/input.json
```

## Adapters

- `context-kernel/adapters/openclaw`
- `context-kernel/adapters/http`

## Presets

- `examples/preset.openclaw.json`
- `examples/preset.generic.json`

## Service naming map

- `ContextKernel`, `RouteEngine`, `BudgetGuard`, `ContextCompactor`
- `PolicyGate`, `MemorySignal`, `TraceLedger`
- `BridgeOpenClaw`, `BridgeHTTP`

## Output contract

Main decision object includes:

- `route`
- `compress`
- `policyVerdicts`
- `memoryCandidates`
- `actions`

Audit events include:

- `started`, `classified`, `guard_blocked`, `routed`, `compressed`, `completed`, `failed`

## Policy DSL

Rule kinds:

- `action_allowlist`
- `quiet_hours`
- `secret_regex`

Each rule has stable `id`, optional `reason`, optional `severity`.

## Memory candidate contract

Each candidate includes:

- `summary`
- `tags`
- `priority`
- `confidence` (`0..1`)
- `source` (`messageIndexes`, extraction strategy)
- optional `writebackHint` (namespace/upsert/ttl)

## Development

```bash
npm install
npm run build
npm test
```

## CI and release

- CI workflow: `.github/workflows/ci.yml`
- Release workflow: `.github/workflows/release.yml`
- Add `NPM_TOKEN` secret in GitHub Actions
- Tag and push: `git tag v0.1.0 && git push origin v0.1.0`
