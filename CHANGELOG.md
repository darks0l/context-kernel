# Changelog

## Unreleased
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
