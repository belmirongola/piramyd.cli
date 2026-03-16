#!/usr/bin/env node
const p = require("@clack/prompts");
const pc = require("picocolors");
const fs = require("fs");
const {
  KNOWN_TARGETS,
  CODEX_LAUNCHER_PATH,
  CODEX_SECRET_PATH,
  CODEX_PROFILE,
  CODEX_MODEL_PROVIDER,
  PIRAMYD_OPENAI_BASE_URL,
} = require("../src/constants");
const { normalizeConfigPath, detectConfigKind, exists, listAvailableTargets, truncateMiddle, maskApiKey } = require("../src/utils");
const { parseTomlSections } = require("../src/toml");
const { loadCatalog } = require("../src/catalog");
const { targetBaseUrl, targetDefaultModel, writeConfig } = require("../src/patchers");

function uniqueModels(models) {
  const seen = new Set();
  const list = [];
  for (const entry of models || []) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({ ...entry, id, name: String(entry.name || id) });
  }
  return list;
}

function applyCatalogSelection(catalog, selectedDefaultModelId, extraModels = []) {
  const merged = uniqueModels([...(catalog.models || []), ...extraModels]);
  return {
    ...catalog,
    models: merged,
    defaultModelId: String(selectedDefaultModelId || "").trim(),
  };
}

function findModelById(models, modelId) {
  const wanted = String(modelId || "").trim().toLowerCase();
  if (!wanted) return null;
  return (models || []).find((model) => String(model.id || "").trim().toLowerCase() === wanted) || null;
}

async function askModelDefaultSelection(catalog) {
  const models = uniqueModels(catalog.models || []);
  if (!models.length) {
    return { defaultModelId: "", addedModels: [] };
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
    if (["gemini", "qwen"].includes(target.kind)) {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      return String(config.security?.auth?.apiKey || "").trim();
    }
    if (target.kind === "opencode") {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      return String(config.providers?.piramyd?.apiKey || "").trim();
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
function codexHasExpectedConfig(filePath) {
  if (!exists(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf8");
  const profileHeader = `[profiles.${CODEX_PROFILE}]`;
  const providerHeader = `[model_providers.${CODEX_MODEL_PROVIDER}]`;
  const providerLine = `model_provider = "${CODEX_MODEL_PROVIDER}"`;
  const baseUrlLine = `base_url = "${PIRAMYD_OPENAI_BASE_URL}"`;
  const wireApiLine = 'wire_api = "responses"';
  return raw.includes(profileHeader)
    && raw.includes(providerHeader)
    && raw.includes(providerLine)
    && raw.includes(baseUrlLine)
    && raw.includes(wireApiLine);
}
function codexLauncherLooksHealthy() {
  if (!exists(CODEX_LAUNCHER_PATH)) return false;
  const raw = fs.readFileSync(CODEX_LAUNCHER_PATH, "utf8");
  return raw.includes(PIRAMYD_OPENAI_BASE_URL) && raw.includes(`-p ${CODEX_PROFILE}`);
}
function targetNeedsRepair(target) {
  const key = getExistingApiKey(target);
  if (!key || !key.startsWith("sk-")) return true;
  if (target.kind !== "codex") return false;
  if (!codexHasExpectedConfig(target.path)) return true;
  if (!codexLauncherLooksHealthy()) return true;
  return false;
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
    spinner.stop(`Failed to refresh catalog: ${err.message}`, 1);
    process.exit(1);
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
  if (process.argv.includes("doctor")) {
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
    spinner.stop(`Failed to load catalog: ${err.message}`, 1);
    throw err;
  }

  const modelSelection = await askModelDefaultSelection(catalog);
  catalog = applyCatalogSelection(catalog, modelSelection.defaultModelId, modelSelection.addedModels);

  const shouldApply = await confirmPlan({ targets: selectedTargets, apiKey, catalog });
  if (!shouldApply) {
    p.cancel("No files were changed.");
    process.exit(0);
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
