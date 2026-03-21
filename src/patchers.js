const fs = require("fs");
const os = require("os");
const {
  CODEX_PROFILE, CODEX_MODEL_PROVIDER, GENERATED_START, GENERATED_END,
  PIRAMYD_OPENAI_BASE_URL, PIRAMYD_ANTHROPIC_BASE_URL, CODEX_SECRET_PATH, CODEX_LAUNCHER_PATH, IS_WINDOWS
} = require("./constants");
const {
  exists, escapeRegex, renderTomlString, renderTomlArray, renderShellString,
  aliasFromId, backupIfPresent, writeFileWithMode
} = require("./utils");
const { parseTomlSections, upsertTopLevelSetting, trimBoundaryBlankLines } = require("./toml");

function loadJsonConfig(filePath, targetLabel) {
  if (!exists(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (_err) {
    throw new Error(
      `Invalid JSON in ${targetLabel} config at ${filePath}. Fix the file or restore a backup, then re-run piramyd.`
    );
  }
}

function toOpenClawModelEntry(model) {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: model.input.includes("image") ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}
function toKimiCapabilities(model) {
  const capabilities = [];
  if (model.reasoning) capabilities.push("thinking");
  if (model.input.includes("image")) capabilities.push("image_in");
  if (model.input.includes("video")) capabilities.push("video_in");
  return [...new Set(capabilities)];
}
function rankCatalogModels(models) {
  return [...(models || [])].sort((a, b) => {
    const reasoningDiff = Number(Boolean(b.reasoning)) - Number(Boolean(a.reasoning));
    if (reasoningDiff !== 0) return reasoningDiff;
    const contextDiff = Number(b.contextWindow || 0) - Number(a.contextWindow || 0);
    if (contextDiff !== 0) return contextDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function firstModelByPredicate(models, predicate) {
  return rankCatalogModels(models).find((model) => predicate(String(model.id || "").toLowerCase()))?.id || "";
}

function pickClaudeModelSet(models) {
  const sonnet = firstModelByPredicate(models, (id) => id.includes("claude") && id.includes("sonnet"));
  const opus = firstModelByPredicate(models, (id) => id.includes("claude") && id.includes("opus"));
  const haiku = firstModelByPredicate(models, (id) => id.includes("claude") && id.includes("haiku"));
  const fallback = firstModelByPredicate(models, (id) => id.includes("claude"));
  return {
    default: sonnet || opus || haiku || fallback,
    opus,
    sonnet,
    haiku,
  };
}
function targetBaseUrl(target) {
  return target.kind === "claude" ? PIRAMYD_ANTHROPIC_BASE_URL : PIRAMYD_OPENAI_BASE_URL;
}
function firstModelId(models) {
  return (models || []).find((model) => model && typeof model.id === "string" && model.id.trim())?.id || "";
}

function targetDefaultModel(target, models, _userTier = "free", selectedDefaultModelId = "") {
  if (target.kind === "claude") {
    const preferredModelId = String(selectedDefaultModelId || "").trim();
    const hasPreferredModel = preferredModelId
      ? models.some((model) => String(model.id || "") === preferredModelId)
      : false;
    if (hasPreferredModel) return preferredModelId;
    return pickClaudeModelSet(models).default || "manual selection";
  }

  const preferredModelId = String(selectedDefaultModelId || "").trim();
  const hasPreferredModel = preferredModelId
    ? models.some((model) => String(model.id || "") === preferredModelId)
    : false;
  const defaultModelId = hasPreferredModel ? preferredModelId : firstModelId(models);
  if (!defaultModelId) return "";
  if (["codex", "gemini", "qwen"].includes(target.kind)) return defaultModelId;
  return `piramyd/${defaultModelId}`;
}
function updateOpenClawConfig(filePath, apiKey, models, userTier = "free", selectedDefaultModelId = "") {
  const config = loadJsonConfig(filePath, "OpenClaw");
  config.meta = config.meta || {};
  config.meta.lastTouchedAt = new Date().toISOString();
  config.models = config.models || {};
  config.models.providers = config.models.providers || {};
  config.models.providers.piramyd = {
    ...(config.models.providers.piramyd || {}),
    baseUrl: PIRAMYD_OPENAI_BASE_URL,
    apiKey: apiKey.trim(),
    auth: "api-key",
    api: "openai-completions",
    models: models.map(toOpenClawModelEntry),
  };

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = {
    primary: targetDefaultModel({kind: "openclaw"}, models, userTier, selectedDefaultModelId)
  };

  const retainedModels = Object.fromEntries(
    Object.entries(config.agents.defaults.models || {}).filter(([key]) => !key.startsWith("piramyd/"))
  );
  for (const model of models) {
    retainedModels[`piramyd/${model.id}`] = { alias: aliasFromId(model.id) };
  }
  config.agents.defaults.models = retainedModels;

  return JSON.stringify(config, null, 2) + os.EOL;
}
function stripGeneratedBlock(raw) {
  const pattern = new RegExp(
    `${escapeRegex(GENERATED_START)}[\\s\\S]*?${escapeRegex(GENERATED_END)}\\n*`,
    "g"
  );
  return raw.replace(pattern, "");
}
function renderKimiGeneratedBlock(apiKey, catalog) {
  const lines = [
    GENERATED_START,
    "[providers.piramyd]",
    'type = "openai_legacy"',
    `base_url = ${renderTomlString(PIRAMYD_OPENAI_BASE_URL)}`,
    `api_key = ${renderTomlString(apiKey)}`,
    "",
    "[providers.piramyd.env]",
    `OPENAI_API_KEY = ${renderTomlString(apiKey)}`,
    "",
    "[providers.piramyd.custom_headers]",
    `Authorization = ${renderTomlString(`Bearer ${apiKey}`)}`,
    `"x-api-key" = ${renderTomlString(apiKey)}`,
    "",
  ];

  for (const model of catalog) {
    lines.push(`[models.${renderTomlString(`piramyd/${model.id}`)}]`);
    lines.push('provider = "piramyd"');
    lines.push(`model = ${renderTomlString(model.id)}`);
    lines.push(`max_context_size = ${model.contextWindow}`);
    lines.push(`capabilities = ${renderTomlArray(toKimiCapabilities(model))}`);
    lines.push("");
  }

  lines.push(GENERATED_END);
  return lines.join("\n");
}
function shouldDropKimiSection(header) {
  if (header === "providers.piramyd") return true;
  if (header === "providers.piramyd.env") return true;
  if (header === "providers.piramyd.custom_headers") return true;
  return /^models\."piramyd\/.+"/.test(header);
}
function updateKimiConfig(filePath, apiKey, models, userTier = "free", selectedDefaultModelId = "") {
  const raw = stripGeneratedBlock(fs.readFileSync(filePath, "utf8"));
  const { preamble, sections } = parseTomlSections(raw);
  const retainedSections = sections.filter((section) => !shouldDropKimiSection(section.header));

  const defaultModelStr = renderTomlString(
    targetDefaultModel({kind: "kimi"}, models, userTier, selectedDefaultModelId)
  );
  let updatedPreamble = upsertTopLevelSetting(preamble, "default_model", defaultModelStr);
  updatedPreamble = upsertTopLevelSetting(updatedPreamble, "default_thinking", "true");
  updatedPreamble = trimBoundaryBlankLines(updatedPreamble);

  const chunks = [];
  if (updatedPreamble.length) chunks.push(updatedPreamble.join("\n"));
  if (retainedSections.length) {
    chunks.push(
      retainedSections
        .map((section) => trimBoundaryBlankLines(section.lines).join("\n"))
        .filter(Boolean)
        .join("\n\n")
    );
  }
  chunks.push(renderKimiGeneratedBlock(apiKey, models));
  return chunks.filter(Boolean).join("\n\n") + "\n";
}
function renderCodexGeneratedBlock(models, selectedDefaultModelId = "") {
  const preferredModelId = String(selectedDefaultModelId || "").trim();
  const hasPreferredModel = preferredModelId
    ? models.some((model) => String(model.id || "") === preferredModelId)
    : false;
  const defaultModelId = hasPreferredModel ? preferredModelId : firstModelId(models);
  if (!defaultModelId) throw new Error("No model available from API catalog to set as default for Codex.");
  return [
    GENERATED_START,
    "# Piramyd profile/provider. Launcher injects OPENAI_BASE_URL and OPENAI_API_KEY.",
    `[profiles.${CODEX_PROFILE}]`,
    `model_provider = ${renderTomlString(CODEX_MODEL_PROVIDER)}`,
    `model = ${renderTomlString(defaultModelId)}`,
    'model_reasoning_effort = "medium"',
    "",
    `[model_providers.${CODEX_MODEL_PROVIDER}]`,
    'name = "Piramyd"',
    `base_url = ${renderTomlString(PIRAMYD_OPENAI_BASE_URL)}`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'request_max_retries = 2',
    'stream_max_retries = 4',
    'stream_idle_timeout_ms = 300000',
    'supports_websockets = false',
    GENERATED_END,
  ].join("\n");
}
function shouldDropCodexSection(header) {
  return header === `profiles.${CODEX_PROFILE}` || header === `model_providers.${CODEX_MODEL_PROVIDER}`;
}
function updateCodexConfig(filePath, models, selectedDefaultModelId = "") {
  const raw = exists(filePath) ? stripGeneratedBlock(fs.readFileSync(filePath, "utf8")) : "";
  const { preamble, sections } = parseTomlSections(raw);
  const retainedSections = sections.filter((section) => !shouldDropCodexSection(section.header));
  const updatedPreamble = trimBoundaryBlankLines(preamble);

  const chunks = [];
  if (updatedPreamble.length) chunks.push(updatedPreamble.join("\n"));
  if (retainedSections.length) {
    chunks.push(
      retainedSections
        .map((section) => trimBoundaryBlankLines(section.lines).join("\n"))
        .filter(Boolean)
        .join("\n\n")
    );
  }
  chunks.push(renderCodexGeneratedBlock(models, selectedDefaultModelId));
  return chunks.filter(Boolean).join("\n\n") + "\n";
}
function renderCodexSecretFile(apiKey) {
  if (IS_WINDOWS) {
    // Windows .env file — no shell quoting, just KEY=VALUE
    return [
      `OPENAI_API_KEY=${apiKey.trim()}`,
      `OPENAI_BASE_URL=${PIRAMYD_OPENAI_BASE_URL}`,
      "",
    ].join("\r\n");
  }
  return [
    `OPENAI_API_KEY=${renderShellString(apiKey.trim())}`,
    `OPENAI_BASE_URL=${renderShellString(PIRAMYD_OPENAI_BASE_URL)}`,
    "",
  ].join("\n");
}
function renderCodexLauncherUnix(binaryPath) {
  return [
    "#!/bin/sh",
    "set -eu",
    `PIRAMYD_ENV=${renderShellString(CODEX_SECRET_PATH)}`,
    `CODEX_BIN=${renderShellString(binaryPath || "codex")}`,
    'if [ -f "$PIRAMYD_ENV" ]; then',
    '  # shellcheck disable=SC1090',
    '  . "$PIRAMYD_ENV"',
    "fi",
    `export OPENAI_BASE_URL=${renderShellString(PIRAMYD_OPENAI_BASE_URL)}`,
    'if [ -z "${OPENAI_API_KEY:-}" ]; then',
    '  echo "Piramyd API key not configured for Codex. Re-run the wizard." >&2',
    "  exit 1",
    "fi",
    'export OPENAI_API_KEY',
    'if [ "${PIRAMYD_DEBUG:-0}" = "1" ]; then',
    '  key_tail=$(printf "%s" "$OPENAI_API_KEY" | tail -c 7)',
    `  echo "codex-piramyd(debug): env=$PIRAMYD_ENV base_url=${PIRAMYD_OPENAI_BASE_URL} key=***${'$'}{key_tail}" >&2`,
    'fi',
    'explicit_profile=0',
    'prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "model" ] || [ "$prev" = "profile" ]; then',
    '    if [ "$prev" = "profile" ]; then explicit_profile=1; fi',
    '    prev=""',
    "    continue",
    "  fi",
    '  case "$arg" in',
    '    -m|--model) prev="model" ;;',
    '    -p|--profile) explicit_profile=1; prev="profile" ;;',
    "  esac",
    "done",
    'if [ "$explicit_profile" -eq 0 ]; then',
    `  exec "$CODEX_BIN" -p ${CODEX_PROFILE} "$@"`,
    "fi",
    'exec "$CODEX_BIN" "$@"',
    "",
  ].join("\n");
}
function renderCodexLauncherWindows(binaryPath) {
  const codexBin = binaryPath || "codex";
  // Escape CODEX_SECRET_PATH for batch: backslashes are native
  return [
    "@echo off",
    "setlocal enabledelayedexpansion",
    "",
    `set "PIRAMYD_ENV=${CODEX_SECRET_PATH}"`,
    `set "CODEX_BIN=${codexBin}"`,
    `set "OPENAI_BASE_URL=${PIRAMYD_OPENAI_BASE_URL}"`,
    "",
    "rem Load secrets from env file",
    'if exist "%PIRAMYD_ENV%" (',
    '  for /f "usebackq tokens=1,* delims==" %%A in ("%PIRAMYD_ENV%") do (',
    '    set "%%A=%%B"',
    "  )",
    ")",
    "",
    'if "%OPENAI_API_KEY%"=="" (',
    "  echo Piramyd API key not configured for Codex. Re-run the wizard. >&2",
    "  exit /b 1",
    ")",
    "",
    "rem Check if user passed an explicit -p / --profile flag",
    "set EXPLICIT_PROFILE=0",
    'set "PREV="',
    'for %%A in (%*) do (',
    '  if "!PREV!"=="profile" set EXPLICIT_PROFILE=1',
    '  set "PREV="',
    '  if "%%~A"=="-p" set "PREV=profile"',
    '  if "%%~A"=="--profile" set "PREV=profile"',
    ")",
    "",
    'if "%EXPLICIT_PROFILE%"=="0" (',
    `  "%CODEX_BIN%" -p ${CODEX_PROFILE} %*`,
    ") else (",
    '  "%CODEX_BIN%" %*',
    ")",
    "",
  ].join("\r\n");
}
function renderCodexLauncher(binaryPath) {
  return IS_WINDOWS
    ? renderCodexLauncherWindows(binaryPath)
    : renderCodexLauncherUnix(binaryPath);
}
function updateClaudeConfig(filePath, apiKey, models, userTier = "free", selectedDefaultModelId = "") {
  const config = loadJsonConfig(filePath, "Claude Code");
  const env = typeof config.env === "object" && config.env ? config.env : {};
  const selected = pickClaudeModelSet(models);

  env.ANTHROPIC_BASE_URL = PIRAMYD_ANTHROPIC_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = apiKey.trim();
  if (selected.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = selected.opus;
  if (selected.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = selected.sonnet;
  if (selected.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selected.haiku;

  config.env = env;
  const defaultModelId = targetDefaultModel({kind: "claude"}, models, userTier, selectedDefaultModelId);
  if (!config.model && defaultModelId !== "manual selection") config.model = defaultModelId;

  return JSON.stringify(config, null, 2) + os.EOL;
}

function updateGeminiConfig(filePath, apiKey) {
  const config = loadJsonConfig(filePath, "Gemini CLI");
  config.security = config.security || {};
  config.security.auth = config.security.auth || {};
  config.security.auth.selectedType = "gemini-api-key";
  config.security.auth.apiKey = apiKey.trim();
  config.security.gatewayUrl = PIRAMYD_OPENAI_BASE_URL;
  config.selectedAuthType = "gemini-api-key";
  return JSON.stringify(config, null, 2) + os.EOL;
}

function updateQwenConfig(filePath, apiKey, models, userTier = "free", selectedDefaultModelId = "") {
  const config = loadJsonConfig(filePath, "Qwen CLI");
  config.security = config.security || {};
  config.security.auth = config.security.auth || {};
  config.security.auth.selectedType = "api-key";
  config.security.auth.apiKey = apiKey.trim();
  config.security.gatewayUrl = PIRAMYD_OPENAI_BASE_URL;
  config.model = config.model || {};
  config.model.provider = "piramyd";
  config.model.name = targetDefaultModel({ kind: "qwen" }, models, userTier, selectedDefaultModelId);
  return JSON.stringify(config, null, 2) + os.EOL;
}

function updateOpenCodeConfig(filePath, apiKey, models, userTier = "free", selectedDefaultModelId = "") {
  const config = loadJsonConfig(filePath, "OpenCode");
  config.providers = config.providers || {};
  config.providers.piramyd = {
    apiKey: apiKey.trim(),
    baseUrl: PIRAMYD_OPENAI_BASE_URL,
    type: "openai",
    model: targetDefaultModel({ kind: "opencode" }, models, userTier, selectedDefaultModelId)
  };
  config.defaultProvider = "piramyd";
  return JSON.stringify(config, null, 2) + os.EOL;
}

function generateConfig(target, apiKey, catalog) {
  const models = catalog.models || catalog;
  const tier = catalog.tier || "free";
  const selectedDefaultModelId = String(catalog.defaultModelId || "").trim();

  let next;
  if (target.kind === "kimi") next = updateKimiConfig(target.path, apiKey, models, tier, selectedDefaultModelId);
  if (target.kind === "openclaw") next = updateOpenClawConfig(target.path, apiKey, models, tier, selectedDefaultModelId);
  if (target.kind === "codex") next = updateCodexConfig(target.path, models, selectedDefaultModelId);
  if (target.kind === "claude") next = updateClaudeConfig(target.path, apiKey, models, tier, selectedDefaultModelId);
  if (target.kind === "gemini") next = updateGeminiConfig(target.path, apiKey);
  if (target.kind === "qwen") next = updateQwenConfig(target.path, apiKey, models, tier, selectedDefaultModelId);
  if (target.kind === "opencode") next = updateOpenCodeConfig(target.path, apiKey, models, tier, selectedDefaultModelId);

  if (typeof next !== "string") throw new Error(`Unsupported target kind: ${target.kind}`);

  const result = { config: next, files: [{ path: target.path, content: next }] };
  if (target.kind === "codex") {
    const secretContent = renderCodexSecretFile(apiKey);
    const launcherContent = renderCodexLauncher(target.binaryPath);
    result.files.push({ path: CODEX_SECRET_PATH, content: secretContent, mode: 0o600 });
    result.files.push({ path: CODEX_LAUNCHER_PATH, content: launcherContent, mode: 0o755 });
  }
  return result;
}

function writeConfig(target, apiKey, catalog, options = {}) {
  const { dryRun = false } = options;
  const generated = generateConfig(target, apiKey, catalog);

  if (dryRun) {
    return { backups: [], artifacts: [], preview: generated };
  }

  const backups = [];
  backupIfPresent(target.path, backups);
  writeFileWithMode(target.path, generated.config);

  const artifacts = [];
  if (target.kind === "codex") {
    backupIfPresent(CODEX_SECRET_PATH, backups);
    backupIfPresent(CODEX_LAUNCHER_PATH, backups);
    for (const file of generated.files.slice(1)) {
      writeFileWithMode(file.path, file.content, file.mode);
      artifacts.push(file.path);
    }
  }

  return { backups, artifacts };
}

module.exports = {
  targetBaseUrl, targetDefaultModel, generateConfig, writeConfig
};
