# Changelog

All notable changes to this project are documented in this file.

## v0.3.0

### Feature: Streaming Audit Log Pipeline
- New `audit/` subsystem with pluggable backends.
- `JsonlAuditBackend` — append-only JSONL file backend with in-memory buffering (flushes every 10 events or 100ms).
- `WebhookAuditBackend` — HTTP POST events to remote observability endpoints (Datadog, Loki, etc.).
- `AuditPipeline` — fans out writes to multiple backends, graceful failure handling.
- `KernelConfig.audit` — new optional config field: `backend: "jsonl" | "webhook"`, `path` or `url`, optional `headers`.
- `ContextKernel` now emits all events to the audit pipeline after `decide()` completes.
- Query and replay APIs: `audit.query({ sessionId, event, since, until, limit })`, `audit.replay(sessionId)`.

### Chores
- docs: retrofit README to SHIP_STANDARD format with validated quickstart and configuration table
- chore: add MIT LICENSE file
- chore: add repository metadata fields (`homepage`, `bugs`, `repository`) to package.json

## v0.1.0

- Initial Context Kernel MVP
- Core routing + token budget compression trigger
- Policy guards (post-only, quiet-hours, secret guard)
- Policy DSL rules (`action_allowlist`, `quiet_hours`, `secret_regex`)
- Memory candidate extraction contract with confidence/source/writeback hints
- OpenClaw + generic HTTP adapters
- CLI runner
- Test suite + CI/release workflows
