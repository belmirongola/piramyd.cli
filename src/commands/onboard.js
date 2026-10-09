const p = require("@clack/prompts");
const pc = require("picocolors");
const path = require("path");
const { brand, accent, ok, muted, em, DIVIDER, DIVIDER_THIN, renderBanner } = require("../ui");
const { CODEX_LAUNCHER_PATH, CLAUDE_LAUNCHER_PATH } = require("../constants");
const { normalizeConfigPath, detectConfigKind, exists, listAvailableTargets, truncateMiddle, maskApiKey } = require("../utils");
const { loadCatalog, uniqueModels, applyCatalogSelection, findModelById, modelHasVision, VISION_ICON } = require("../catalog");
const { targetBaseUrl, targetDefaultModel, writeConfig, generateConfig } = require("../patchers");
const { findReusableApiKey } = require("../diagnosis");
const { resolveSelectedTargets } = require("../ops");
const { isPiramydKey } = require("../credentials");
const { obtainApiKey, authHint } = require("../key-flow");

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

async function runNonInteractiveOnboard(cli) {
  const selectedTargets = resolveSelectedTargets(cli.targets);
  if (!selectedTargets.length) {
    throw new Error("non-interactive mode requires --target <kind>[,kind]");
  }
  const existingApiKey = findReusableApiKey(listAvailableTargets().length ? listAvailableTargets() : selectedTargets, selectedTargets[0]);
  const apiKey = await obtainApiKey(cli, { configKey: existingApiKey, interactive: false });
  if (!isPiramydKey(apiKey)) {
    throw new Error("non-interactive mode needs a key: run `piramyd login` once, or pass --api-key / PIRAMYD_API_KEY");
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

async function runOnboard(cli) {
  const isDryRun = cli.dryRun;
  console.clear();
  console.log(renderBanner());
  p.intro(pc.bgYellow(pc.black(" CLI Onboarding ")));

  const targets = listAvailableTargets();
  if (!targets.length) {
    p.cancel("No supported CLI targets found in your PATH.");
    process.exit(1);
  }

  const selectedTargets = await chooseConfig(targets);
  const apiKey = await obtainApiKey(cli, { configKey: findReusableApiKey(targets, selectedTargets[0]) });

  const spinner = p.spinner();
  spinner.start("Connecting to Piramyd...");

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${catalog.tier.toUpperCase()})`)}`);
  } catch (err) {
    spinner.stop(pc.red("Catalog failed."));
    p.cancel(authHint(err));
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

module.exports = { showSuccess, runNonInteractiveOnboard, runOnboard };
