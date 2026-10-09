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

### Chave guardada (pede-se uma só vez)

A key é pedida uma única vez e fica em `~/.piramyd/credentials.json` (modo 600). Todos os comandos
reutilizam-na; só muda quando o utilizador o pede explicitamente.

```bash
npx piramyd login            # guarda (e valida) a key
npx piramyd login --admin    # guarda a key de admin usada por `prober`
npx piramyd whoami           # mostra a key em uso e de onde vem
npx piramyd logout           # esquece a key guardada
npx piramyd models --change-key   # troca a key neste comando
npx piramyd models --api-key pyd-key-...   # uma key passada por flag substitui a guardada
```

Ordem de escolha: `--api-key` > `PIRAMYD_API_KEY` > guardada > key já presente na config de uma CLI.
Aceita `sk-...` e `pyd-key-...`. `PIRAMYD_CONFIG_DIR` muda a pasta de credenciais.

### Estado, restore e modo não-interactivo

```bash
npx piramyd status
npx piramyd status --json
npx piramyd restore --target codex
npx piramyd --yes --target codex --api-key sk-... --model gpt-5.6-sol
npx piramyd --dry-run --yes --target claude --api-key sk-...
```

`PIRAMYD_BASE_URL` aponta o wizard a um gateway diferente (staging / self-host). `PIRAMYD_API_KEY` evita colar a chave no prompt.

### Chat (conciliação de conversas entre perfis)

O toolkit isola cada CLI num perfil próprio (`claude-piramyd` usa
`~/.claude-piramyd`, `codex-piramyd` usa o perfil `piramyd`). Esse isolamento é
propositado, mas tem um efeito colateral: **os chats ficam presos no perfil onde
foram criados**. O `chat` inventaria os dois perfis e mostra o que existe, o que
falta e o que corresponde — e pode trazer para um perfil as sessões que só
existem no outro.

```bash
npx piramyd chat                      # inventário + conciliação (só leitura)
npx piramyd chat --json               # saída machine-readable
npx piramyd chat --from claude-piramyd --to claude --dry-run   # mostra o plano
npx piramyd chat --from claude-piramyd --to claude --yes       # aplica
```

Estados na tabela: `● ambos` (existe nos dois), `● só A` / `● só B` (só num),
`▲ difere` (mesmo id mas `cwd` diferente — não é fundido), `▲ live` (a decorrer).

**Onde estão os chats**

| Perfil | Local |
|---|---|
| `claude` | `~/.claude/projects/<slug>/<sessão>.jsonl` |
| `claude-piramyd` | `~/.claude-piramyd/projects/<slug>/<sessão>.jsonl` |
| `codex` / `codex-piramyd` | `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` (árvore partilhada) |

**Import é aditivo puro:** só acrescenta sessões que faltam no destino. Nunca
sobrescreve, nunca duplica, e uma segunda execução não faz nada. Sem `--from`/
`--to` o comando é 100% de leitura. O registo de processos vivos
(`sessions/<pid>.json`), que contém tokens de sessão, nunca é tocado.

**Codex:** os dois perfis escrevem na **mesma** árvore `~/.codex/sessions` — o que
os distingue é o campo `model_provider` dentro de cada rollout. Como não há dois
destinos separados, o `chat` faz o inventário do Codex (mostrando o split, ex.
`31 nativo · 21 piramyd`) mas recusa importar entre eles, explicando porquê.

**Limitações conhecidas (v1):** apenas Claude e Codex. O Gemini guarda chats
parciais em `~/.gemini/tmp/` (efémero, e sobretudo turnos do utilizador);
Kimi e Copilot não têm diretório; OpenClaw tem o esquema mas zero registos; Qwen
e OpenCode só guardam configuração. Conversão entre CLIs diferentes (ex.: Claude
→ Codex) ainda não existe.

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
  - Atualiza `~/.codex/config.toml` com o provider Piramyd (`[model_providers.piramyd]`, `wire_api = "responses"`)
  - Cria o overlay `~/.codex/piramyd.config.toml` para `codex --profile piramyd` (sem a tabela legado `[profiles.piramyd]`)
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
