# Changelog

All notable changes to `piramyd.toolkit` should be documented in this file.

The format is based on Keep a Changelog and this project follows SemVer principles where practical.

## [Unreleased]

### Added
- Saved API key: the key is asked once and kept in `~/.piramyd/credentials.json` (mode 600); every command reuses it until the user changes it. New `login`, `logout`, `whoami` commands and a `--change-key` flag; a key passed with `--api-key` replaces the saved one; `PIRAMYD_API_KEY` is used but never persisted. A key already present in a CLI config is adopted on first use.
- `piramyd chat`: reconcile conversation history across the isolated Piramyd profiles. The toolkit runs each CLI through its own profile (`claude-piramyd` uses `CLAUDE_CONFIG_DIR=~/.claude-piramyd`, `codex-piramyd` uses `--profile piramyd`), which deliberately keeps them apart — but that also traps chats in whichever profile created them. `chat` inventories both stores and reports what exists in each, what is missing from one, and what is shared. Without `--from`/`--to` it is entirely read-only.
- `piramyd chat --from <profile> --to <profile> [--dry-run|--yes]`: import sessions that are missing from another profile of the **same** CLI. Strictly additive — never overwrites, never duplicates, and a second run is a no-op. `--dry-run` prints the plan and writes nothing.
- `piramyd chat --json`: machine-readable inventory, reconciliation, and import plan.
- Turn extraction is measured against the real stores rather than guessed. On the Claude side a `user` record counts only when `toolUseResult` is absent, `isMeta` is not true, and `isSidechain` is not true — across 30 sampled files, a present `toolUseResult` implied a tool result in 9284/9284 cases, so without that filter the count inflates roughly 22×. Harness-only prefixes (`task-notification`, `local-command-*`, `command-name`) are excluded, while `<pasted_content>` is kept because it is real user input. On the Codex side only `response_item` message records are counted — `event_msg.agent_message` is a near-duplicate mirror of the same assistant text and must not be summed.
- Titles resolve by precedence: Claude `custom-title`, then the **last** `ai-title` (they are cumulative and get rewritten as a conversation develops — 5 of 28 sessions changed mid-life), then Codex `state_5.sqlite` `threads.title` (populated for 51 of 52 rollouts), then the first real prompt. `session_index.jsonl` is deliberately not used as the primary source: it holds only 16 distinct ids for 52 sessions.
- Same session id under two different working directories is reported as ambiguous (`▲ difere`) and never merged.
- Sessions are read by streaming line-by-line: the largest Codex rollout is 40.9 MB across 591 lines, with individual lines over 1 MB, so no transcript is ever loaded whole.
- `codex` and `codex-piramyd` share one storage tree (`~/.codex/sessions`), distinguished only by the `model_provider` recorded inside each rollout — so `chat` inventories Codex (showing the split, e.g. `31 nativo · 21 piramyd`) but refuses to import between them and explains why, rather than appearing to act.
- New module `src/chat.js` and `tests/chat.unit.test.js` (31 tests).
- New constants for the chat stores in `src/constants.js`.

### Notes
- The Claude cwd slug is lossy (`/`, `.`, and spaces all collapse to `-`, while spaces are sometimes preserved literally), so the real path is always read from the `cwd` field inside the transcript rather than reverse-engineered from the directory name.
- Related: `syncClaudeState()` already copies Claude state one-way into `~/.claude-piramyd`, but it deletes and re-copies `projects/` and `sessions/` with no backup for directories. `chat` does not reuse that path, and never touches `sessions/` — it is a live per-process registry containing session tokens, not chat history.

### Fixed
- Keys with the `pyd-key-` prefix were rejected everywhere the toolkit checked for `sk-`.
- A rejected key (401/403) no longer falls back to the public model list, which hid the real problem behind an "unknown tier" catalog.

## [0.3.0] - 2026-09-18

### Added
- `piramyd prober --live [--model <id> | --all]`: sends real requests (non-stream + stream) to the public API right now and validates the response contract Piramyd is supposed to guarantee — finish_reason is null or a valid OpenAI enum member on *every* stream chunk (not just the terminal one), `response.model` always equals the model the client asked for (never the internally-substituted or raw upstream/provider id), and no `provider`/`system_fingerprint` field leaks. Exits with code 1 on any failure, so it's usable in scripts/CI. `--json` for machine-readable output. This is a black-box check of the live API, independent of the stored probe DB — it's what actually caught the swastic `finish_reason:""` bug and the streaming model-identity leak.
- Stored-round table (`npx piramyd prober`, no `--live`) now surfaces known response-integrity quirks from the last cloud probe (`streaming_finish_reason_invalid`, `non_standard_errors`) as inline warnings per model, plus a summary line pointing at `--live` to re-verify.

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
