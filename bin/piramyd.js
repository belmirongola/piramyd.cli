#!/usr/bin/env node
const p = require("@clack/prompts");
const pc = require("picocolors");
const path = require("path");
const readline = require("readline");
const {
  CODEX_LAUNCHER_PATH,
  CLAUDE_LAUNCHER_PATH,
} = require("../src/constants");
const { normalizeConfigPath, detectConfigKind, exists, listAvailableTargets, truncateMiddle, maskApiKey, padRight } = require("../src/utils");
const { loadCatalog } = require("../src/catalog");
const { targetBaseUrl, targetDefaultModel, writeConfig, generateConfig } = require("../src/patchers");
const { getExistingApiKey, findReusableApiKey, targetNeedsRepair, codexShimHealth, syncClaudeState } = require("../src/diagnosis");
const { FALLBACK_DEFAULT_MODEL, buildEmergencyCatalog, uniqueModels, applyCatalogSelection, findModelById } = require("../src/emergency-catalog");
const { probeModelsConcurrent } = require("../src/model-probes");

const { version: VERSION } = require("../package.json");

// ── Brand system ────────────────────────────────────────────────
const brand   = (s) => pc.cyan(s);
const accent  = (s) => pc.yellow(s);
const ok      = (s) => pc.green(s);
const muted   = (s) => pc.dim(s);
const em      = (s) => pc.bold(s);

const DIVIDER      = muted("\u2550".repeat(60));
const DIVIDER_THIN = muted("\u2500".repeat(40));
const MODEL_STATUS_WIDTH = 8;
const MODEL_NAME_WIDTH = 34;
const MODEL_LATENCY_WIDTH = 8;
const MODEL_RESPONSE_WIDTH = 26;
const PROBE_PROGRESS_FRAMES = [".", "..", "..."];

function renderModelProbeProgress(completed, total, frameIndex = 0) {
  const frame = PROBE_PROGRESS_FRAMES[frameIndex % PROBE_PROGRESS_FRAMES.length];
  const width = 18;
  const safeTotal = Math.max(1, total);
  const filled = Math.max(0, Math.min(width, Math.round((completed / safeTotal) * width)));
  const bar = `${ok("█".repeat(filled))}${muted("·".repeat(width - filled))}`;
  return `  ${accent(frame)}  ${bar}  ${completed}/${total}`;
}

function updateModelProbeProgress(completed, total, frameIndex = 0) {
  const line = renderModelProbeProgress(completed, total, frameIndex);
  process.stdout.write(`\r${line}`);
}

