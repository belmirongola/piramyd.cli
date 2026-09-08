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

### Estado, restore e modo não-interactivo

```bash
npx piramyd status
npx piramyd status --json
npx piramyd restore --target codex
npx piramyd --yes --target codex --api-key sk-... --model gpt-5.6-sol
npx piramyd --dry-run --yes --target claude --api-key sk-...
```

`PIRAMYD_BASE_URL` aponta o wizard a um gateway diferente (staging / self-host). `PIRAMYD_API_KEY` evita colar a chave no prompt.

### Prober (última rodada de probes)

Imprime a última rodada de probes que o prober agendado guardou na base de dados —
a sessão mais recente de cada modelo. Não dispara nada; é só leitura.

Autentica com uma **API key `sk-...` normal**, mas a API exige que essa key
pertença a um utilizador admin (`is_superuser`). Passa em `--api-key` ou na env
`PIRAMYD_API_KEY`; sem ela (e sem `--json`) pede num prompt escondido.

```bash
npx piramyd prober                       # todos os modelos da última rodada
npx piramyd prober --model gpt-5.6-sol    # só um modelo
npx piramyd prober --json                 # saída machine-readable
npx piramyd prober --api-key sk-...
```

A tabela mostra status, `◉` (visão), tools, streaming, probes ok/total,
confiança de normalização, duração e há quanto tempo foi probado.

Env: `PIRAMYD_API_KEY` (a admin key), `PIRAMYD_BASE_URL` (API, default
`https://api.piramyd.cloud`). Fonte: `GET /v1/admin/prober/latest`.

## O que é alterado por target

- **Codex CLI**
  - Atualiza `~/.codex/config.toml` com profile Piramyd
  - Cria profile + provider dedicados (`[profiles.piramyd]` + `[model_providers.piramyd]`) com `wire_api = "responses"`
  - Cria/atualiza segredo em `~/.codex/piramyd.env`
  - Cria launcher `codex-piramyd` em `~/.local/bin` (ou caminho equivalente no Windows)
  - Mantém `base_url` cloud (`https://api.piramyd.cloud/v1`) e aceita `PIRAMYD_DEBUG=1` para diagnosticar env/base_url/fingerprint de chave

- **Claude Code**
  - Cria config isolada em `~/.claude-piramyd/settings.json`
  - Cria launcher `claude-piramyd` em `~/.local/bin` (ou caminho equivalente no Windows)
  - Configura `CLAUDE_CONFIG_DIR`, `ANTHROPIC_BASE_URL` e `ANTHROPIC_API_KEY` sem tocar no `~/.claude` padrão
  - Ajusta modelos default Claude quando disponíveis no catálogo

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
