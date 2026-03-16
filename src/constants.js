const os = require("os");
const path = require("path");

const PIRAMYD_ROOT_URL = "https://api.piramyd.cloud";
const PIRAMYD_OPENAI_BASE_URL = `${PIRAMYD_ROOT_URL}/v1`;
const PIRAMYD_ANTHROPIC_BASE_URL = PIRAMYD_ROOT_URL;

const CODEX_PROFILE = "piramyd";
const CODEX_MODEL_PROVIDER = "piramyd";
const GENERATED_START = "# >>> piramyd-onboard:start";
const GENERATED_END = "# <<< piramyd-onboard:end";

const IS_WINDOWS = os.platform() === "win32";

const LOCAL_BIN_DIR = IS_WINDOWS
  ? path.resolve(os.homedir(), "AppData/Local/Microsoft/WindowsApps") // common in PATH on Windows
  : path.resolve(os.homedir(), ".local/bin");

const CODEX_SECRET_PATH = path.resolve(os.homedir(), ".codex", "piramyd.env");
const CODEX_LAUNCHER_PATH = path.resolve(LOCAL_BIN_DIR, IS_WINDOWS ? "codex-piramyd.cmd" : "codex-piramyd");

const KNOWN_TARGETS = [
  {
    kind: "codex",
    label: "Codex CLI",
    summary: "Create a Piramyd launcher, store a dedicated profile, and keep the API key in a locked env file.",
    path: path.resolve(os.homedir(), ".codex", "config.toml"),
    binaryName: IS_WINDOWS ? "codex.exe" : "codex",
    allowCreate: true,
  },
  {
    kind: "claude",
    label: "Claude Code",
    summary: "Patch ~/.claude/settings.json to use Piramyd's Anthropic-compatible gateway and Claude aliases.",
    path: path.resolve(os.homedir(), ".claude", "settings.json"),
    binaryName: IS_WINDOWS ? "claude.cmd" : "claude",
    allowCreate: true,
  },
  {
    kind: "kimi",
    label: "Kimi Code",
    summary: "Patch ~/.kimi/config.toml and preserve native Kimi blocks.",
    path: path.resolve(os.homedir(), ".kimi", "config.toml"),
    binaryName: IS_WINDOWS ? "kimi.exe" : "kimi",
  },
  {
    kind: "openclaw",
    label: "OpenClaw",
    summary: "Patch ~/.openclaw/openclaw.json with Piramyd provider models.",
    path: path.resolve(os.homedir(), ".openclaw", "openclaw.json"),
    binaryName: IS_WINDOWS ? "openclaw.cmd" : "openclaw",
  },
  {
    kind: "gemini",
    label: "Gemini CLI",
    summary: "Patch ~/.gemini/settings.json to set API key to Piramyd gateway.",
    path: path.resolve(os.homedir(), ".gemini", "settings.json"),
    binaryName: IS_WINDOWS ? "gemini.cmd" : "gemini",
    allowCreate: true,
  },
  {
    kind: "qwen",
    label: "Qwen CLI",
    summary: "Patch ~/.qwen/settings.json to configure Piramyd provider.",
    path: path.resolve(os.homedir(), ".qwen", "settings.json"),
    binaryName: IS_WINDOWS ? "qwen.cmd" : "qwen",
    allowCreate: true,
  },
  {
    kind: "opencode",
    label: "OpenCode",
    summary: "Patch ~/.opencode/config.json with Piramyd.",
    path: path.resolve(os.homedir(), ".opencode", "config.json"),
    binaryName: IS_WINDOWS ? "opencode.cmd" : "opencode",
    allowCreate: true,
  }
];

module.exports = {
  PIRAMYD_ROOT_URL, PIRAMYD_OPENAI_BASE_URL, PIRAMYD_ANTHROPIC_BASE_URL,
  CODEX_PROFILE, CODEX_MODEL_PROVIDER, GENERATED_START, GENERATED_END,
  LOCAL_BIN_DIR, CODEX_SECRET_PATH, CODEX_LAUNCHER_PATH, KNOWN_TARGETS, IS_WINDOWS
};
