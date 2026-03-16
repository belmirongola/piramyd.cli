const fs = require('fs');

let content = fs.readFileSync('bin/piramyd.js', 'utf8');

// We have the blocks:
// 1. 0 to chooseConfigPlain
// 2. parseTomlSections to promptApiKeyPlain
// 3. fetchModels to confirmPlan

const cut1 = content.indexOf("async function chooseConfigPlain");
const cut2 = content.indexOf("function parseTomlSections");
const cut3 = content.indexOf("async function promptApiKeyPlain");
const cut4 = content.indexOf("async function fetchModels");
const cut5 = content.indexOf("async function confirmPlan");

const block1 = content.substring(0, cut1);
const block2 = content.substring(cut2, cut3);
let block3 = content.substring(cut4, cut5);

// Update KNOWN_TARGETS in block1
const oldTargets = `const KNOWN_TARGETS = [
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
];`;

const newTargets = `const KNOWN_TARGETS = [
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
    binaryName: "kimi",
  },
  {
    kind: "openclaw",
    label: "OpenClaw",
    summary: "Patch ~/.openclaw/openclaw.json with Piramyd provider models.",
    path: path.resolve(os.homedir(), ".openclaw/openclaw.json"),
    binaryName: "openclaw",
  },
];`;

let newBlock1 = block1.replace(oldTargets, newTargets);

const oldListTargets = `function listAvailableTargets() {
  return KNOWN_TARGETS.flatMap((target) => {
    const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
    const filePresent = exists(target.path);
    const available = target.allowCreate
      ? Boolean(filePresent || binaryPath || existsPath(path.dirname(target.path)))
      : filePresent;
    if (!available) return [];
    return [{ ...target, binaryPath, filePresent }];
  });
}`;

const newListTargets = `function listAvailableTargets() {
  return KNOWN_TARGETS.flatMap((target) => {
    const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
    const filePresent = exists(target.path);
    const available = Boolean(binaryPath);
    if (!available) return [];
    return [{ ...target, binaryPath, filePresent }];
  });
}`;

newBlock1 = newBlock1.replace(oldListTargets, newListTargets);

// In block3, replace normalizeCatalogEntry
const oldNormalize = `function normalizeCatalogEntry(entry) {
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
}`;

const newNormalize = `function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const id = String(entry.id || "").trim();
  if (!id) return null;

  const input = Array.isArray(entry.input)
    ? entry.input.map((item) => String(item).toLowerCase())
    : [];
  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.map((item) => String(item).toLowerCase())
    : [];
    
  // Strictly ignore models designed for image/audio generation or purely non-text modalities.
  const type = String(entry.type || entry.object || "").toLowerCase();
  if (type.includes("image") || type.includes("audio")) return null;
  if (capabilities.includes("image_generation") || capabilities.includes("text-to-image")) return null;
  
  // We want to ensure it has conversational or text completion capabilities.
  const hasText = input.includes("text") || input.length === 0 || capabilities.includes("chat");
  if (!hasText && type !== "model") return null;

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
}`;

block3 = block3.replace(oldNormalize, newNormalize);

// Replace loadCatalog and loadLocalCatalog entirely
const oldLoadCatalogRegex = /function loadLocalCatalog\(\) \{.*\}[\s]*async function loadCatalog\(apiKey\) \{.*?\}/s;
const newLoadCatalog = `async function loadCatalog(apiKey) {
  const remote = sanitizeCatalog(await fetchModels(apiKey));
  if (!remote.length) throw new Error("empty catalog or no valid text/coding models found");
  return { source: \`\${PIRAMYD_OPENAI_BASE_URL}/models\`, sourceType: "remote", models: remote };
}`;

block3 = block3.replace(oldLoadCatalogRegex, newLoadCatalog);