function clearCurrentTerminalLine() {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

// ── Banners ─────────────────────────────────────────────────────
const BANNER = [
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 ",
  " \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557",
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u255A\u2588\u2588\u2554\u255D  \u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D",
  " \u255A\u2550\u255D     \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u255D ",
].join("\n");

function renderBanner() {
  return [
    "",
    brand(BANNER),
    "",
    `  ${muted("Universal AI Gateway")}  ${muted("\u2502")}  ${em(`v${VERSION}`)}`,
    "",
    DIVIDER,
    "",
  ].join("\n");
}

function renderDoctorBanner() {
  return [
    "",
    accent(BANNER),
    "",
    `  ${accent("Doctor")}  ${muted("\u2502")}  ${muted("Auto-repair for CLI configurations")}`,
    "",
    DIVIDER,
    "",
  ].join("\n");
}

function renderModelsBanner() {
  return [
    "",
    brand(BANNER),
    "",
    `  ${accent("Models")}  ${muted("\u2502")}  ${muted("Realtime model health check")}`,
    "",
    DIVIDER,
    "",
  ].join("\n");
}

function targetLauncherPath(kind) {
  if (kind === "codex") return CODEX_LAUNCHER_PATH;
  if (kind === "claude") return CLAUDE_LAUNCHER_PATH;
  return null;
}

// ── Model selection ─────────────────────────────────────────────
async function askModelDefaultSelection(catalog) {
  if (catalog.sourceType === "local-fallback") {
    p.log.warn(`Using emergency fallback model: ${FALLBACK_DEFAULT_MODEL}`);
    return { defaultModelId: FALLBACK_DEFAULT_MODEL, addedModels: [] };
  }

  const models = uniqueModels(catalog.models || []);
  if (!models.length) {
    return { defaultModelId: FALLBACK_DEFAULT_MODEL, addedModels: [{
      id: FALLBACK_DEFAULT_MODEL,
      name: "Claude Sonnet 4.5",
      reasoning: true,
      input: ["text"],
      contextWindow: 200000,
      maxTokens: 8192,
    }] };
  }

  const tier = String(catalog.tier || "unknown").toUpperCase();
  const ranked = [...models].sort((a, b) => {
    const reasoningDiff = Number(Boolean(b.reasoning)) - Number(Boolean(a.reasoning));
    if (reasoningDiff !== 0) return reasoningDiff;
    const contextDiff = Number(b.contextWindow || 0) - Number(a.contextWindow || 0);
    if (contextDiff !== 0) return contextDiff;
    return String(a.id).localeCompare(String(b.id));
  });
  const topFromApi = ranked.slice(0, 5);
  const defaultByTier = topFromApi[0] || models[0];

  p.log.step(`Top models from catalog ${muted(`(tier ${tier})`)}`);
  for (const model of topFromApi) {
    const isDefault = model.id === defaultByTier.id;
    const badge = model.reasoning ? muted(" reasoning") : "";
    const prefix = isDefault ? ok("\u2192") : muted("\u00B7");
    const name = isDefault ? em(brand(model.id)) : model.id;
    p.log.message(`  ${prefix} ${name}${badge}`);
  }

  const options = models.map((model) => ({
    label: model.id,
    hint: model.name,
    value: model.id,
  }));
  options.push({
    label: "Add model ID manually",
    hint: "Use this if a model is available but not listed in current metadata",
    value: "__manual__",
  });

  const picked = await p.select({
    message: "Choose the default model for this onboarding",
    options,
    initialValue: defaultByTier.id,
  });
  if (p.isCancel(picked)) { p.cancel("Operation cancelled."); process.exit(0); }

  if (picked !== "__manual__") {
    return { defaultModelId: String(picked), addedModels: [] };
  }

  while (true) {
    const manualId = await p.text({
      message: "Enter model ID to add and set as default",
      placeholder: "e.g., gpt-5.4 or claude-sonnet-4.5",
      validate: (value) => {
        const id = String(value || "").trim();
        if (!id) return "Please enter a model ID.";
      }
    });
    if (p.isCancel(manualId)) { p.cancel("Operation cancelled."); process.exit(0); }

    const id = String(manualId || "").trim();
    const existing = findModelById(models, id);
    if (existing) {
      return { defaultModelId: existing.id, addedModels: [] };
    }

    return {
      defaultModelId: id,
      addedModels: [{
        id,
        name: `${id} (manual)`,
        reasoning: false,
        input: ["text"],
        contextWindow: 0,
        maxTokens: 0,
      }],
    };
  }
}

// ── Custom config ───────────────────────────────────────────────
async function askCustomConfig() {
  while (true) {
    const customPath = normalizeConfigPath(
      await p.text({
        message: "Config path (.json/.toml for supported CLI configs)",
        placeholder: "e.g., ~/.config/my-cli/config.toml",
        validate: (value) => {
          if (!value) return "Please enter a valid path.";
        }
      })
    );
    if (p.isCancel(customPath)) { p.cancel('Operation cancelled.'); process.exit(0); }

    const kind = detectConfigKind(customPath);
    if (!kind) {
      p.log.error("Unsupported config path. Use a Codex, Claude, Kimi, OpenClaw, Gemini, Qwen, or OpenCode config file.");
      continue;
    }
    if (!exists(customPath) && !["codex", "claude"].includes(kind)) {
      p.log.error("File not found. Try again.");
      continue;
    }
    const labels = {
      codex: "Codex CLI",
      claude: "Claude Code",
      kimi: "Kimi Code",
      openclaw: "OpenClaw",
      gemini: "Gemini CLI",
      qwen: "Qwen CLI",
      opencode: "OpenCode",
      copilot: "GitHub Copilot CLI",
    };
    return {
      kind,
      label: labels[kind] || "Custom Target",
      summary: "Custom config path",
      path: customPath,
    };
  }
}

// ── Target selection ────────────────────────────────────────────
async function chooseConfig(targets) {
  const options = [
    ...targets.map((target) => ({
      label: target.label,
      hint: truncateMiddle(target.path, 60),
      value: target,
    })),
    {
      label: "Custom config path",
      hint: "Point the wizard at another supported config file.",
      value: "__custom__",
    },
  ];

  const choice = await p.multiselect({
    message: "Choose the CLI instances to configure for Piramyd:",
    options,
    required: true,
  });

  if (p.isCancel(choice)) { p.cancel("Operation cancelled."); process.exit(0); }

  if (choice.includes("__custom__")) {
    const custom = await askCustomConfig();
    return [...choice.filter((c) => c !== "__custom__"), custom];
  }
  return choice;
}

// ── API key prompt ──────────────────────────────────────────────
async function promptApiKey(existingApiKey) {
  if (existingApiKey) {
    p.log.info(`${ok("\u2713")} Found existing key ${accent(maskApiKey(existingApiKey))}`);
  }

  const message = existingApiKey
    ? `Piramyd API key ${muted("(Enter to reuse)")}`
    : "Paste your Piramyd API key (sk-...)";

  while (true) {
    const answer = await p.password({ message });

    if (p.isCancel(answer)) { p.cancel('Operation cancelled.'); process.exit(0); }

    const result = (answer ? answer.trim() : "") || existingApiKey;
    if (result && result.startsWith("sk-")) return result;
    p.log.error("API key must start with sk-.");
  }
}

// ── Plan confirmation ───────────────────────────────────────────
async function confirmPlan(plan) {
  p.log.step(em("Configuration Plan"));

  for (let i = 0; i < plan.targets.length; i++) {
    const target = plan.targets[i];
    const defaultModel = targetDefaultModel(target, plan.catalog.models, plan.catalog.tier, plan.catalog.defaultModelId);
    const launcher = targetLauncherPath(target.kind);

    const lines = [
      `  ${muted("Target")}     ${em(brand(target.label))}`,
      `  ${muted("Binary")}     ${target.binaryPath || muted("custom")}`,
      `  ${muted("Config")}     ${truncateMiddle(target.path, 55)}`,
      `  ${muted("Provider")}   ${targetBaseUrl(target)}`,
      `  ${muted("Default")}    ${ok(defaultModel)}`,
    ];
    if (launcher) lines.push(`  ${muted("Launcher")}   ${launcher}`);

    p.log.message(lines.join("\n"));
    if (i < plan.targets.length - 1) p.log.message(`  ${DIVIDER_THIN}`);
  }

  p.log.message([
    `  ${DIVIDER_THIN}`,
    `  ${muted("API Key")}    ${accent(maskApiKey(plan.apiKey))}`,
    `  ${muted("Tier")}       ${em(plan.catalog.tier.toUpperCase())}`,
    `  ${muted("Models")}     ${plan.catalog.models.length} available`,
    `  ${muted("Default")}    ${ok(plan.catalog.defaultModelId || "(auto)")}`,
    `  ${muted("Source")}     ${plan.catalog.source}`,
  ].join("\n"));

  const apply = await p.confirm({
    message: "Apply configuration? (creates backups before writing)",
    initialValue: true,
  });

  if (p.isCancel(apply)) { p.cancel('Operation cancelled.'); process.exit(0); }
  return apply;
}

// ── Success output ──────────────────────────────────────────────

function targetArchitecture(kind) {
  const isolated = {
    codex: {
      command: "codex-piramyd",
      original: "codex",
      flow: [
        `${brand("codex-piramyd")}`,
        `  ${muted("\u2502")} sources ${accent("~/.codex/piramyd.env")} ${muted("(0600)")}`,
        `  ${muted("\u2502")} sets OPENAI_BASE_URL \u2192 Piramyd gateway`,
        `  ${muted("\u2502")} sets OPENAI_API_KEY from env file`,
        `  ${muted("\u2514\u2500\u2500")} exec ${muted("codex --profile piramyd")}`,
      ],
      security: `API key stored in ${accent("~/.codex/piramyd.env")} ${muted("(mode 0600, only you can read)")}`,
      isolation: `Original ${muted("codex")} is untouched. Piramyd uses a separate profile.`,
    },
    claude: {
      command: "claude-piramyd",
      original: "claude",
      flow: [
        `${brand("claude-piramyd")}`,
        `  ${muted("\u2502")} sources ${accent("~/.claude-piramyd/.env")} ${muted("(0600)")}`,
        `  ${muted("\u2502")} sets CLAUDE_CONFIG_DIR \u2192 ~/.claude-piramyd/`,
        `  ${muted("\u2502")} sets ANTHROPIC_BASE_URL \u2192 Piramyd gateway`,
        `  ${muted("\u2502")} exports ANTHROPIC_API_KEY from env file`,
        `  ${muted("\u2514\u2500\u2500")} exec ${muted("claude")} ${muted("(full features: CLAUDE.md, hooks, memory)")}`,
      ],
      security: `API key stored in ${accent("~/.claude-piramyd/.env")} ${muted("(mode 0600, only you can read)")}`,
      isolation: `Original ${muted("claude")} is untouched. Piramyd uses its own config directory.`,
    },
    copilot: {
      command: "copilot-piramyd",
      original: "copilot",
      flow: [
        `${brand("copilot-piramyd")}`,
        `  ${muted("\u2502")} sources ${accent("~/.copilot/piramyd.env")} ${muted("(0600)")}`,
        `  ${muted("\u2502")} sets COPILOT_PROVIDER_BASE_URL \u2192 Piramyd gateway`,
        `  ${muted("\u2502")} sets COPILOT_PROVIDER_TYPE \u2192 openai`,
        `  ${muted("\u2502")} exports COPILOT_PROVIDER_API_KEY + COPILOT_MODEL`,
        `  ${muted("\u2514\u2500\u2500")} exec ${muted("copilot")}`,
      ],
      security: `Provider key stored in ${accent("~/.copilot/piramyd.env")} ${muted("(mode 0600, only you can read)")}`,
      isolation: `Original ${muted("copilot")} is untouched. Piramyd runs through a dedicated launcher.`,
    },
  };
  const direct = {
    kimi:     { command: "kimi",     file: "~/.kimi/config.toml" },
    openclaw: { command: "openclaw", file: "~/.openclaw/openclaw.json" },
    gemini:   { command: "gemini",   file: "~/.gemini/settings.json" },
    qwen:     { command: "qwen",     file: "~/.qwen/settings.json" },
    opencode: { command: "opencode", file: "~/.opencode/config.json" },
  };
  if (isolated[kind]) return { type: "isolated", ...isolated[kind] };
  if (direct[kind])   return { type: "direct",   ...direct[kind] };
  return null;
}

function showSuccess(result) {
  if (result.catalog.warning) p.log.warn(result.catalog.warning);

  console.log("");
  console.log(DIVIDER);
  console.log(`  ${ok("\u2588\u2588")} ${em("Setup Complete")}  ${muted("\u2502")}  ${result.catalog.models.length} models  ${muted("\u2502")}  tier ${em(String(result.catalog.tier || "free").toUpperCase())}`);
  console.log(DIVIDER);

  // ── Per-target result cards ──
  const isolatedResults = [];
  const directResults = [];

  for (const res of result.results) {
    const arch = targetArchitecture(res.target.kind);
    if (arch && arch.type === "isolated") isolatedResults.push({ res, arch });
    else directResults.push({ res, arch });
  }

  // Isolated targets (launcher-based) — detailed cards
  if (isolatedResults.length) {
    console.log("");
    console.log(`  ${em(brand("\u25C6 Isolated Launchers"))}`);
    console.log(`  ${muted("These CLIs run through a dedicated Piramyd wrapper.")}`);
    console.log(`  ${muted("Your original CLI installations are not modified.")}`);

    for (const { res, arch } of isolatedResults) {
      console.log("");
      console.log(`  ${ok("\u2713")} ${em(res.target.label)}`);
      console.log("");

      // How it works — flow diagram
      console.log(`    ${muted("How it works:")}`);
      for (const line of arch.flow) {
        console.log(`    ${line}`);
      }
      console.log("");

      // Security
      console.log(`    ${muted("\u26BF")} ${arch.security}`);

      // Isolation
      console.log(`    ${muted("\u2139")} ${arch.isolation}`);
      console.log("");

      // Files written
      console.log(`    ${muted("Files:")}`);
      console.log(`      ${muted("config")}    ${res.target.path}`);
      if (res.artifacts && res.artifacts.length) {
        for (const artifact of res.artifacts) {
          const basename = path.basename(artifact);
          const label = basename === ".env" ? "env key" : (basename.includes("piramyd") ? "launcher" : basename);
          console.log(`      ${muted(label.padEnd(10))}${artifact}`);
        }
      }
      if (res.backups && res.backups.length) {
        console.log(`      ${muted("backup")}    ${res.backups[0]}`);
      }

      // Run command — prominent
      console.log("");
      console.log(`    ${em("Run:")}  ${ok("$")} ${brand(arch.command)}`);
    }
  }

  // Direct-patch targets — compact cards
  if (directResults.length) {
    console.log("");
    console.log(`  ${em(brand("\u25C6 Direct Patches"))}`);
    console.log(`  ${muted("These CLIs were patched in-place with Piramyd provider settings.")}`);

    for (const { res, arch } of directResults) {
      console.log("");
      console.log(`  ${ok("\u2713")} ${em(res.target.label)}`);
      const filePath = arch ? arch.file : res.target.path;
      console.log(`    ${muted("Patched")}  ${filePath}`);
      if (res.backups && res.backups.length) {
        console.log(`    ${muted("Backup")}  ${res.backups[0]}`);
      }
      console.log(`    ${em("Run:")}    ${ok("$")} ${brand(arch ? arch.command : res.target.kind)}`);
    }
  }

  // ── Request flow diagram ──
  console.log("");
  console.log(DIVIDER);
  console.log(`  ${em("How requests flow")}`);
  console.log(DIVIDER);
  console.log("");
  console.log(`    ${brand("Your CLI")}  ${muted("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2192")}  ${accent("Piramyd Gateway")}  ${muted("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2192")}  ${em("AI Provider")}`);
  console.log(`    ${muted("(codex, claude, ...)")}      ${muted("api.piramyd.cloud")}          ${muted("(OpenAI, Anthropic, ...)")}`);
  console.log(`                                  ${muted("\u2502")}`);
  console.log(`                        ${muted("routing \u00B7 auth \u00B7 usage tracking")}`);
  console.log("");

  // ── PATH check for launchers ──
  const launcherKinds = result.results
    .filter(r => ["codex", "claude"].includes(r.target.kind))
    .map(r => r.target.kind);

  if (launcherKinds.length) {
    const launcherDir = path.dirname(CODEX_LAUNCHER_PATH);
    const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    if (!pathEntries.includes(launcherDir)) {
      console.log(DIVIDER);
      console.log(`  ${pc.yellow("\u26A0")} ${em("PATH setup needed")}`);
      console.log(DIVIDER);
      console.log("");
      console.log(`  Add ${em(launcherDir)} to your PATH so launchers work globally:`);
      console.log("");
      if (process.platform === "win32") {
        console.log(`    ${ok("$")} ${brand(`setx PATH "%PATH%;${launcherDir}"`)}`);
      } else {
        const shell = process.env.SHELL || "";
        const profileFile = shell.includes("zsh") ? "~/.zshrc" : "~/.bashrc";
        console.log(`    ${ok("$")} ${brand(`echo 'export PATH="${launcherDir}:$PATH"' >> ${profileFile}`)}`);
        console.log(`    ${ok("$")} ${brand(`source ${profileFile}`)}`);
      }
      console.log("");
    }
  }

  console.log(DIVIDER);
}

// ── Doctor mode ─────────────────────────────────────────────────
async function runDoctor() {
  console.clear();
  console.log(renderDoctorBanner());
  p.intro(pc.bgYellow(pc.black(" Piramyd Doctor ")));

  const spinner = p.spinner();
  spinner.start("Scanning for configured CLI instances...");

  const allTargets = listAvailableTargets();
  if (!allTargets.length) {
    spinner.stop("No supported CLI targets found in your PATH.", 1);
    process.exit(1);
  }

  let foundApiKey = "";
  let targetsNeedingRepair = [];

  for (const target of allTargets) {
    const key = getExistingApiKey(target) || findReusableApiKey(allTargets, target);
    if (key && key.startsWith("sk-")) foundApiKey = key;
    if (targetNeedsRepair(target)) targetsNeedingRepair.push(target);
  }

  // Surface CCLI-level shim errors before attributing anything to implementation/key issues
  const shimStatus = codexShimHealth();
  if (!shimStatus.healthy) {
    spinner.stop(pc.yellow("⚠ Codex Node shim has a problem — this is a CCLI-level issue, not a configuration error."));
    p.log.warn([
      `  Shim path: ${accent(require("../src/constants").CODEX_NODE_SHIM_PATH)}`,
      `  Problem:   ${pc.red(shimStatus.error || "unknown error")}`,
      "",
      "  The shim will be regenerated when you proceed with the repair below.",
      `  This is typically caused by a Node.js version incompatibility (${muted("e.g., Node.js v25+ strict quote parsing")}).`,
    ].join("\n"));
  }

  if (targetsNeedingRepair.length === 0) {
    spinner.stop(ok("All targets are correctly configured. Nothing to repair."));
    p.outro(ok("Your setup is healthy."));
    process.exit(0);
  }

  if (!foundApiKey) {
    spinner.stop("Targets need configuration, but no existing Piramyd API key was found.");
    p.cancel("Run `npx piramyd` normally to onboard.");
    process.exit(1);
  }

  const repairList = targetsNeedingRepair.map(t => brand(t.label)).join(muted(", "));
  spinner.stop(`Found ${em(String(targetsNeedingRepair.length))} target(s) needing repair: ${repairList}`);

  const apply = await p.confirm({
    message: `Attempt automatic repair? ${muted(`(using key ending in ...${foundApiKey.slice(-4)})`)}`,
    initialValue: true,
  });

  if (p.isCancel(apply) || !apply) { p.cancel('Operation cancelled.'); process.exit(0); }

  spinner.start("Refreshing catalog from Piramyd...");
  let catalog;
  try {
    catalog = await loadCatalog(foundApiKey);
    if (!catalog.models.length) throw new Error("empty catalog");
    spinner.stop(`Catalog refreshed: ${em(String(catalog.models.length))} models found.`);
  } catch (err) {
    catalog = buildEmergencyCatalog();
    spinner.stop(`Catalog refresh failed ${muted(`(${err.message})`)}. Using fallback.`);
  }

  const results = [];
  spinner.start("Repairing configurations...");
  for (const target of targetsNeedingRepair) {
    spinner.message(`Updating ${brand(target.label)}...`);
    const writeResult = writeConfig(target, foundApiKey, catalog);
    results.push({ target, ...writeResult });
  }
  spinner.stop(ok("Configurations repaired."));

  const includesClaude = allTargets.some((target) => target.kind === "claude");
  let claudeSync = null;
  if (includesClaude) {
    spinner.start("Syncing Claude state into claude-piramyd...");
    claudeSync = syncClaudeState();
    const syncedCount = claudeSync.synced.length;
    const skippedCount = claudeSync.skipped.length;
    spinner.stop(`Claude sync complete: ${em(String(syncedCount))} item(s) synced${skippedCount ? `, ${muted(String(skippedCount))} skipped` : ""}.`);
  }

  showSuccess({ results, catalog });
  if (claudeSync && claudeSync.synced.length) {
    const sample = claudeSync.synced.slice(0, 6).join(muted(", "));
    p.log.step(`Claude shared state synced: ${sample}${claudeSync.synced.length > 6 ? muted(", ...") : ""}`);
  }
  p.outro(ok("Doctor completed successfully!"));
}

async function promptModelsApiKey(existingApiKey) {
  const value = await p.password({
    message: existingApiKey
      ? `Piramyd API key ${muted("(Enter to reuse)")}`
      : "Paste your Piramyd API key (sk-...)",
    mask: "*",
    validate(input) {
      const candidate = String(input || existingApiKey || "").trim();
      if (!candidate.startsWith("sk-")) return "Provide a valid Piramyd API key.";
      return undefined;
    },
  });

  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return String(value || existingApiKey || "").trim();
}

function showModelProbeResults(catalog, results) {
  const upCount = results.filter((result) => result.ok).length;
  const downCount = results.length - upCount;

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Models checked:")} ${results.length}  ${ok(String(upCount))} up  ${pc.red(String(downCount))} down`);
  console.log(DIVIDER);
  console.log("");
}

function formatModelProbeRow(catalog, result) {
  const model = catalog.models.find((entry) => entry.id === result.modelId);
  const status = result.ok ? ok("● UP") : pc.red("● DOWN");
  const latency = result.latencyMs ? `${result.latencyMs}ms` : "-";
  const name = model ? model.id : result.modelId;
  const paddedStatus = padRight(status, MODEL_STATUS_WIDTH);
  const paddedName = padRight(truncateMiddle(name, MODEL_NAME_WIDTH), MODEL_NAME_WIDTH);
  const paddedLatency = padRight(truncateMiddle(latency, MODEL_LATENCY_WIDTH), MODEL_LATENCY_WIDTH);
  const detailText = truncateMiddle(String(result.message || "failed"), MODEL_RESPONSE_WIDTH);
  const paddedDetails = result.ok
    ? padRight(muted(detailText), MODEL_RESPONSE_WIDTH)
    : padRight(pc.red(detailText), MODEL_RESPONSE_WIDTH);
  return `  ${paddedStatus} ${paddedName} ${paddedLatency} ${paddedDetails}`;
}

function renderModelProbeHeader() {
  return `  ${padRight(muted("Status"), MODEL_STATUS_WIDTH)} ${padRight(muted("Model"), MODEL_NAME_WIDTH)} ${padRight(muted("Latency"), MODEL_LATENCY_WIDTH)} ${padRight(muted("Response"), MODEL_RESPONSE_WIDTH)}`;
}

async function runModels() {
  console.clear();
  console.log(renderModelsBanner());
  p.intro(pc.bgGreen(pc.black(" Piramyd Models ")));

  const targets = listAvailableTargets();
  const existingApiKey = targets.length ? findReusableApiKey(targets, targets[0]) : "";
  const apiKey = await promptModelsApiKey(existingApiKey);

  const spinner = p.spinner();
  spinner.start("Loading model catalog from Piramyd...");

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${String(catalog.tier || "unknown").toUpperCase()})`)}`);
  } catch (error) {
    spinner.stop(`Catalog load failed ${muted(`(${error.message})`)}`);
    process.exit(1);
  }

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Probing:")} ${catalog.models.length} models with concurrency ${em("4")}`);
  console.log(DIVIDER);
  console.log("");
  let progressFrame = 0;
  updateModelProbeProgress(0, catalog.models.length, progressFrame);
  console.log("");
  console.log(renderModelProbeHeader());
  console.log("");

  let completed = 0;
  const results = await probeModelsConcurrent(apiKey, catalog.models, {
    concurrency: 4,
    onResult(result) {
      completed += 1;
      progressFrame += 1;
      clearCurrentTerminalLine();
      console.log(formatModelProbeRow(catalog, result));
      updateModelProbeProgress(completed, catalog.models.length, progressFrame);
    },
  });

  console.log("");

  showModelProbeResults(catalog, results);
  p.outro(ok("Model check completed."));
}

