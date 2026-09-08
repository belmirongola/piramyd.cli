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
const { loadCatalog, uniqueModels, applyCatalogSelection, findModelById, modelHasVision, VISION_ICON } = require("../src/catalog");
const { targetBaseUrl, targetDefaultModel, writeConfig, generateConfig } = require("../src/patchers");
const { getExistingApiKey, findReusableApiKey, targetNeedsRepair, codexShimHealth, syncClaudeState } = require("../src/diagnosis");
const { probeModelsConcurrent } = require("../src/model-probes");
const { parseCliArgs } = require("../src/cli-args");
const { inspectAllTargets, restoreTarget, resolveSelectedTargets } = require("../src/ops");
const {
  DEFAULT_API_URL,
  fetchLatestProbeRun,
  summarizeSession,
  relativeAge,
} = require("../src/prober");
const { KNOWN_TARGETS } = require("../src/constants");

const { version: VERSION } = require("../package.json");

// ── Brand system ────────────────────────────────────────────────
const brand   = (s) => pc.yellow(s);
const accent  = (s) => pc.yellow(s);
const ok      = (s) => pc.green(s);
const muted   = (s) => pc.dim(s);
const em      = (s) => pc.bold(s);

const DIVIDER      = muted("\u2550".repeat(60));
const DIVIDER_THIN = muted("\u2500".repeat(40));
const MODEL_STATUS_WIDTH = 8;
const MODEL_NAME_WIDTH = 32;
const MODEL_VISION_WIDTH = 2;
const PROBE_STATUS_WIDTH = 9;
const PROBE_NAME_WIDTH = 34;
const PROBE_FLAG_WIDTH = 5;
const PROBE_COUNT_WIDTH = 9;
const PROBE_CONF_WIDTH = 6;
const PROBE_TIME_WIDTH = 8;
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
  const models = uniqueModels(catalog.models || []);
  if (!models.length) {
    p.cancel("Piramyd catalog is empty. Check your API key and try again.");
    process.exit(1);
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
    const vision = modelHasVision(model) ? ` ${muted(VISION_ICON)}` : "";
    const prefix = isDefault ? ok("\u2192") : muted("\u00B7");
    const name = isDefault ? em(brand(model.id)) : model.id;
    p.log.message(`  ${prefix} ${name}${vision}${badge}`);
  }

  const options = models.map((model) => ({
    label: modelHasVision(model) ? `${model.id} ${VISION_ICON}` : model.id,
    hint: modelHasVision(model) ? `${model.name} · vision` : model.name,
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
    spinner.stop(`Catalog refreshed: ${em(String(catalog.models.length))} models found.`);
  } catch (err) {
    spinner.stop(pc.red("Catalog refresh failed."));
    p.cancel(err.message || String(err));
    process.exit(1);
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
  const visionCount = catalog.models.filter((model) => modelHasVision(model)).length;

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Models checked:")} ${results.length}  ${ok(String(upCount))} up  ${pc.red(String(downCount))} down`);
  console.log(`  ${em("Vision models:")} ${brand(VISION_ICON)} ${String(visionCount)}`);
  console.log(DIVIDER);
  console.log("");
}

function formatModelProbeRow(catalog, result) {
  const model = catalog.models.find((entry) => entry.id === result.modelId);
  const status = result.ok ? ok("● UP") : pc.red("● DOWN");
  const latency = result.latencyMs ? `${result.latencyMs}ms` : "-";
  const name = model ? model.id : result.modelId;
  const vision = padRight(modelHasVision(model) ? brand(VISION_ICON) : "", MODEL_VISION_WIDTH);
  const paddedStatus = padRight(status, MODEL_STATUS_WIDTH);
  const paddedName = padRight(truncateMiddle(name, MODEL_NAME_WIDTH), MODEL_NAME_WIDTH);
  const paddedLatency = padRight(truncateMiddle(latency, MODEL_LATENCY_WIDTH), MODEL_LATENCY_WIDTH);
  const detailText = truncateMiddle(String(result.message || "failed"), MODEL_RESPONSE_WIDTH);
  const paddedDetails = result.ok
    ? padRight(muted(detailText), MODEL_RESPONSE_WIDTH)
    : padRight(pc.red(detailText), MODEL_RESPONSE_WIDTH);
  return `  ${paddedStatus} ${paddedName} ${vision} ${paddedLatency} ${paddedDetails}`;
}

function renderModelProbeHeader() {
  return `  ${padRight(muted("Status"), MODEL_STATUS_WIDTH)} ${padRight(muted("Model"), MODEL_NAME_WIDTH)} ${padRight(muted(VISION_ICON), MODEL_VISION_WIDTH)} ${padRight(muted("Latency"), MODEL_LATENCY_WIDTH)} ${padRight(muted("Response"), MODEL_RESPONSE_WIDTH)}`;
}

async function runModels() {
  console.clear();
  console.log(renderModelsBanner());
  p.intro(pc.bgYellow(pc.black(" Piramyd Models ")));

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
  console.log(`  ${brand(VISION_ICON)} ${muted("= computer vision / multimodal")}`);
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

// ── prober (last probe round from the database) ─────────────────
async function promptProberApiKey() {
  const value = await p.password({
    message: "Paste your Piramyd admin API key (sk-...)",
    mask: "*",
    validate(input) {
      const candidate = String(input || "").trim();
      if (!candidate) return "API key is required.";
      if (!candidate.startsWith("sk-")) return "Provide a valid Piramyd API key (sk-...).";
      return undefined;
    },
  });
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return String(value || "").trim();
}

function proberFlagCell(value) {
  if (value === true) return ok("✓");
  if (value === false) return pc.red("✗");
  return muted("?");
}

function renderProberHeader() {
  return `  ${padRight(muted("Status"), PROBE_STATUS_WIDTH)} ${padRight(muted("Model"), PROBE_NAME_WIDTH)} ${padRight(muted(VISION_ICON), PROBE_FLAG_WIDTH)} ${padRight(muted("Tool"), PROBE_FLAG_WIDTH)} ${padRight(muted("Strm"), PROBE_FLAG_WIDTH)} ${padRight(muted("Probes"), PROBE_COUNT_WIDTH)} ${padRight(muted("Conf"), PROBE_CONF_WIDTH)} ${padRight(muted("Time"), PROBE_TIME_WIDTH)} ${padRight(muted("Age"), PROBE_TIME_WIDTH)}`;
}

function formatProberRow(row) {
  const statusText =
    row.status === "completed" && !row.error
      ? ok("● OK")
      : row.status === "failed" || row.status === "error"
        ? pc.red(`● ${String(row.status).toUpperCase()}`)
        : muted(`● ${String(row.status || "?").toUpperCase()}`);

  const name = truncateMiddle(`${row.provider}/${row.model}`, PROBE_NAME_WIDTH);
  const vision =
    row.supportsVision === true
      ? brand(VISION_ICON)
      : row.supportsVision === false
        ? pc.red("✗")
        : muted("?");
  const count = row.probesTotal > 0 ? `${row.probesOk}/${row.probesTotal}` : muted("-");
  const conf = typeof row.confidence === "number" ? `${Math.round(row.confidence * 100)}%` : muted("-");
  const time = typeof row.elapsedMs === "number" ? `${(row.elapsedMs / 1000).toFixed(1)}s` : muted("-");
  const age = relativeAge(row.probedAt) || muted("-");

  return `  ${padRight(statusText, PROBE_STATUS_WIDTH)} ${padRight(name, PROBE_NAME_WIDTH)} ${padRight(vision, PROBE_FLAG_WIDTH)} ${padRight(proberFlagCell(row.supportsTools), PROBE_FLAG_WIDTH)} ${padRight(proberFlagCell(row.supportsStreaming), PROBE_FLAG_WIDTH)} ${padRight(count, PROBE_COUNT_WIDTH)} ${padRight(conf, PROBE_CONF_WIDTH)} ${padRight(time, PROBE_TIME_WIDTH)} ${padRight(age, PROBE_TIME_WIDTH)}`;
}

function showProberSummary(rows) {
  const completed = rows.filter((row) => row.status === "completed" && !row.error).length;
  const failed = rows.length - completed;
  const vision = rows.filter((row) => row.supportsVision === true).length;
  const ages = rows.map((row) => relativeAge(row.probedAt)).filter(Boolean);
  console.log(DIVIDER);
  console.log(`  ${em("Models in last round:")} ${rows.length}  ${ok(String(completed))} ok  ${pc.red(String(failed))} failed`);
  console.log(`  ${em("Vision models:")} ${brand(VISION_ICON)} ${String(vision)}`);
  if (ages.length) {
    console.log(`  ${em("Probed:")} ${muted(`${ages[ages.length - 1]} – ${ages[0]} ago`)}`);
  }
  const errs = rows.filter((row) => row.error);
  if (errs.length) {
    console.log("");
    for (const row of errs) {
      console.log(`  ${pc.red("!")} ${row.provider}/${row.model} ${muted("—")} ${truncateMiddle(String(row.error), 60)}`);
    }
  }
  console.log(DIVIDER);
  console.log("");
}

async function runProber(cli) {
  const jsonOut = cli.json;

  if (!jsonOut) {
    console.clear();
    console.log(renderModelsBanner());
    p.intro(pc.bgYellow(pc.black(" Piramyd Prober ")));
  }

  const apiKey = cli.apiKey || (jsonOut ? "" : await promptProberApiKey());
  if (!apiKey || !apiKey.startsWith("sk-")) {
    throw new Error("prober requires an admin API key: --api-key sk-... or PIRAMYD_API_KEY");
  }

  const apiUrl = (cli.apiBase || DEFAULT_API_URL).replace(/\/+$/, "");

  const spinner = jsonOut ? null : p.spinner();
  if (spinner) spinner.start("Loading the last probe round from piramyd.api...");

  let items;
  try {
    items = await fetchLatestProbeRun(apiUrl, apiKey, { model: cli.model });
  } catch (err) {
    if (spinner) spinner.stop(pc.red("Could not load probe sessions."));
    if (err.statusCode === 403) {
      throw new Error("This API key does not belong to an admin user.");
    }
    throw new Error(`prober/latest failed: ${err.message || err}`);
  }

  const rows = items.map(summarizeSession);

  if (spinner) {
    spinner.stop(`${em(String(rows.length))} model${rows.length === 1 ? "" : "s"} in the last probe round`);
  }

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, api: apiUrl, total: rows.length, items: rows }, null, 2));
    return;
  }

  if (!rows.length) {
    p.outro(cli.model ? `No stored probe session for "${cli.model}".` : "No probe sessions stored yet.");
    return;
  }

  console.log(DIVIDER);
  console.log(`  ${em("Source:")}   ${apiUrl}/v1/admin/prober/latest`);
  console.log(`  ${em("Models:")}   ${rows.length}${cli.model ? muted(`  (filter: ${cli.model})`) : ""}`);
  console.log(DIVIDER);
  console.log("");
  console.log(renderProberHeader());
  console.log(`  ${brand(VISION_ICON)} ${muted("= computer vision / multimodal")}`);
  console.log("");
  for (const row of rows) {
    console.log(formatProberRow(row));
  }
  console.log("");
  showProberSummary(rows);
  p.outro(ok("Last probe round shown."));
}

