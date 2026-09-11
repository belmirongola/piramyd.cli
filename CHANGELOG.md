# Changelog

All notable changes to `piramyd.toolkit` should be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer principles where practical.

## [Unreleased]

## [0.2.1] - 2026-09-11

Re-published as 0.2.1 — the 0.2.0 npm publish never completed (blocked on 2FA), so this version carries the same changes below plus the version bump.

## [0.2.0] - 2026-09-08

### Removed
- Local emergency catalog (`src/emergency-catalog.js`). If the Piramyd API is unreachable or empty, the CLI now errors instead of inventing models.

### Added
- `piramyd prober`: prints the last stored probe round (latest probe session per model) as a terminal table, or `--json`. Read-only — no probing is triggered. Authenticates with a normal Piramyd API key (`--api-key` / `PIRAMYD_API_KEY`) that the API requires to belong to an admin user; reads `GET /v1/admin/prober/latest`. Supports `--model <provider_model_id>` to show a single model. New module `src/prober.js` + `tests/prober.unit.test.js`.
- `piramyd status` / `piramyd status --json`: inspect CLI binaries, configs, launchers, and key presence.
- `piramyd restore --target <kind>`: restore the latest `*.bak.<timestamp>` for that CLI.
- Non-interactive onboarding: `--yes --target codex,claude --api-key sk-... --model gpt-5.6-sol`.
- `PIRAMYD_BASE_URL` and `PIRAMYD_API_KEY` environment overrides.
- `--dry-run` flag: preview generated configs without writing any files.
- `--help` / `-h` flag: display usage information.
- `generateConfig()` export in patchers: returns preview data without side-effects.
- New modules: `src/diagnosis.js` (health-check functions) and `src/emergency-catalog.js` (fallback catalog + model helpers).
- ESLint 9 integration with flat config (`eslint.config.js`).
- `prepublishOnly` gate: lint → test → smoke test before npm publish.
- 86 new unit tests (8 → 94): patcher tests for all 7 targets (create/preserve/idempotency), diagnosis tests, emergency-catalog tests, TOML round-trip tests, dry-run tests, Windows compatibility tests.
- `AGENTS.md` with project conventions and architecture.

### Changed
- Extracted diagnostic functions from `bin/piramyd.js` to `src/diagnosis.js` (reduced entrypoint from 515 → ~400 lines).
- Extracted emergency catalog logic from `bin/piramyd.js` to `src/emergency-catalog.js`.
- `writeConfig()` now accepts optional `{ dryRun: true }` option.

### Fixed — Windows compatibility
- `isExecutable()` now uses `F_OK` + extension check on Windows (X_OK is unreliable).
- `resolveCommand()` tries PATHEXT extensions (`.exe`, `.cmd`, `.bat`) and Windows-specific fallback dirs (`AppData/Local`, `AppData/Roaming/npm`).
- `renderCodexLauncher()` generates a proper `.cmd` batch script on Windows (was Unix-only `#!/bin/sh`).
- `renderCodexSecretFile()` uses plain `KEY=VALUE` (no shell quoting) and `\r\n` on Windows.
- `chmodSync()` wrapped in `safeChmod()` — silently no-ops on Windows.
- `codexLauncherLooksHealthy()` validates `.cmd` content on Windows.
- `showSuccess()` shows Windows `setx PATH` tip instead of Unix-only export.

### Removed
- `builder.js` (obsolete brittle build script — replaced by modular architecture).
- Empty placeholder directories: `src/core/`, `src/patchers/`, `src/utils/`, `scripts/`.
- Stale `piramyd-0.1.0.tgz` artifact.

### Fixed — General
- `.gitignore` expanded: covers `.env`, coverage, OS artifacts, IDE files.
- Unused imports cleaned from `bin/piramyd.js`.
- ESLint warnings resolved (unused vars, catch bindings).
- Defined missing `CODEX_NODE_SHIM_PATH` in constants (Windows Codex launcher).
- Claude Code patcher now sets `ANTHROPIC_DEFAULT_OPUS_MODEL` when opus models are available in the catalog.

## [0.1.9]

### Existing Baseline
- Interactive onboarding flow for supported targets.
- Catalog fetch with metadata fallback.
- Smoke test script available (`npm run test:smoke`).