// ── Main wizard ─────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  if (args.includes("--help") || args.includes("-h")) {
    console.log([
      "",
      brand(BANNER),
      "",
      `  ${muted("Universal AI Gateway")}  ${muted("\u2502")}  ${em(`v${VERSION}`)}`,
      "",
      `  ${em("Usage:")}   piramyd [command] [options]`,
      "",
      `  ${em("Commands:")}`,
      `    ${muted("(default)")}     Interactive onboarding wizard`,
      `    ${muted("doctor")}        Auto-detect and repair broken configurations`,
      `    ${muted("models")}        Realtime health check for all models in your tier`,
      "",
      `  ${em("Options:")}`,
      `    ${muted("--dry-run")}     Preview changes without writing any files`,
      `    ${muted("--help, -h")}    Show this help message`,
      "",
    ].join("\n"));
    process.exit(0);
  }

  if (args.includes("doctor")) {
    return runDoctor();
  }

  if (args.includes("models")) {
    return runModels();
  }

  console.clear();
  console.log(renderBanner());
  p.intro(pc.bgCyan(pc.black(" CLI Onboarding ")));

  const targets = listAvailableTargets();
  if (!targets.length) {
    p.cancel("No supported CLI targets found in your PATH.");
    process.exit(1);
  }

  const selectedTargets = await chooseConfig(targets);
  const existingApiKey = findReusableApiKey(targets, selectedTargets[0]);
  const apiKey = await promptApiKey(existingApiKey);

  const spinner = p.spinner();
  spinner.start("Connecting to Piramyd...");

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    if (!catalog.models.length) throw new Error("empty catalog");
    spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${catalog.tier.toUpperCase()})`)}`);
  } catch (err) {
    catalog = buildEmergencyCatalog();
    spinner.stop(`Catalog failed ${muted(`(${err.message})`)}. Using fallback.`);
  }

  const modelSelection = await askModelDefaultSelection(catalog);
  catalog = applyCatalogSelection(catalog, modelSelection.defaultModelId, modelSelection.addedModels);

  const shouldApply = await confirmPlan({ targets: selectedTargets, apiKey, catalog });
  if (!shouldApply) {
    p.cancel("No files were changed.");
    process.exit(0);
  }

  if (isDryRun) {
    p.log.step(brand("Dry-run mode \u2014 no files will be written."));
    for (const target of selectedTargets) {
      const preview = generateConfig(target, apiKey, catalog);
      p.log.message(`\n${em(`\u2500\u2500 ${target.label} (${target.path}):`)}`);
      for (const file of preview.files) {
        const label = file.path === target.path ? "config" : path.basename(file.path);
        p.log.message(`${muted(`[${label}]`)}\n${file.content.slice(0, 2000)}${file.content.length > 2000 ? "\n...truncated" : ""}`);
      }
    }
    p.outro("Dry-run complete. No files were modified.");
    return;
  }

  const results = [];
  spinner.start("Writing configurations...");
  for (const target of selectedTargets) {
    spinner.message(`Configuring ${brand(target.label)}...`);
    const writeResult = writeConfig(target, apiKey, catalog);
    results.push({ target, ...writeResult });
  }
  spinner.stop(ok("All configurations written."));

  showSuccess({ results, catalog });
  p.outro(ok("You are all set!"));
}

main().catch((err) => {
  if (err.message !== "cancelled") {
    p.log.error(err.message || String(err));
  }
  process.exit(1);
});