function printHelp() {
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
    `    ${muted("prober")}        Print the last probe round from the database (admin API key)`,
    `    ${muted("status")}        Show installed CLI state and drift`,
    `    ${muted("restore")}       Restore the latest backup for a target`,
    "",
    `  ${em("Options:")}`,
    `    ${muted("--dry-run")}              Preview changes without writing any files`,
    `    ${muted("--yes, -y")}              Non-interactive apply (no prompts)`,
    `    ${muted("--target <kinds>")}       comma-separated: ${KNOWN_TARGETS.map((t) => t.kind).join(", ")}`,
    `    ${muted("--api-key <sk-...>")}     API key (or PIRAMYD_API_KEY) — prober needs an admin key`,
    `    ${muted("--model <id>")}           Default model id ${muted("(prober: show only this model)")}`,
    `    ${muted("--json")}                 Machine-readable output`,
    `    ${muted("--help, -h")}             Show this help message`,
    "",
    `  ${em("Env:")}     PIRAMYD_BASE_URL  PIRAMYD_API_KEY`,
    "",
  ].join("\n"));
}

function runStatus(cli) {
  const rows = inspectAllTargets();
  if (cli.json) {
    console.log(JSON.stringify({ ok: true, targets: rows }, null, 2));
    return;
  }
  console.log(renderBanner());
  p.intro(pc.bgYellow(pc.black(" Status ")));
  for (const row of rows) {
    const state = !row.configured
      ? muted("not configured")
      : row.healthy
        ? ok("healthy")
        : pc.red("needs repair");
    const lines = [
      `  ${em(brand(row.label))}  ${muted(row.kind)}  ${state}`,
      `  ${muted("Binary")}   ${row.binaryPath || muted("not in PATH")}`,
      `  ${muted("Config")}   ${truncateMiddle(row.path, 55)} ${row.configExists ? ok("yes") : muted("no")}`,
    ];
    if (row.launcher) {
      lines.push(`  ${muted("Launcher")} ${row.launcher} ${row.launcherExists ? ok("yes") : muted("no")}`);
    }
    lines.push(`  ${muted("Key")}      ${row.hasKey ? accent(row.keyPreview) : muted("missing")}`);
    p.log.message(lines.join("\n"));
    p.log.message(`  ${DIVIDER_THIN}`);
  }
  const healthy = rows.filter((row) => row.healthy).length;
  p.outro(`${healthy}/${rows.length} targets healthy.`);
}