const newUI = `
const p = require("@clack/prompts");
const pc = require("picocolors");

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
      p.log.error("Unsupported config path. Use a Codex, Claude, Kimi, or OpenClaw config file.");
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
      hint: "Point the wizard at another supported Codex, Claude, Kimi, or OpenClaw config file.",
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
    ? \`Piramyd API key (Press Enter to reuse \${maskApiKey(existingApiKey)})\`
    : "Paste your Piramyd API key (sk-...)";

  while (true) {
    const answer = await p.password({
      message,
    });

    if (p.isCancel(answer)) { p.cancel('Operation cancelled.'); process.exit(0); }
    
    const result = answer.trim() || existingApiKey;
    if (result && result.startsWith("sk-")) return result;
    p.log.error("API key must start with sk-.");
  }
}

async function confirmPlan(plan) {
  p.log.step("Review Configuration Plan");
  
  for (const target of plan.targets) {
    p.log.message(\`  \${pc.bold("Target:")}      \${target.label} (Found at: \${target.binaryPath || "Custom"})\\n  \${pc.bold("Config:")}      \${target.path}\\n  \${pc.bold("Provider:")}    \${targetBaseUrl(target)}\\n  \${pc.bold("Default:")}     \${targetDefaultModel(target, plan.catalog.models)}\${
      target.kind === "codex" ? \`\\n  \${pc.bold("Launcher:")}    \${CODEX_LAUNCHER_PATH}\` : ""
    }\`);
  }
  
  p.log.message(\`  \${pc.bold("API key:")}     \${maskApiKey(plan.apiKey)}\\n  \${pc.bold("Catalog:")}     \${plan.catalog.models.length} text/code models\\n  \${pc.bold("Source:")}      \${plan.catalog.source}\`);

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
    let command = "Run \`openclaw models list\`.";
    if (res.target.kind === "kimi") command = "Run \`kimi\` and then \`/model\`.";
    if (res.target.kind === "codex") command = "Run \`codex-piramyd\` and then \`/model\`.";
    if (res.target.kind === "claude") command = "Run \`claude\` and then \`/model\`.";
    if (!commands.includes(command)) commands.push(command);

    allLines.push(\`Target:  \${pc.cyan(res.target.label)}\`);
    allLines.push(\`Config:  \${res.target.path}\`);
    if (res.backups && res.backups.length) allLines.push(\`Backup:  \${res.backups[0]}\`);
    if (res.artifacts && res.artifacts.length) allLines.push(\`Artifacts: \${res.artifacts.join(", ")}\`);
    allLines.push("");
  }

  allLines.push(\`Models:  \${result.catalog.models.length} loaded\`);
  if (result.catalog.warning) p.log.warn(result.catalog.warning);
  
  const hasCodex = result.results.some(r => r.target.kind === "codex");
  if (hasCodex) {
    p.log.info("Bare \`codex\` is unchanged. Use \`codex-piramyd\` for the Piramyd route.");
  }

  allLines.push(\`Next:    \${pc.bold(commands.join(" | "))}\`);
  
  p.note(allLines.join("\\n"), "Success");
}

async function runDoctor() {
  console.clear();
  console.log(
    pc.magenta(\`
       _       _     
      | |     | |    
    __| | ___ | |_   
   / _\` |/ _ \\| __|  
  | (_| | (_) | |_   
   \\__,_|\\___/ \\__|  
    Piramyd Doctor
\`)
  );
  p.intro(pc.bgMagenta(pc.black(" Piramyd CLI Recovery ")));
  const spinner = p.spinner();
  spinner.start("Checking for configured CLI instances...");

  const allTargets = listAvailableTargets();
  if (!allTargets.length) {
    spinner.stop("No supported Codex, Claude, Kimi, or OpenClaw targets found in your PATH.", 1);
    process.exit(1);
  }

  let foundApiKey = "";
  let targetsNeedingRepair = [];
  
  for (const target of allTargets) {
    const key = findReusableApiKey([target], target);
    if (key && key.startsWith("sk-")) foundApiKey = key;
    else if (!key) targetsNeedingRepair.push(target);
  }

  if (targetsNeedingRepair.length === 0) {
    spinner.stop("All detected targets are correctly configured and have an API key! Nothing to repair.");
    p.outro("Your setup is healthy.");
    process.exit(0);
  }

  if (!foundApiKey) {
    spinner.stop("Targets need configuration, but no existing Piramyd API key was found in any setup.");
    p.cancel("Run \`npx piramyd\` normally to onboard.");
    process.exit(1);
  }

  spinner.stop(\`Found \${targetsNeedingRepair.length} target(s) missing Piramyd configuration. Discovered API Key ending in '...\${foundApiKey.slice(-4)}'.\`);

  const apply = await p.confirm({
    message: \`Attempt to automatically repair \${targetsNeedingRepair.map(t => t.label).join(", ")}?\`,
    initialValue: true,
  });

  if (p.isCancel(apply) || !apply) { p.cancel('Operation cancelled.'); process.exit(0); }

  spinner.start("Connecting to Piramyd and refreshing the catalog...");
  let catalog;
  try {
    catalog = await loadCatalog(foundApiKey);
    if (!catalog.models.length) throw new Error("empty catalog");
    spinner.stop(\`Catalog refreshed: \${catalog.models.length} models found.\`);
  } catch (err) {
    spinner.stop(\`Failed to refresh catalog: \${err.message}\`, 1);
    process.exit(1);
  }

  const results = [];
  for (const target of targetsNeedingRepair) {
    spinner.start(\`Repairing \${target.kind === "kimi" || target.kind === "codex" ? "TOML" : "JSON"} configuration for \${target.label}...\`);
    const writeResult = writeConfig(target, foundApiKey, catalog.models);
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
    pc.cyan(\`
         /\\\\
        /  \\\\
       /____\\\\
      /      \\\\
     /________\\\\
\`)
  );
  p.intro(pc.bgCyan(pc.black(" Piramyd CLI ")));
  const targets = listAvailableTargets();
  if (!targets.length) {
    p.cancel("No supported Codex, Claude, Kimi, or OpenClaw targets found in your PATH.");
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
    spinner.stop(\`Catalog loaded: \${catalog.models.length} text/code models found.\`);
  } catch (err) {
    spinner.stop(\`Failed to load catalog: \${err.message}\`, 1);
    throw err;
  }

  const shouldApply = await confirmPlan({ targets: selectedTargets, apiKey, catalog });
  if (!shouldApply) {
    p.cancel("No files were changed.");
    process.exit(0);
  }

  const results = [];
  for (const target of selectedTargets) {
    spinner.start(\`Writing \${target.kind === "kimi" || target.kind === "codex" ? "TOML" : "JSON"} configuration for \${target.label}...\`);
    const writeResult = writeConfig(target, apiKey, catalog.models);
    results.push({ target, ...writeResult });
  }
  spinner.stop("Configurations written successfully.");

  showSuccess({ results, catalog });
  p.outro("You are all set!");
}

main().catch((err) => {
  p.log.error(err.message || String(err));
  process.exit(1);
});
`;

const finalFile = newBlock1 + "\n" + block2 + "\n" + block3 + "\n" + newUI;
fs.writeFileSync('bin/piramyd.js', finalFile);
console.log("Rewrite completed.");
