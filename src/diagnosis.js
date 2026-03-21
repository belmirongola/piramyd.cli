const fs = require("fs");
const { CODEX_SECRET_PATH, CODEX_LAUNCHER_PATH, CODEX_PROFILE, CODEX_MODEL_PROVIDER, PIRAMYD_OPENAI_BASE_URL } = require("./constants");
const { exists } = require("./utils");
const { parseTomlSections } = require("./toml");

/**
 * Read the existing Piramyd API key from a target's config file.
 * Returns empty string if not found or unreadable.
 */
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
    // Windows .cmd
    return raw.includes(`-p ${CODEX_PROFILE}`) && raw.includes("@echo off");
  }
  // Unix shell
  return raw.includes(`-p ${CODEX_PROFILE}`);
}

/**
 * Determine if a target needs repair (missing key, broken Codex config/launcher).
 */
function targetNeedsRepair(target) {
  const key = getExistingApiKey(target);
  if (!key || !key.startsWith("sk-")) return true;
  if (target.kind !== "codex") return false;
  if (!codexHasExpectedConfig(target.path)) return true;
  if (!codexLauncherLooksHealthy()) return true;
  return false;
}

module.exports = {
  getExistingApiKey,
  findReusableApiKey,
  codexHasExpectedConfig,
  codexLauncherLooksHealthy,
  targetNeedsRepair,
};
