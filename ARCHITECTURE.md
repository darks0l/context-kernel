# Architecture

Service names used across docs/API:

- `ContextKernel` (orchestrator)
- `RouteEngine` (model route decision)
- `BudgetGuard` (token threshold + compression signal)
- `ContextCompactor` (compression stage hook)
- `PolicyGate` (policy DSL evaluation)
- `MemorySignal` (memory candidate extraction)
- `TraceLedger` (audit events sink)
- `BridgeOpenClaw` (OpenClaw adapter)
- `BridgeHTTP` (generic adapter)

## Design rule

Core is platform-agnostic. Adapters map external envelopes into `KernelInput` and map output actions/events back out.
