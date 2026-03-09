# piramyd

Interactive onboarding wizard for connecting local AI coding CLIs to Piramyd.

Supported targets:
- Codex CLI
- Claude Code
- Kimi Code
- OpenClaw

## Usage

```bash
npx piramyd
```

The wizard will:
- detect supported local configs
- ask for a Piramyd API key
- fetch the live model catalog from `https://api.piramyd.cloud/v1/models`
- patch the selected CLI config
- create backups before writing

## Notes

- For Codex, the wizard creates a dedicated launcher at `~/.local/bin/codex-piramyd`.
- For Claude Code, the wizard configures the Anthropic-compatible Piramyd gateway.
- If the live catalog is unavailable, the wizard falls back to a local OpenClaw cache when possible.
