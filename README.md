# context-kernel

![DARKSOL](./assets/darksol-logo.svg)
Built by DARKSOL 🌑

Platform-agnostic context routing kernel for agent runtimes: route decisions, token-budget guards, policy checks, and audit events.

![npm](https://img.shields.io/npm/v/context-kernel)
![license](https://img.shields.io/badge/license-MIT-green)
![types](https://img.shields.io/badge/types-TypeScript-blue)

## Why this exists
Agent systems need consistent, testable decisions about model routing, context compression, and policy enforcement. This project provides a reusable kernel so those decisions are explicit, configurable, and auditable.

## What it does
- Classifies request shape (`text`/`multimodal`) and task intent
- Triggers compression when token estimates pass configurable thresholds
- Routes across model profiles using a route map + registry
- Applies policy gates (allowlist, quiet-hours, secret regex checks)
- Emits deterministic audit events for observability/debugging
- Exposes adapters for OpenClaw and generic HTTP-style envelopes

## Quickstart
```bash
npm install context-kernel
```

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
      { id: "safe-actions", kind: "action_allowlist", actions: ["send", "post", "tool_call"] }
    ]
  }
});

const decision = await kernel.decide({
  sessionId: "abc",
  timestamp: new Date().toISOString(),
  messages: [{ role: "user", content: "Help me refactor this repo" }],
  estimatedTokens: 12000
});

console.log(decision.route, decision.compress);
```

## Real example(s)
```bash
# local repository usage
npm ci
npm run build
npm test

# run CLI with sample files
npx context-kernel --config ./examples/kernel.config.json --input ./examples/input.json
```

## Config/options
| Option | Type | Default | Description |
|---|---|---:|---|
| `router.tokenCompressionThreshold` | number | `10000` | Token estimate that triggers compression workflow |
| `router.allowPremiumEscalation` | boolean | `true` | Allows escalation to premium route when mapped |
| `router.modelRegistry` | object | required | Named provider/model targets |
| `router.routeMap` | object | required | Decision class -> target model key mapping |
| `policy.postOnlyMode` | boolean | `false` | Restrict action outputs to post/send style actions |
| `policy.rules` | array | `[]` | DSL rules (`action_allowlist`, `quiet_hours`, `secret_regex`) |

## Architecture / flow
- Input envelope enters `ContextKernel`
- Classification + token/budget assessment run
- Policy rules evaluate and may block/flag actions
- Router selects model target based on route map
- Decision contract returns `route`, `compress`, `policyVerdicts`, `memoryCandidates`, and `actions`
- Audit events emitted (`started`, `classified`, `routed`, `compressed`, `completed`, `failed`)

## Performance notes
This repo does not publish benchmark numbers. Runtime cost depends on rule count, input size, and adapter integration.

## Limitations + roadmap
### Current limitations
- Primarily focused on deterministic policy/routing decisions, not model execution itself
- Compression and memory extraction behavior depends on your downstream worker implementation

### Roadmap
- Expanded reference policies/presets
- Additional adapter examples
- More contract tests around complex policy combinations

## Security notes
- Keep secret-regex rules aligned to your environment.
- Treat policy configs as security-sensitive infrastructure.

## License + links
- License: MIT
- Changelog: `CHANGELOG.md`
- Architecture details: `ARCHITECTURE.md`
- Security policy: `SECURITY.md`
- GitHub: <https://github.com/darks0l/context-kernel>
