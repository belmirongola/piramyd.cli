const fs = require("fs");
const os = require("os");
const path = require("path");
const { KNOWN_TARGETS, IS_WINDOWS } = require("./constants");

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
    if (IS_WINDOWS) {
      // On Windows, X_OK is unreliable; check that the file exists and has a
      // recognised executable extension.
      fs.accessSync(filePath, fs.constants.F_OK);
      const ext = path.extname(filePath).toLowerCase();
      return [".exe", ".cmd", ".bat", ".com", ".ps1"].includes(ext) || ext === "";
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function resolveCommand(binaryName) {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  // On Windows, when binaryName lacks an extension, also try PATHEXT variants
  const extensions = IS_WINDOWS && !path.extname(binaryName)
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  const candidates = [];
  for (const dir of pathEntries) {
    for (const ext of extensions) {
      candidates.push(path.join(dir, binaryName + ext));
    }
  }

  // Platform-specific fallback directories
  if (IS_WINDOWS) {
    const appData = process.env.LOCALAPPDATA || path.resolve(os.homedir(), "AppData/Local");
    for (const ext of extensions) {
      candidates.push(path.resolve(appData, "Microsoft/WindowsApps", binaryName + ext));
      candidates.push(path.resolve(os.homedir(), "AppData/Roaming/npm", binaryName + ext));
    }
  } else {
    candidates.push(
      path.resolve(os.homedir(), ".npm-global/bin", binaryName),
      path.resolve(os.homedir(), ".local/bin", binaryName),
      path.resolve("/opt/homebrew/bin", binaryName),
      path.resolve("/usr/local/bin", binaryName)
    );
  }

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
  if (normalized.endsWith("settings.json") && normalized.includes(`${path.sep}.claude${path.sep}`)) return "claude";
  if (normalized.endsWith("settings.json") && normalized.includes(`${path.sep}.gemini${path.sep}`)) return "gemini";
  if (normalized.endsWith("settings.json") && normalized.includes(`${path.sep}.qwen${path.sep}`)) return "qwen";
  if (normalized.endsWith("config.json") && normalized.includes(`${path.sep}.opencode${path.sep}`)) return "opencode";
  if (normalized.endsWith("config.toml") && normalized.includes(`${path.sep}.codex${path.sep}`)) return "codex";
  if (normalized.endsWith(".json") && !normalized.includes("settings.json")) return "openclaw";
  if (normalized.endsWith(".toml") && !normalized.includes("config.toml")) return "kimi";
  if (path.basename(normalized) === "openclaw.json") return "openclaw";
  if (path.basename(normalized) === "config.toml" && normalized.includes(`${path.sep}.kimi${path.sep}`)) return "kimi";
  return null;
}
function listAvailableTargets() {
  return KNOWN_TARGETS.flatMap((target) => {
    const binaryPath = target.binaryName ? resolveCommand(target.binaryName) : null;
    const filePresent = exists(target.path);
    const available = Boolean(binaryPath || filePresent || target.allowCreate);
    if (!available) return [];
    return [{ ...target, binaryPath, filePresent }];
  });
}
function fallbackBackupPath(filePath) {
  const safeName = filePath.replace(/[\\/]/g, "_").replace(/^_+/, "");
  return path.resolve(os.tmpdir(), "piramyd-onboard-backups", `${safeName}.bak.${Date.now()}`);
}
function safeChmod(filePath, mode) {
  if (IS_WINDOWS) return; // chmod is a no-op on Windows
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Silently ignore on filesystems that don't support chmod
  }
}
function backupIfPresent(filePath, backups) {
  if (!exists(filePath)) return null;
  const original = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  let backup = `${filePath}.bak.${Date.now()}`;
  try {
    ensureParentDir(backup);
    fs.writeFileSync(backup, original);
    safeChmod(backup, stats.mode);
  } catch {
    backup = fallbackBackupPath(filePath);
    ensureParentDir(backup);
    fs.writeFileSync(backup, original);
    safeChmod(backup, stats.mode);
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
  if (typeof mode === "number") safeChmod(filePath, mode);
}

module.exports = {
  exists, existsPath, isExecutable, resolveCommand, aliasFromId,
  coercePositiveNumber, maskApiKey, escapeRegex, stripAnsi, visibleLength,
  truncateMiddle, wrapPlainLine, padRight, renderTomlString, renderTomlKey,
  renderTomlArray, renderShellString, renderInlineTomlTable, normalizeConfigPath,
  detectConfigKind, listAvailableTargets, fallbackBackupPath, backupIfPresent,
  ensureParentDir, writeFileWithMode, safeChmod
};
