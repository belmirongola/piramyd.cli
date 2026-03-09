#!/usr/bin/env node
/*
Interactive Piramyd onboarding for OpenClaw, Kimi Code, Codex, and Claude Code.
Usage: npx piramyd
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const readline = require("node:readline/promises");

const PIRAMYD_ROOT_URL = "https://api.piramyd.cloud";
const PIRAMYD_OPENAI_BASE_URL = `${PIRAMYD_ROOT_URL}/v1`;
const PIRAMYD_ANTHROPIC_BASE_URL = PIRAMYD_ROOT_URL;
const DEFAULT_MODEL_ID = "gpt-5.3-codex-thinking-mid";
const DEFAULT_MODEL = `piramyd/${DEFAULT_MODEL_ID}`;
const CODEX_PROFILE = "piramyd";
const GENERATED_START = "# >>> piramyd-onboard:start";
const GENERATED_END = "# <<< piramyd-onboard:end";
const POSIX_LOCAL_BIN = path.resolve(os.homedir(), ".local/bin");
const CODEX_SECRET_PATH = path.resolve(os.homedir(), ".codex/piramyd.env");
const CODEX_LAUNCHER_PATH = path.resolve(POSIX_LOCAL_BIN, "codex-piramyd");

const UI = {
  ansi: Boolean(process.stdout.isTTY && process.env.NO_COLOR !== "1" && process.env.TERM !== "dumb"),
  interactive: Boolean(process.stdout.isTTY && process.stdin.isTTY),
  width: () => {
    const value = Number(process.stdout.columns || 100);
    return Math.min(108, Math.max(78, value));
  },
  color(code, text) {
    return this.ansi ? `\x1b[${code}m${text}\x1b[0m` : text;
  },
  brand(text) {
    return this.color("38;5;221", text);
  },
  cyan(text) {
    return this.color("38;5;45", text);
  },
  blue(text) {
    return this.color("38;5;39", text);
  },
  green(text) {
    return this.color("38;5;84", text);
  },
  red(text) {
    return this.color("38;5;203", text);
  },
  yellow(text) {
    return this.color("38;5;220", text);
  },
  dim(text) {
    return this.color("2", text);
  },
  bold(text) {
    return this.color("1", text);
  },
  clear() {
    if (this.interactive) console.clear();
  },
};

const BRAND_BANNER = [
  "    ____  _                                  __",
  "   / __ \\(_)____________ _____ ___  __  ____/ /",
  "  / /_/ / / ___/ ___/ __ `/ __ `__ \\/ / / / __/",
  " / ____/ / /  / /  / /_/ / / / / / / /_/ / /_  ",
  "/_/   /_/_/  /_/   \\__,_/_/ /_/ /_/\\__, /\\__/  ",
  "                                  /____/       ",
];

const KNOWN_TARGETS = [
  {
    kind: "codex",
    label: "Codex CLI",
    summary: "Create a Piramyd launcher, store a dedicated profile, and keep the API key in a locked env file.",
    path: path.resolve(os.homedir(), ".codex/config.toml"),
    binaryName: "codex",
    allowCreate: true,
  },
  {
    kind: "claude",
    label: "Claude Code",
    summary: "Patch ~/.claude/settings.json to use Piramyd's Anthropic-compatible gateway and Claude aliases.",
    path: path.resolve(os.homedir(), ".claude/settings.json"),
    binaryName: "claude",
    allowCreate: true,
  },
  {
    kind: "kimi",
    label: "Kimi Code",
    summary: "Patch ~/.kimi/config.toml and preserve native Kimi blocks.",
    path: path.resolve(os.homedir(), ".kimi/config.toml"),
  },
  {
    kind: "openclaw",
    label: "OpenClaw",
    summary: "Patch ~/.openclaw/openclaw.json with Piramyd provider models.",
    path: path.resolve(os.homedir(), ".openclaw/openclaw.json"),
  },
  {
    kind: "openclaw",
    label: "OpenClaw",
    summary: "Patch Documents/-/openclaw.json for a standalone OpenClaw install.",
    path: path.resolve(os.homedir(), "Documents/-/openclaw.json"),
  },
  {
    kind: "openclaw",
    label: "OpenClaw",
    summary: "Patch Documents/klin-openclaw/openclaw.json for the custom install.",
    path: path.resolve(os.homedir(), "Documents/klin-openclaw/openclaw.json"),
  },
];

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function existsPath(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommand(binaryName) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = [
    ...pathEntries.map((entry) => path.join(entry, binaryName)),
    path.resolve(os.homedir(), ".npm-global/bin", binaryName),
    path.resolve(os.homedir(), ".local/bin", binaryName),
    path.resolve("/opt/homebrew/bin", binaryName),
    path.resolve("/usr/local/bin", binaryName),
  ];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function aliasFromId(id) {
  return String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .replace(/-+/g, "-");
}

function coercePositiveNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^n\/?a$/i.test(trimmed)) return fallback;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function maskApiKey(apiKey) {
  if (!apiKey) return "";
  if (apiKey.length <= 9) return apiKey;
  return `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value) {
  return String(value).replace(/\x1B\[[0-9;]*m/g, "");
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function truncateMiddle(value, max) {
  const raw = String(value);
  if (raw.length <= max) return raw;
  if (max <= 3) return raw.slice(0, max);
  const head = Math.ceil((max - 3) / 2);
  const tail = Math.floor((max - 3) / 2);
  return `${raw.slice(0, head)}...${raw.slice(raw.length - tail)}`;
}

function wrapPlainLine(value, width) {
  const raw = String(value);
  if (raw.length <= width) return [raw];
  if (!raw.includes(" ")) return [truncateMiddle(raw, width)];

  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word.length <= width ? word : truncateMiddle(word, width);
  }
  if (current) lines.push(current);
  return lines;
}

function padRight(value, width) {
  return `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`;
}

function renderTomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function renderTomlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : renderTomlString(value);
}

function renderTomlArray(values) {
  return `[${values.map(renderTomlString).join(", ")}]`;
}

function renderShellString(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function renderInlineTomlTable(entries) {
  return `{ ${Object.entries(entries)
    .map(([key, value]) => `${renderTomlKey(key)} = ${renderTomlString(value)}`)
    .join(", ")} }`;
}

function normalizeConfigPath(filePath) {
  return path.resolve(filePath.replace(/^~(?=$|\/|\\)/, os.homedir()));
}

function detectConfigKind(filePath) {
  const normalized = normalizeConfigPath(filePath);
  if (normalized.endsWith("settings.json") && normalized.includes(`${path.sep}.claude${path.sep}`)) {
    return "claude";
  }
  if (normalized.endsWith("config.toml") && normalized.includes(`${path.sep}.codex${path.sep}`)) {
    return "codex";
  }
  if (normalized.endsWith(".json")) return "openclaw";
  if (normalized.endsWith(".toml")) return "kimi";
  if (path.basename(normalized) === "openclaw.json") return "openclaw";
  if (path.basename(normalized) === "config.toml" && normalized.includes(`${path.sep}.kimi${path.sep}`)) {
    return "kimi";
  }
  return null;
}

function listAvailableTargets() {
  return KNOWN_TARGETS.flatMap((target) => {
    const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
    const filePresent = exists(target.path);
    const available = target.allowCreate
      ? Boolean(filePresent || binaryPath || existsPath(path.dirname(target.path)))
      : filePresent;
    if (!available) return [];
    return [{ ...target, binaryPath, filePresent }];
  });
}

function borderTone(tone) {
  if (tone === "success") return (text) => UI.green(text);
  if (tone === "warn") return (text) => UI.yellow(text);
  if (tone === "error") return (text) => UI.red(text);
  if (tone === "info") return (text) => UI.cyan(text);
  return (text) => UI.brand(text);
}

function panel(title, lines, tone = "brand") {
  const width = Math.min(UI.width() - 4, 100);
  const expandedLines = lines.flatMap((line) => {
    const raw = String(line);
    return stripAnsi(raw) !== raw ? [truncateMiddle(raw, width - 4)] : wrapPlainLine(raw, width - 4);
  });
  const lineWidth = Math.max(
    40,
    Math.min(
      width - 4,
      Math.max(visibleLength(title), ...expandedLines.map((line) => visibleLength(line)), 40)
    )
  );
  const colorize = borderTone(tone);
  const top = colorize(`+${"-".repeat(lineWidth + 2)}+`);
  const head = colorize(`| ${padRight(title, lineWidth)} |`);
  const body = expandedLines.map((line) => `| ${padRight(truncateMiddle(line, lineWidth), lineWidth)} |`);
  const bottom = colorize(`+${"-".repeat(lineWidth + 2)}+`);
  return [top, head, top, ...body, bottom].join("\n");
}

function banner(subtitle) {
  const lines = [
    ...BRAND_BANNER,
    "",
    "Piramyd onboarding wizard for Codex, Claude Code, Kimi Code, and OpenClaw",
    subtitle,
  ];
  return panel("PIRAMYD", lines, "brand");
}

function renderScreen({ step, title, subtitle, cards = [], footer = [] }) {
  UI.clear();
  const pieces = [
    banner(`Step ${step}/4  ${title}`),
  ];
  if (subtitle) pieces.push(panel("DETAILS", [subtitle], "info"));
  for (const card of cards) pieces.push(card);
  if (footer.length) pieces.push(panel("CONTROLS", footer, "warn"));
  console.log(pieces.join("\n\n"));
}

function printableKey(key) {
  return typeof key === "string" && key.length === 1 && key >= " " && key !== "\u007f";
}

function ctrlCPressed(key) {
  return key === "\u0003";
}

function isArrowUp(key) {
  return key === "\u001b[A" || key === "k";
}

function isArrowDown(key) {
  return key === "\u001b[B" || key === "j";
}

function isEnter(key) {
  return key === "\r" || key === "\n";
}

function isBackspace(key) {
  return key === "\u007f";
}

function withRawMode(work) {
  if (!UI.interactive) return work();

  const stdin = process.stdin;
  const previousRaw = Boolean(stdin.isRaw);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return Promise.resolve()
    .then(work)
    .finally(() => {
      if (stdin.isTTY) stdin.setRawMode(previousRaw);
      stdin.pause();
    });
}

function readKey() {
  return new Promise((resolve) => {
    const onData = (chunk) => {
      process.stdin.off("data", onData);
      resolve(String(chunk));
    };
    process.stdin.on("data", onData);
  });
}

async function askLine(question, placeholder) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const suffix = placeholder ? ` ${placeholder}` : "";
    return (await rl.question(`${question}${suffix}: `)).trim();
  } finally {
    rl.close();
  }
}

async function selectMenu(options) {
  const { step, title, subtitle, items, footer, extraCards = [] } = options;
  if (!UI.interactive) return null;

  return withRawMode(async () => {
    let index = 0;

    while (true) {
      const lines = items.map((item, itemIndex) => {
        const prefix = itemIndex === index ? UI.brand(">") : " ";
        const label = itemIndex === index ? UI.bold(item.label) : item.label;
        return `${prefix} ${label}`;
      });
      const detailLines = items.map((item, itemIndex) =>
        itemIndex === index ? `  ${item.description}` : `  ${item.description}`
      );
      renderScreen({
        step,
        title,
        subtitle,
        cards: [
          ...extraCards,
          panel("OPTIONS", lines, "brand"),
          panel("SELECTION", detailLines[index] ? [items[index].description, items[index].path || ""].filter(Boolean) : [], "info"),
        ],
        footer,
      });

      const key = await readKey();
      if (ctrlCPressed(key)) throw new Error("cancelled");
      if (isArrowUp(key)) {
        index = (index - 1 + items.length) % items.length;
        continue;
      }
      if (isArrowDown(key)) {
        index = (index + 1) % items.length;
        continue;
      }
      if (isEnter(key)) return items[index].value;
    }
  });
}

async function chooseConfigPlain(targets) {
  console.log(panel("PIRAMYD", ["Interactive onboarding wizard", "Choose the CLI config to patch."], "brand"));
  targets.forEach((target, index) => {
    console.log(`  ${index + 1}. [${target.label}] ${target.path}`);
  });
  console.log("  c. Custom config path");

  while (true) {
    const answer = (await askLine(`Select [1-${targets.length}] or c (default 1)`)).trim();
    if (!answer) return targets[0];
    if (/^c$/i.test(answer)) {
      return askCustomConfig();
    }
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= targets.length) return targets[index - 1];
    console.log(UI.red("Invalid selection. Try again."));
  }
}

async function askCustomConfig() {
  while (true) {
    const customPath = normalizeConfigPath(
      await askLine("Config path (.json/.toml for supported CLI configs)")
    );
    const kind = detectConfigKind(customPath);
    if (!kind) {
      console.log(UI.red("Unsupported config path. Use a Codex, Claude, Kimi, or OpenClaw config file."));
      continue;
    }
    if (!exists(customPath) && !["codex", "claude"].includes(kind)) {
      console.log(UI.red("File not found. Try again."));
      continue;
    }
    const labels = {
      codex: "Codex CLI",
      claude: "Claude Code",
      kimi: "Kimi Code",
      openclaw: "OpenClaw",
    };
    return {
      kind,
      label: labels[kind] || "Custom Target",
      summary: "Custom config path",
      path: customPath,
    };
  }
}

async function chooseConfig(targets) {
  if (!UI.interactive) return chooseConfigPlain(targets);

  const choice = await selectMenu({
    step: 1,
    title: "Choose Target",
    subtitle: "Pick the CLI instance that should be customized for Piramyd.",
    items: [
      ...targets.map((target) => ({
        label: `[${target.label}] ${truncateMiddle(target.path, 72)}`,
        description: target.summary,
        path: target.path,
        value: target,
      })),
      {
        label: "Custom config path",
        description: "Point the wizard at another supported Codex, Claude, Kimi, or OpenClaw config file.",
        value: "__custom__",
      },
    ],
    footer: ["Use arrow keys to move.", "Press Enter to continue.", "Press Ctrl+C to abort."],
  });
  if (choice === "__custom__") return askCustomConfig();
  return choice;
}

function parseTomlSections(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      if (current) sections.push(current);
      current = { header: match[1], lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

function getExistingApiKey(target) {
  try {
    if (target.kind === "claude") {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      return String(config.env?.ANTHROPIC_AUTH_TOKEN || "").trim();
    }
    if (target.kind === "codex") {
      if (!exists(CODEX_SECRET_PATH)) return "";
      const raw = fs.readFileSync(CODEX_SECRET_PATH, "utf8");
      const match = raw.match(/^\s*OPENAI_API_KEY=(.+)\s*$/m);
      if (!match) return "";
      return String(match[1]).trim().replace(/^['"]|['"]$/g, "");
    }
    if (target.kind === "openclaw") {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      return String(config.models?.providers?.piramyd?.apiKey || "").trim();
    }
    const raw = fs.readFileSync(target.path, "utf8");
    const { sections } = parseTomlSections(raw);
    const provider = sections.find((section) => section.header === "providers.piramyd");
    if (!provider) return "";
    for (const line of provider.lines.slice(1)) {
      const match = line.match(/^\s*api_key\s*=\s*"([^"]*)"/);
      if (match) return match[1].trim();
    }
  } catch {}
  return "";
}

function findReusableApiKey(targets, selectedTarget) {
  const ordered = [selectedTarget, ...targets.filter((target) => target.path !== selectedTarget.path)];
  for (const target of ordered) {
    const apiKey = getExistingApiKey(target);
    if (apiKey.startsWith("sk-")) return apiKey;
  }
  return "";
}

async function promptApiKeyPlain(existingApiKey) {
  while (true) {
    const hint = existingApiKey ? ` [Enter to reuse ${maskApiKey(existingApiKey)}]` : "";
    const answer = (await askLine(`Piramyd API key${hint}`)).trim();
    if (!answer && existingApiKey) return existingApiKey;
    if (answer.startsWith("sk-")) return answer;
    console.log(UI.red("API key must start with sk-"));
  }
}

async function promptSecretInteractive(existingApiKey) {
  return withRawMode(async () => {
    let buffer = "";
    let message = existingApiKey
      ? `Press Enter to reuse ${maskApiKey(existingApiKey)} or paste a new key.`
      : "Paste the Piramyd key. Input is hidden on screen.";

    while (true) {
      const masked = buffer ? "*".repeat(Math.min(buffer.length, 48)) : existingApiKey ? `[reuse ${maskApiKey(existingApiKey)}]` : "";
      renderScreen({
        step: 2,
        title: "Authenticate",
        subtitle: "Add the Piramyd API key. The wizard never echoes the raw secret back to the screen.",
        cards: [
          panel("API KEY", [message, "", `Input: ${masked}`], "brand"),
        ],
        footer: ["Paste the key directly.", "Backspace deletes characters.", "Enter accepts the current value."],
      });

      const key = await readKey();
      if (ctrlCPressed(key)) throw new Error("cancelled");
      if (isEnter(key)) {
        const result = buffer || existingApiKey;
        if (result && result.startsWith("sk-")) return result;
        message = "API key must start with sk-.";
        continue;
      }
      if (isBackspace(key)) {
        buffer = buffer.slice(0, -1);
        continue;
      }
      if (printableKey(key)) {
        buffer += key;
      }
    }
  });
}

async function promptApiKey(existingApiKey) {
  if (!UI.interactive) return promptApiKeyPlain(existingApiKey);
  return promptSecretInteractive(existingApiKey);
}

async function fetchModels(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${PIRAMYD_OPENAI_BASE_URL}/models`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "piramyd-kimi-onboard/4.0",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`status ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body).data || []);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const id = String(entry.id || "").trim();
  if (!id) return null;

  const input = Array.isArray(entry.input)
    ? entry.input.map((item) => String(item).toLowerCase())
    : [];
  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.map((item) => String(item).toLowerCase())
    : [];

  const hasVision = input.includes("image") || capabilities.includes("vision");
  const hasVideo = input.includes("video") || capabilities.some((cap) => cap.includes("video"));
  const reasoning =
    Boolean(entry.reasoning) ||
    capabilities.includes("reasoning") ||
    /thinking|reason/i.test(id);

  return {
    id,
    name: String(entry.name || id),
    reasoning,
    input: hasVideo ? ["text", "image", "video"] : hasVision ? ["text", "image"] : ["text"],
    contextWindow: coercePositiveNumber(entry.contextWindow ?? entry.context_window ?? entry.context_length, 256000),
    maxTokens: coercePositiveNumber(entry.maxTokens ?? entry.max_output_tokens, 32768),
  };
}

function sanitizeCatalog(catalog) {
  const seen = new Set();
  const models = [];
  for (const entry of catalog || []) {
    const model = normalizeCatalogEntry(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

function loadLocalCatalog() {
  for (const target of KNOWN_TARGETS) {
    if (target.kind !== "openclaw" || !exists(target.path)) continue;
    try {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      const models = sanitizeCatalog(config.models?.providers?.piramyd?.models || []);
      if (models.length) return { source: target.path, sourceType: "local-cache", models };
    } catch {}
  }
  return null;
}

async function loadCatalog(apiKey) {
  try {
    const remote = sanitizeCatalog(await fetchModels(apiKey));
    if (!remote.length) throw new Error("empty catalog");
    return { source: `${PIRAMYD_OPENAI_BASE_URL}/models`, sourceType: "remote", models: remote };
  } catch (err) {
    const fallback = loadLocalCatalog();
    if (!fallback) throw err;
    return {
      ...fallback,
      warning: `Remote catalog unavailable (${err.message}). Using local Piramyd cache instead.`,
    };
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

function chooseFirstCatalogMatch(models, preferredIds, matcher) {
  const exact = preferredIds
    .map((id) => models.find((model) => model.id.toLowerCase() === id.toLowerCase()))
    .find(Boolean);
  if (exact) return exact.id;
  const fuzzy = models.find((model) => matcher(model.id.toLowerCase()));
  return fuzzy ? fuzzy.id : "";
}

function pickClaudeModelSet(models) {
  const sonnet = chooseFirstCatalogMatch(
    models,
    ["claude-sonnet-4.6", "claude-sonnet-4-6", "claude-sonnet-4.5", "claude-sonnet-4-5"],
    (id) => id.includes("claude-sonnet")
  );
  const opus = chooseFirstCatalogMatch(
    models,
    ["claude-opus-4.6", "claude-opus-4-6", "claude-opus-4.5", "claude-opus-4-5"],
    (id) => id.includes("claude-opus")
  );
  const haiku = chooseFirstCatalogMatch(
    models,
    ["claude-haiku-4.5", "claude-haiku-4-5", "claude-haiku-4.0", "claude-haiku-4-0"],
    (id) => id.includes("claude-haiku")
  );
  return {
    default: sonnet || opus || haiku || "",
    opus,
    sonnet,
    haiku,
  };
}

function targetBaseUrl(target) {
  return target.kind === "claude" ? PIRAMYD_ANTHROPIC_BASE_URL : PIRAMYD_OPENAI_BASE_URL;
}

function targetDefaultModel(target, models) {
  if (target.kind === "claude") return pickClaudeModelSet(models).default || "manual selection";
  if (target.kind === "codex") return DEFAULT_MODEL_ID;
  return DEFAULT_MODEL;
}

function updateOpenClawConfig(filePath, apiKey, catalog) {
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
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
    models: catalog.map(toOpenClawModelEntry),
  };

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = { primary: DEFAULT_MODEL };

  const retainedModels = Object.fromEntries(
    Object.entries(config.agents.defaults.models || {}).filter(([key]) => !key.startsWith("piramyd/"))
  );
  for (const model of catalog) {
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

function upsertTopLevelSetting(lines, key, value) {
  const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`);
  let replaced = false;
  const updated = lines.map((line) => {
    if (matcher.test(line)) {
      replaced = true;
      return `${key} = ${value}`;
    }
    return line;
  });
  if (replaced) return updated;

  let insertAt = updated.length;
  while (insertAt > 0 && updated[insertAt - 1].trim() === "") insertAt -= 1;
  updated.splice(insertAt, 0, `${key} = ${value}`);
  return updated;
}

function trimBoundaryBlankLines(lines) {
  const copy = [...lines];
  while (copy.length && copy[0].trim() === "") copy.shift();
  while (copy.length && copy[copy.length - 1].trim() === "") copy.pop();
  return copy;
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

function updateKimiConfig(filePath, apiKey, catalog) {
  const raw = stripGeneratedBlock(fs.readFileSync(filePath, "utf8"));
  const { preamble, sections } = parseTomlSections(raw);
  const retainedSections = sections.filter((section) => !shouldDropKimiSection(section.header));

  let updatedPreamble = upsertTopLevelSetting(preamble, "default_model", renderTomlString(DEFAULT_MODEL));
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
  chunks.push(renderKimiGeneratedBlock(apiKey, catalog));
  return chunks.filter(Boolean).join("\n\n") + "\n";
}

function renderCodexGeneratedBlock() {
  return [
    GENERATED_START,
    "# Piramyd launcher profile. The wrapper injects OPENAI_BASE_URL and OPENAI_API_KEY.",
    `[profiles.${CODEX_PROFILE}]`,
    'model_provider = "openai"',
    `model = ${renderTomlString(DEFAULT_MODEL_ID)}`,
    GENERATED_END,
  ].join("\n");
}

function shouldDropCodexSection(header) {
  return header === `profiles.${CODEX_PROFILE}`;
}

function updateCodexConfig(filePath) {
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
  chunks.push(renderCodexGeneratedBlock());
  return chunks.filter(Boolean).join("\n\n") + "\n";
}

function renderCodexSecretFile(apiKey) {
  return [
    `OPENAI_API_KEY=${renderShellString(apiKey.trim())}`,
    `OPENAI_BASE_URL=${renderShellString(PIRAMYD_OPENAI_BASE_URL)}`,
    "",
  ].join("\n");
}

function renderCodexLauncher(binaryPath) {
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
    'use_profile=1',
    'prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "model" ] || [ "$prev" = "profile" ]; then',
    '    use_profile=0',
    '    prev=""',
    "    continue",
    "  fi",
    '  case "$arg" in',
    '    -m|--model) use_profile=0; prev="model" ;;',
    '    -p|--profile) use_profile=0; prev="profile" ;;',
    "  esac",
    "done",
    'if [ "$use_profile" -eq 1 ]; then',
    `  exec "$CODEX_BIN" -p ${CODEX_PROFILE} "$@"`,
    "fi",
    'exec "$CODEX_BIN" "$@"',
    "",
  ].join("\n");
}

function updateClaudeConfig(filePath, apiKey, catalog) {
  const existing = exists(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : {};
  const config = typeof existing === "object" && existing ? existing : {};
  const env = typeof config.env === "object" && config.env ? config.env : {};
  const selected = pickClaudeModelSet(catalog);

  env.ANTHROPIC_BASE_URL = PIRAMYD_ANTHROPIC_BASE_URL;
  env.ANTHROPIC_AUTH_TOKEN = apiKey.trim();
  if (selected.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = selected.opus;
  if (selected.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = selected.sonnet;
  if (selected.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selected.haiku;

  config.env = env;
  if (!config.model && selected.default) config.model = selected.default;

  return JSON.stringify(config, null, 2) + os.EOL;
}

function fallbackBackupPath(filePath) {
  const safeName = filePath.replace(/[\\/]/g, "_").replace(/^_+/, "");
  return path.resolve(os.tmpdir(), "piramyd-onboard-backups", `${safeName}.bak.${Date.now()}`);
}

function backupIfPresent(filePath, backups) {
  if (!exists(filePath)) return null;
  const original = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  let backup = `${filePath}.bak.${Date.now()}`;
  try {
    ensureParentDir(backup);
    fs.writeFileSync(backup, original);
    fs.chmodSync(backup, stats.mode);
  } catch {
    backup = fallbackBackupPath(filePath);
    ensureParentDir(backup);
    fs.writeFileSync(backup, original);
    fs.chmodSync(backup, stats.mode);
  }
  backups.push(backup);
  return backup;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFileWithMode(filePath, contents, mode) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, contents, "utf8");
  if (typeof mode === "number") fs.chmodSync(filePath, mode);
}

function writeConfig(target, apiKey, catalog) {
  const backups = [];
  backupIfPresent(target.path, backups);

  let next;
  if (target.kind === "kimi") next = updateKimiConfig(target.path, apiKey, catalog);
  if (target.kind === "openclaw") next = updateOpenClawConfig(target.path, apiKey, catalog);
  if (target.kind === "codex") next = updateCodexConfig(target.path);
  if (target.kind === "claude") next = updateClaudeConfig(target.path, apiKey, catalog);

  if (typeof next !== "string") throw new Error(`Unsupported target kind: ${target.kind}`);
  writeFileWithMode(target.path, next);

  const artifacts = [];
  if (target.kind === "codex") {
    backupIfPresent(CODEX_SECRET_PATH, backups);
    backupIfPresent(CODEX_LAUNCHER_PATH, backups);
    writeFileWithMode(CODEX_SECRET_PATH, renderCodexSecretFile(apiKey), 0o600);
    writeFileWithMode(CODEX_LAUNCHER_PATH, renderCodexLauncher(target.binaryPath), 0o755);
    artifacts.push(CODEX_SECRET_PATH, CODEX_LAUNCHER_PATH);
  }

  return { backups, artifacts };
}

async function confirmPlan(plan) {
  const lines = [
    `Target      ${plan.target.label}`,
    `Config      ${plan.target.path}`,
    `Provider    ${targetBaseUrl(plan.target)}`,
    `Default     ${targetDefaultModel(plan.target, plan.catalog.models)}`,
    `API key     ${maskApiKey(plan.apiKey)}`,
    `Catalog     ${plan.catalog.models.length} models from ${plan.catalog.sourceType}`,
    `Source      ${plan.catalog.source}`,
  ];
  if (plan.target.kind === "codex") lines.push(`Launcher    ${CODEX_LAUNCHER_PATH}`);

  if (!UI.interactive) {
    console.log(panel("PLAN", lines, "info"));
    return true;
  }

  const selection = await selectMenu({
    step: 3,
    title: "Review Plan",
    subtitle: "Inspect the target and confirm the write operation.",
    extraCards: [panel("PLAN", lines, "info")],
    items: [
      {
        label: "Apply configuration",
        description: "Create a backup, write the Piramyd provider, and refresh the catalog.",
        value: true,
      },
      {
        label: "Cancel",
        description: "Abort without changing the selected config file.",
        value: false,
      },
    ],
    footer: ["Review the plan details above.", "Press Enter to confirm the selected action."],
  });

  renderScreen({
    step: 3,
    title: "Review Plan",
    subtitle: "Configuration summary",
    cards: [
      panel("PLAN", lines, "info"),
      panel("ACTION", [selection ? "Apply configuration" : "Cancel"], selection ? "success" : "warn"),
    ],
    footer: ["Press Enter to continue."],
  });
  if (UI.interactive) {
    await withRawMode(async () => {
      while (true) {
        const key = await readKey();
        if (ctrlCPressed(key)) throw new Error("cancelled");
        if (isEnter(key)) return;
      }
    });
  }
  return selection;
}

function showProgress(step, title, lines, tone = "info") {
  if (UI.interactive) {
    renderScreen({
      step,
      title,
      subtitle: lines[0] || "",
      cards: [panel("STATUS", lines, tone)],
      footer: ["Please wait..."],
    });
    return;
  }
  console.log(panel(title, lines, tone));
}

function showSuccess(result) {
  let command = "Run `openclaw models list`.";
  if (result.target.kind === "kimi") command = "Run `kimi` and then `/model`.";
  if (result.target.kind === "codex") command = "Run `codex-piramyd` and then `/model`.";
  if (result.target.kind === "claude") command = "Run `claude` and then `/model`.";

  const lines = [
    `Target      ${result.target.label}`,
    `Config      ${result.target.path}`,
    `Backups     ${result.backups.length ? result.backups.length : "new file"}`,
    `Default     ${targetDefaultModel(result.target, result.catalog.models)}`,
    `Models      ${result.catalog.models.length}`,
    `Catalog     ${result.catalog.sourceType}`,
    command,
  ];

  if (result.backups.length) lines.push(...result.backups.map((backup) => `Backup      ${backup}`));
  if (result.artifacts.length) lines.push(...result.artifacts.map((artifact) => `Artifact    ${artifact}`));
  if (result.catalog.warning) lines.push(result.catalog.warning);
  if (result.target.kind === "codex") {
    lines.push("Bare `codex` is unchanged. Use `codex-piramyd` for the Piramyd route.");
  }
  UI.clear();
  console.log(panel("SUCCESS", lines, "success"));
}

async function main() {
  const targets = listAvailableTargets();
  if (!targets.length) throw new Error("no supported Codex, Claude, Kimi, or OpenClaw targets found");

  const selected = await chooseConfig(targets);
  const existingApiKey = findReusableApiKey(targets, selected);
  const apiKey = await promptApiKey(existingApiKey);

  showProgress(3, "Load Catalog", [
    "Connecting to Piramyd and preparing the catalog.",
    "If the network is blocked, the wizard will fall back to the local cache.",
  ]);
  const catalog = await loadCatalog(apiKey);
  if (!catalog.models.length) throw new Error("empty catalog");

  const shouldApply = await confirmPlan({ target: selected, apiKey, catalog });
  if (!shouldApply) {
    UI.clear();
    console.log(panel("CANCELLED", ["No files were changed."], "warn"));
    return;
  }

  showProgress(4, "Write Config", [
    `Writing ${selected.kind === "kimi" || selected.kind === "codex" ? "TOML" : "JSON"} configuration for ${selected.label}.`,
    "A timestamped backup is created before writing.",
  ]);
  const writeResult = writeConfig(selected, apiKey, catalog.models);

  showSuccess({ target: selected, catalog, ...writeResult });
}

main().catch((err) => {
  UI.clear();
  console.error(panel("ERROR", [err.message || String(err)], "error"));
  process.exit(1);
});
