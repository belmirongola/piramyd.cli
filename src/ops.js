const fs = require("fs");
const {
  KNOWN_TARGETS,
  CODEX_LAUNCHER_PATH,
  CLAUDE_LAUNCHER_PATH,
  COPILOT_LAUNCHER_PATH,
} = require("./constants");
const { exists, resolveCommand, maskApiKey, listBackupsForFile } = require("./utils");
const { getExistingApiKey, targetNeedsRepair } = require("./diagnosis");

function launcherPathFor(kind) {
  if (kind === "codex") return CODEX_LAUNCHER_PATH;
  if (kind === "claude") return CLAUDE_LAUNCHER_PATH;
  if (kind === "copilot") return COPILOT_LAUNCHER_PATH;
  return null;
}

function inspectTarget(target) {
  const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
  const configExists = exists(target.path);
  const key = getExistingApiKey(target);
  const hasKey = Boolean(key && key.startsWith("sk-"));
  const launcher = launcherPathFor(target.kind);
  const launcherExists = Boolean(launcher && exists(launcher));
  const configured = hasKey || configExists || launcherExists;
  const broken = configured && targetNeedsRepair({ ...target, binaryPath, filePresent: configExists });
  return {
    kind: target.kind,
    label: target.label,
    path: target.path,
    binaryPath: binaryPath || null,
    configExists,
    launcher,
    launcherExists,
    hasKey,
    keyPreview: hasKey ? maskApiKey(key) : "",
    configured,
    healthy: configured && !broken,
    needsRepair: broken,
  };
}

function inspectAllTargets() {
  return KNOWN_TARGETS.map((target) => inspectTarget(target));
}

function restoreTarget(kind) {
  const target = KNOWN_TARGETS.find((item) => item.kind === kind);
  if (!target) {
    throw new Error(`Unknown target "${kind}".`);
  }
  const backups = listBackupsForFile(target.path);
  if (!backups.length) {
    throw new Error(`No backups found for ${target.label} (${target.path}).`);
  }
  const latest = backups[0];
  fs.copyFileSync(latest.path, target.path);
  return {
    kind: target.kind,
    label: target.label,
    restoredFrom: latest.path,
    restoredTo: target.path,
  };
}

function resolveSelectedTargets(kinds) {
  const wanted = new Set((kinds || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  const matched = KNOWN_TARGETS.filter((target) => wanted.has(target.kind));
  const unknown = [...wanted].filter((kind) => !KNOWN_TARGETS.some((target) => target.kind === kind));
  if (unknown.length) {
    throw new Error(`Unknown target(s): ${unknown.join(", ")}. Use: ${KNOWN_TARGETS.map((t) => t.kind).join(", ")}`);
  }
  return matched.map((target) => {
    const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
    return { ...target, binaryPath, filePresent: exists(target.path) };
  });
}

module.exports = {
  inspectTarget,
  inspectAllTargets,
  restoreTarget,
  resolveSelectedTargets,
  launcherPathFor,
};
