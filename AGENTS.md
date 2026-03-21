# Piramyd Toolkit — Agent Guide

## Overview

CLI wizard for onboarding code agents (Codex, Claude Code, Kimi, OpenClaw, Gemini, Qwen, OpenCode) to the Piramyd gateway.

## Quick Commands

```bash
npm test          # ESLint + Jest (94 tests)
npm run test:smoke  # Smoke test (node-based assertions)
npm run lint      # ESLint only
```

## Architecture

```
bin/piramyd.js          # CLI entrypoint — interactive UI (clack/prompts)
src/
  constants.js          # Target definitions, URLs, paths (IS_WINDOWS flag)
  catalog.js            # Remote model catalog fetch + sanitization
  patchers.js           # Config generation/writing for all 7 targets
  toml.js               # Lightweight TOML section parser
  utils.js              # 24+ shared utilities (platform-aware)
  diagnosis.js          # Health-check: read existing keys, detect broken configs
  emergency-catalog.js  # Hardcoded fallback catalog + model helpers
```

## Conventions

- **CommonJS** (`require`/`module.exports`), NOT ESM
- **Node >= 18** required
- **No TypeScript**
- Existing code uses **double quotes**, **2-space indent**, **no trailing semicolons** in some spots but mostly semicolons
- Tests use **Jest** (`describe`/`test`/`expect`)
- Smoke tests use **Node assert** (plain scripts)

## Testing

- All patchers have create/preserve/idempotency tests
- Tests use `fs.mkdtempSync` for temp dirs — no mocking
- Run full pipeline: `npm run lint && npm test && npm run test:smoke`

## Key Patterns

- `writeConfig(target, apiKey, catalog, { dryRun })` — supports dry-run preview
- `generateConfig(target, apiKey, catalog)` — returns preview without writing
- Backups are always created before overwrites (`*.bak.<timestamp>`)
- Codex gets special treatment: launcher script + env file + profile

## Windows Support

- `IS_WINDOWS` flag in `constants.js` drives all platform branching
- `isExecutable()` uses `F_OK` + extension check on Windows instead of `X_OK`
- `resolveCommand()` tries PATHEXT extensions and Windows-specific dirs
- Codex launcher: `.cmd` batch script on Windows, `#!/bin/sh` on Unix
- Codex secret file: plain `KEY=VALUE` with CRLF on Windows, shell-quoted on Unix
- `safeChmod()` replaces raw `chmodSync()` — no-ops on Windows
- All JSON targets (claude, openclaw, gemini, qwen, opencode) are platform-independent

## Publish Gate

`prepublishOnly` runs: lint → test → smoke test
