#!/usr/bin/env node
const p = require("@clack/prompts");
const pc = require("picocolors");
const path = require("path");
const {
  CODEX_LAUNCHER_PATH,
} = require("../src/constants");
const { normalizeConfigPath, detectConfigKind, exists, listAvailableTargets, truncateMiddle, maskApiKey } = require("../src/utils");
const { loadCatalog } = require("../src/catalog");
const { targetBaseUrl, targetDefaultModel, writeConfig, generateConfig } = require("../src/patchers");
const { getExistingApiKey, findReusableApiKey, targetNeedsRepair } = require("../src/diagnosis");
const { FALLBACK_DEFAULT_MODEL, buildEmergencyCatalog, uniqueModels, applyCatalogSelection, findModelById } = require("../src/emergency-catalog");

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

  p.log.step(`Top models from API catalog (tier ${tier})`);
  for (const model of topFromApi) {
    p.log.message(`  • ${model.id}${model.reasoning ? " (reasoning)" : ""}`);
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
  const options = [
    ...targets.map((target) => ({
      label: target.label,
      hint: truncateMiddle(target.path, 60),
      value: target,
    })),
    {
      label: "Custom config path",
      hint: "Point the wizard at another supported Codex, Claude, Kimi, OpenClaw, Gemini, Qwen, or OpenCode config file.",
      value: "__custom__",
    },
  ];

  const choice = await p.multiselect({
    message: "Choose the CLI instances that should be customized for Piramyd:",
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
async function promptApiKey(existingApiKey) {
  const message = existingApiKey
    ? `Piramyd API key (Press Enter to reuse ${maskApiKey(existingApiKey)})`
    : "Paste your Piramyd API key (sk-...)";

  while (true) {
    const answer = await p.password({
      message,
    });

    if (p.isCancel(answer)) { p.cancel('Operation cancelled.'); process.exit(0); }
    
    const result = (answer ? answer.trim() : "") || existingApiKey;
    if (result && result.startsWith("sk-")) return result;
    p.log.error("API key must start with sk-.");
  }
}
async function confirmPlan(plan) {
  p.log.step("Review Configuration Plan");
  
  for (const target of plan.targets) {
    p.log.message(`  ${pc.bold("Target:")}      ${target.label} (Found at: ${target.binaryPath || "Custom"})\n  ${pc.bold("Config:")}      ${target.path}\n  ${pc.bold("Provider:")}    ${targetBaseUrl(target)}\n  ${pc.bold("Default:")}     ${targetDefaultModel(target, plan.catalog.models, plan.catalog.tier, plan.catalog.defaultModelId)}${
      target.kind === "codex" ? `\n  ${pc.bold("Launcher:")}    ${CODEX_LAUNCHER_PATH}` : ""
    }`);
  }
  
  p.log.message(`  ${pc.bold("API key:")}     ${maskApiKey(plan.apiKey)}\n  ${pc.bold("Tier:")}        ${plan.catalog.tier}\n  ${pc.bold("Catalog:")}     ${plan.catalog.models.length} text/code models\n  ${pc.bold("Default ID:")}  ${plan.catalog.defaultModelId || "(auto)"}\n  ${pc.bold("Source:")}      ${plan.catalog.source}`);

  const apply = await p.confirm({
    message: "Apply configuration? (Creates backups and updates the config files)",
    initialValue: true,
  });

  if (p.isCancel(apply)) { p.cancel('Operation cancelled.'); process.exit(0); }
  return apply;
}
function showSuccess(result) {
  let commands = [];
  let allLines = [];
  
  for (const res of result.results) {
    let command = "Run `openclaw models list`.";
    if (res.target.kind === "kimi") command = "Run `kimi` and then `/model`.";
    if (res.target.kind === "codex") command = "Run `codex-piramyd` and then `/model`.";
    if (res.target.kind === "claude") command = "Run `claude` and then `/model`.";
    if (res.target.kind === "gemini") command = "Run `gemini` to test.";
    if (res.target.kind === "qwen") command = "Run `qwen` to test.";
    if (res.target.kind === "opencode") command = "Run `opencode` to test.";
    if (!commands.includes(command)) commands.push(command);

    allLines.push(`Target:  ${pc.yellow(res.target.label)}`);
    allLines.push(`Config:  ${res.target.path}`);
    if (res.backups && res.backups.length) allLines.push(`Backup:  ${res.backups[0]}`);
    if (res.artifacts && res.artifacts.length) allLines.push(`Artifacts: ${res.artifacts.join(", ")}`);
    allLines.push("");
  }

  allLines.push(`Models:  ${result.catalog.models.length} loaded`);
  if (result.catalog.warning) p.log.warn(result.catalog.warning);
  
  const hasCodex = result.results.some(r => r.target.kind === "codex");
  if (hasCodex) {
    p.log.info("Bare `codex` is unchanged. Use `codex-piramyd` for the Piramyd route.");
    const launcherDir = path.dirname(CODEX_LAUNCHER_PATH);
    const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    if (!pathEntries.includes(launcherDir)) {
      p.log.warn(`Add ${launcherDir} to PATH so 'codex-piramyd' is executable from any shell.`);
      if (process.platform === "win32") {
        p.log.message(`Tip (Windows): setx PATH "%PATH%;${launcherDir}"`);
      } else {
        const shell = process.env.SHELL || "";
        const profileFile = shell.includes("zsh") ? "~/.zshrc" : "~/.bashrc";
        p.log.message(`Tip (Linux/macOS): echo 'export PATH="${launcherDir}:$PATH"' >> ${profileFile}`);
      }
    }
  }

  allLines.push(`Next:    ${pc.bold(commands.join(" | "))}`);
  
  p.note(allLines.join("\n"), "Success");
}
async function runDoctor() {
  console.clear();
  console.log(
    pc.yellow(`
       _       _     
      | |     | |    
    __| | ___ | |_   
   / _\` |/ _ \\| __|  
  | (_| | (_) | |_   
   \\__,_|\\___/ \\__|  
    Piramyd Doctor
`)
  );
  p.intro(pc.bgYellow(pc.black(" Piramyd CLI Recovery ")));
  const spinner = p.spinner();
  spinner.start("Checking for configured CLI instances...");

  const allTargets = listAvailableTargets();
  if (!allTargets.length) {
    spinner.stop("No supported Codex, Claude, Kimi, OpenClaw, Gemini, Qwen, or OpenCode targets found in your PATH.", 1);
    process.exit(1);
  }

  let foundApiKey = "";
  let targetsNeedingRepair = [];
  
  for (const target of allTargets) {
    const key = getExistingApiKey(target) || findReusableApiKey(allTargets, target);
    if (key && key.startsWith("sk-")) foundApiKey = key;
    if (targetNeedsRepair(target)) targetsNeedingRepair.push(target);
  }

  if (targetsNeedingRepair.length === 0) {
    spinner.stop("All detected targets are correctly configured and have an API key! Nothing to repair.");
    p.outro("Your setup is healthy.");
    process.exit(0);
  }

  if (!foundApiKey) {
    spinner.stop("Targets need configuration, but no existing Piramyd API key was found in any setup.");
    p.cancel("Run `npx piramyd` normally to onboard.");
    process.exit(1);
  }

  spinner.stop(`Found ${targetsNeedingRepair.length} target(s) requiring repair. Discovered API key ending in '...${foundApiKey.slice(-4)}'.`);

  const apply = await p.confirm({
    message: `Attempt to automatically repair ${targetsNeedingRepair.map(t => t.label).join(", ")}?`,
    initialValue: true,
  });

  if (p.isCancel(apply) || !apply) { p.cancel('Operation cancelled.'); process.exit(0); }

  spinner.start("Connecting to Piramyd and refreshing the catalog...");
  let catalog;
  try {
    catalog = await loadCatalog(foundApiKey);
    if (!catalog.models.length) throw new Error("empty catalog");
    spinner.stop(`Catalog refreshed: ${catalog.models.length} models found.`);
  } catch (err) {
    catalog = buildEmergencyCatalog();
    spinner.stop(`Catalog refresh failed (${err.message}). Using fallback model ${FALLBACK_DEFAULT_MODEL}.`);
  }

  const results = [];
  spinner.start("Repairing configurations...");
  for (const target of targetsNeedingRepair) {
    spinner.message(`Updating ${target.label}...`);
    const writeResult = writeConfig(target, foundApiKey, catalog);
    results.push({ target, ...writeResult });
  }
  spinner.stop("Configurations successfully repaired.");
  
  showSuccess({ results, catalog });
  p.outro("Doctor completed successfully!");
}
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage: piramyd [command] [options]

Commands:
  (default)     Interactive onboarding wizard
  doctor        Auto-detect and repair broken configurations

Options:
  --dry-run     Preview changes without writing any files
  --help, -h    Show this help message
`);
    process.exit(0);
  }

  if (args.includes("doctor")) {
    return runDoctor();
  }

  console.clear();
  console.log(
    pc.yellow(`
         /\\
        /  \\
       /____\\
      /      \\
     /________\\
`)
  );
  p.intro(pc.bgYellow(pc.black(" Piramyd CLI ")));
  const targets = listAvailableTargets();
  if (!targets.length) {
    p.cancel("No supported Codex, Claude, Kimi, OpenClaw, Gemini, Qwen, or OpenCode targets found in your PATH.");
    process.exit(1);
  }

  const selectedTargets = await chooseConfig(targets);
  const existingApiKey = findReusableApiKey(targets, selectedTargets[0]);
  const apiKey = await promptApiKey(existingApiKey);

  const spinner = p.spinner();
  spinner.start("Connecting to Piramyd and preparing the catalog...");
  
  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    if (!catalog.models.length) throw new Error("empty catalog");
    spinner.stop(`Catalog loaded: ${catalog.models.length} text/code models found. (Tier: ${catalog.tier.toUpperCase()})`);
  } catch (err) {
    catalog = buildEmergencyCatalog();
    spinner.stop(`Catalog load failed (${err.message}). Continuing with fallback model ${FALLBACK_DEFAULT_MODEL}.`);
  }

  const modelSelection = await askModelDefaultSelection(catalog);
  catalog = applyCatalogSelection(catalog, modelSelection.defaultModelId, modelSelection.addedModels);

  const shouldApply = await confirmPlan({ targets: selectedTargets, apiKey, catalog });
  if (!shouldApply) {
    p.cancel("No files were changed.");
    process.exit(0);
  }

  if (isDryRun) {
    p.log.step(pc.cyan("Dry-run mode — no files will be written."));
    for (const target of selectedTargets) {
      const preview = generateConfig(target, apiKey, catalog);
      p.log.message(`\n${pc.bold(`── ${target.label} (${target.path}):`)}`);
      for (const file of preview.files) {
        const label = file.path === target.path ? "config" : path.basename(file.path);
        p.log.message(`${pc.dim(`[${label}]`)}\n${file.content.slice(0, 2000)}${file.content.length > 2000 ? "\n...truncated" : ""}`);
      }
    }
    p.outro("Dry-run complete. No files were modified.");
    return;
  }

  const results = [];
  spinner.start("Writing configurations...");
  for (const target of selectedTargets) {
    spinner.message(`Updating ${target.label}...`);
    const writeResult = writeConfig(target, apiKey, catalog);
    results.push({ target, ...writeResult });
  }
  spinner.stop("Configurations written successfully.");

  showSuccess({ results, catalog });
  p.outro("You are all set!");
}

main().catch((err) => {
  if (err.message !== "cancelled") {
    p.log.error(err.message || String(err));
  }
  process.exit(1);
});