function runRestore(cli) {
  const kind = cli.targets[0];
  if (!kind) {
    throw new Error("restore requires --target <kind>");
  }
  const result = restoreTarget(kind);
  if (cli.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  p.log.success(`Restored ${result.label} from ${result.restoredFrom}`);
  p.outro(ok("Restore complete."));
}

async function runNonInteractiveOnboard(cli) {
  const selectedTargets = resolveSelectedTargets(cli.targets);
  if (!selectedTargets.length) {
    throw new Error("non-interactive mode requires --target <kind>[,kind]");
  }
  const existingApiKey = findReusableApiKey(listAvailableTargets().length ? listAvailableTargets() : selectedTargets, selectedTargets[0]);
  const apiKey = cli.apiKey || existingApiKey;
  if (!apiKey || !apiKey.startsWith("sk-")) {
    throw new Error("non-interactive mode requires --api-key sk-... or PIRAMYD_API_KEY");
  }

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
  } catch (err) {
    throw new Error(`Could not load Piramyd catalog: ${err.message || err}`);
  }

  const defaultModelId = cli.model || catalog.defaultModelId || (catalog.models[0] && catalog.models[0].id);
  if (!defaultModelId) {
    throw new Error("Catalog has no models. Pass --model <id> or check your key.");
  }
  catalog = applyCatalogSelection(catalog, defaultModelId, cli.model && !findModelById(catalog.models, cli.model)
    ? [{ id: cli.model, name: `${cli.model} (cli)`, reasoning: false, input: ["text"], contextWindow: 0, maxTokens: 0 }]
    : []);

  if (cli.dryRun) {
    for (const target of selectedTargets) {
      const preview = generateConfig(target, apiKey, catalog);
      p.log.message(`\n${em(`-- ${target.label}`)}`);
      for (const file of preview.files) {
        p.log.message(`${muted(`[${path.basename(file.path)}]`)}\n${file.content.slice(0, 2000)}`);
      }
    }
    p.outro("Dry-run complete. No files were modified.");
    return;
  }

  const results = [];
  for (const target of selectedTargets) {
    results.push({ target, ...writeConfig(target, apiKey, catalog) });
  }
  showSuccess({ results, catalog });
  p.outro(ok("Non-interactive setup complete."));
}

// ── Main wizard ─────────────────────────────────────────────────
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const isDryRun = cli.dryRun;

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  if (cli.command === "doctor") {
    return runDoctor();
  }

  if (cli.command === "models") {
    return runModels();
  }

  if (cli.command === "prober") {
    return runProber(cli);
  }

  if (cli.command === "status") {
    return runStatus(cli);
  }

  if (cli.command === "restore") {
    return runRestore(cli);
  }

  if (cli.yes) {
    return runNonInteractiveOnboard(cli);
  }

  console.clear();
  console.log(renderBanner());
  p.intro(pc.bgYellow(pc.black(" CLI Onboarding ")));

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
    spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${catalog.tier.toUpperCase()})`)}`);
  } catch (err) {
    spinner.stop(pc.red("Catalog failed."));
    p.cancel(err.message || String(err));
    process.exit(1);
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
