const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  CODEX_SECRET_PATH, CODEX_LAUNCHER_PATH, CODEX_NODE_SHIM_PATH, CODEX_PROFILE, CODEX_MODEL_PROVIDER, PIRAMYD_OPENAI_BASE_URL,
  CLAUDE_CONFIG_DIR, CLAUDE_SETTINGS_PATH, CLAUDE_LAUNCHER_PATH, PIRAMYD_ANTHROPIC_BASE_URL,
  COPILOT_ENV_PATH, COPILOT_LAUNCHER_PATH, IS_WINDOWS
} = require("./constants");
const { exists, ensureParentDir, backupIfPresent } = require("./utils");
const { parseTomlSections } = require("./toml");

const CLAUDE_SHARED_SYNC_FILES = [
  "settings.json",
  "settings.local.json",
  ".claude.json",
  "CLAUDE.md",
  "history.jsonl",
];

const CLAUDE_SHARED_SYNC_DIRS = [
  "commands",
  "hooks",
  "plugins",
  "projects",
  "sessions",
  "session-env",
  "skills",
];

/**
 * Read the existing Piramyd API key from a target's config file.
 * Returns empty string if not found or unreadable.
 */
function getExistingApiKey(target) {
  try {
    if (target.kind === "claude") {
      const config = JSON.parse(fs.readFileSync(target.path, "utf8"));
      return String(config.env?.ANTHROPIC_AUTH_TOKEN || config.env?.ANTHROPIC_API_KEY || "").trim();
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
    if (target.kind === "copilot") {
      if (!exists(COPILOT_ENV_PATH)) return "";
      const raw = fs.readFileSync(COPILOT_ENV_PATH, "utf8");
      const match = raw.match(/^\s*COPILOT_PROVIDER_API_KEY=(.+)\s*$/m);
      if (!match) return "";
      return String(match[1]).trim().replace(/^['"]|['"]$/g, "");
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

/**
 * Search all detected targets for a reusable API key (sk-...).
 * Prioritises the selected target, then checks the rest.
 */
function findReusableApiKey(targets, selectedTarget) {
  const ordered = [selectedTarget, ...targets.filter((target) => target.path !== selectedTarget.path)];
  for (const target of ordered) {
    const apiKey = getExistingApiKey(target);
    if (apiKey.startsWith("sk-")) return apiKey;
  }
  return "";
}

/**
 * Check whether Codex config.toml contains the expected Piramyd sections.
 */
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

/**
 * Check whether the codex-piramyd launcher script looks healthy.
 * On Unix: checks for shell script markers. On Windows: checks for .cmd markers.
 */
function codexLauncherLooksHealthy() {
  if (!exists(CODEX_LAUNCHER_PATH)) return false;
  const raw = fs.readFileSync(CODEX_LAUNCHER_PATH, "utf8");
  // Both platforms must reference the base URL and profile
  if (!raw.includes(PIRAMYD_OPENAI_BASE_URL)) return false;
  if (CODEX_LAUNCHER_PATH.endsWith(".cmd")) {
    // Windows .cmd uses node shim bootstrap
    return raw.includes("PIRAMYD_NODE_SHIM_V1") && raw.includes("@echo off");
  }
  // Unix shell
  return raw.includes(`-p ${CODEX_PROFILE}`);
}

/**
 * Check whether the Windows Node shim is syntactically valid.
 * Runs `node --check` on the shim file to catch SyntaxErrors before launch.
 * Returns { healthy: bool, error: string|null }.
 */
function codexShimHealth() {
  if (!IS_WINDOWS) return { healthy: true, error: null };
  if (!exists(CODEX_NODE_SHIM_PATH)) return { healthy: false, error: "shim file missing" };
  try {
    const result = spawnSync(process.execPath, ["--check", CODEX_NODE_SHIM_PATH], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0) return { healthy: true, error: null };
    const msg = String(result.stderr || result.stdout || "").trim().split("\n")[0] || "syntax error";
    return { healthy: false, error: msg };
  } catch (exc) {
    return { healthy: false, error: String(exc.message || exc) };
  }
}

/**
 * Determine if a target needs repair (missing key, broken Codex config/launcher).
 */
function targetNeedsRepair(target) {
  const key = getExistingApiKey(target);
  if (!key || !key.startsWith("sk-")) return true;
  if (target.kind === "codex") {
    if (!codexHasExpectedConfig(target.path)) return true;
    if (!codexLauncherLooksHealthy()) return true;
    if (!codexShimHealth().healthy) return true;
    return false;
  }
  if (target.kind === "claude") {
    if (!exists(CLAUDE_LAUNCHER_PATH)) return true;
    const raw = fs.readFileSync(CLAUDE_LAUNCHER_PATH, "utf8");
    if (!raw.includes(PIRAMYD_ANTHROPIC_BASE_URL)) return true;
    if (!raw.includes(path.dirname(CLAUDE_SETTINGS_PATH))) return true;
    return false;
  }
  if (target.kind === "copilot") {
    if (!exists(COPILOT_ENV_PATH)) return true;
    if (!exists(COPILOT_LAUNCHER_PATH)) return true;
    const raw = fs.readFileSync(COPILOT_LAUNCHER_PATH, "utf8");
    if (!raw.includes("copilot")) return true;
    return false;
  }
  return false;
}

function existsDir(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyDirectoryRecursive(sourceDir, destinationDir) {
  ensureParentDir(path.join(destinationDir, ".keep"));
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) continue;
    ensureParentDir(destinationPath);
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function syncClaudeState(options = {}) {
  const homeDir = String(options.homeDir || path.resolve(path.dirname(CLAUDE_CONFIG_DIR), ".."));
  const sourceDir = path.resolve(homeDir, ".claude");
  const destinationDir = path.resolve(homeDir, ".claude-piramyd");

  const result = {
    sourceDir,
    destinationDir,
    synced: [],
    skipped: [],
    backups: [],
  };

  if (!existsDir(sourceDir) || !existsDir(destinationDir)) return result;

  for (const relativePath of CLAUDE_SHARED_SYNC_FILES) {
    const sourcePath = path.join(sourceDir, relativePath);
    const destinationPath = path.join(destinationDir, relativePath);
    if (!exists(sourcePath)) {
      result.skipped.push(relativePath);
      continue;
    }
    backupIfPresent(destinationPath, result.backups);
    ensureParentDir(destinationPath);
    fs.copyFileSync(sourcePath, destinationPath);
    result.synced.push(relativePath);
  }

  for (const relativePath of CLAUDE_SHARED_SYNC_DIRS) {
    const sourcePath = path.join(sourceDir, relativePath);
    const destinationPath = path.join(destinationDir, relativePath);
    if (!existsDir(sourcePath)) {
      result.skipped.push(relativePath);
      continue;
    }
    backupIfPresent(destinationPath, result.backups);
    removePath(destinationPath);
    copyDirectoryRecursive(sourcePath, destinationPath);
    result.synced.push(relativePath);
  }

  return result;
}

module.exports = {
  getExistingApiKey,
  findReusableApiKey,
  codexHasExpectedConfig,
  codexLauncherLooksHealthy,
  codexShimHealth,
  targetNeedsRepair,
  syncClaudeState,
};
