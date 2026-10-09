const pc = require("picocolors");
const readline = require("readline");
const { version: VERSION } = require("../package.json");

// ── Brand system ────────────────────────────────────────────────
const brand   = (s) => pc.yellow(s);
const accent  = (s) => pc.yellow(s);
const ok      = (s) => pc.green(s);
const warn    = (s) => pc.yellow(s);
const bad     = (s) => pc.red(s);
const muted   = (s) => pc.dim(s);
const em      = (s) => pc.bold(s);

const DIVIDER      = muted("\u2550".repeat(60));
const DIVIDER_THIN = muted("\u2500".repeat(40));

// ── Progress ────────────────────────────────────────────────────
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

// ── Banner ──────────────────────────────────────────────────────
const BANNER = [
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 ",
  " \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u255A\u2588\u2588\u2557 \u2588\u2588\u2554\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557",
  " \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2554\u255D \u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u2588\u2588\u2554\u2550\u2550\u2550\u255D \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551\u255A\u2588\u2588\u2554\u255D\u2588\u2588\u2551  \u255A\u2588\u2588\u2554\u255D  \u2588\u2588\u2551  \u2588\u2588\u2551",
  " \u2588\u2588\u2551     \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551 \u255A\u2550\u255D \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D",
  " \u255A\u2550\u255D     \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D     \u255A\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u255D ",
].join("\n");

/** One banner for every command; `title`/`subtitle` replace the per-command copies. */
function renderBanner(title, subtitle) {
  const tagline = title
    ? `  ${accent(title)}  ${muted("\u2502")}  ${muted(subtitle || "")}`
    : `  ${muted("Universal AI Gateway")}  ${muted("\u2502")}  ${em(`v${VERSION}`)}`;
  return ["", brand(BANNER), "", tagline, "", DIVIDER, ""].join("\n");
}

module.exports = {
  VERSION,
  brand,
  accent,
  ok,
  warn,
  bad,
  muted,
  em,
  DIVIDER,
  DIVIDER_THIN,
  BANNER,
  PROBE_PROGRESS_FRAMES,
  renderModelProbeProgress,
  updateModelProbeProgress,
  clearCurrentTerminalLine,
  renderBanner,
};
