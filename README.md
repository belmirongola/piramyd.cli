# Piramyd Toolkit (`piramyd`)

CLI wizard de onboarding para conectar agentes de código em terminal ao gateway da Piramyd.

> **Nota de nomenclatura**
> - Nome da pasta/projeto no workspace: `piramyd.toolkit`
> - Nome atual do pacote npm/binário: `piramyd`

## O que o toolkit faz

- Detecta CLIs suportadas instaladas no seu `PATH`
- Permite selecionar um ou mais targets para configurar
- Solicita/reaproveita sua API key da Piramyd (`sk-...`)
- Busca catálogo/tier em `https://api.piramyd.cloud/v1/cli/metadata`
- Aplica patch nas configs de cada CLI
- Cria backups antes de escrever alterações
- Oferece modo de reparo automático (`doctor`)

## Targets suportados

- Codex CLI
- Claude Code
- Kimi Code
- OpenClaw
- Gemini CLI
- Qwen CLI
- OpenCode

## Requisitos

- Node.js `>= 18`

## Uso

### Onboarding normal

```bash
npx piramyd
```

### Modo de reparo (doctor)

```bash
npx piramyd doctor
```

## O que é alterado por target

- **Codex CLI**
  - Atualiza `~/.codex/config.toml` com profile Piramyd
  - Cria profile + provider dedicados (`[profiles.piramyd]` + `[model_providers.piramyd]`) com `wire_api = "responses"`
  - Cria/atualiza segredo em `~/.codex/piramyd.env`
  - Cria launcher `codex-piramyd` em `~/.local/bin` (ou caminho equivalente no Windows)
  - Mantém `base_url` cloud (`https://api.piramyd.cloud/v1`) e aceita `PIRAMYD_DEBUG=1` para diagnosticar env/base_url/fingerprint de chave

- **Claude Code**
  - Atualiza `~/.claude/settings.json`
  - Configura `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
  - Ajusta aliases/defaults Claude quando disponíveis no catálogo

- **Kimi Code**
  - Atualiza `~/.kimi/config.toml`
  - Injeta provider Piramyd e modelos derivados do catálogo

- **OpenClaw**
  - Atualiza `~/.openclaw/openclaw.json`
  - Define provider/modelos Piramyd e default model

- **Gemini CLI**
  - Atualiza `~/.gemini/settings.json`
  - Configura `gatewayUrl` para a Piramyd

- **Qwen CLI**
  - Atualiza `~/.qwen/settings.json`
  - Configura auth/provider para uso via Piramyd

- **OpenCode**
  - Atualiza `~/.opencode/config.json`
  - Define `defaultProvider = "piramyd"`

## Segurança e rollback

- Antes de alterar qualquer arquivo existente, o toolkit cria backup (`*.bak.<timestamp>`).
- No Codex, o arquivo de segredo é salvo com permissão restrita (`0600`).

## Desenvolvimento local

No diretório do projeto:

```bash
npm install
node bin/piramyd.js
```

Para executar o modo doctor localmente:

```bash
node bin/piramyd.js doctor
```

## Dependências principais

- `@clack/prompts`
- `picocolors`
