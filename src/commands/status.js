const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, accent, ok, muted, em, DIVIDER_THIN, renderBanner } = require("../ui");
const { truncateMiddle } = require("../utils");
const { inspectAllTargets, restoreTarget } = require("../ops");

function runStatus(cli) {
  const rows = inspectAllTargets();
  if (cli.json) {
    console.log(JSON.stringify({ ok: true, targets: rows }, null, 2));
    return;
  }
  console.log(renderBanner());
  p.intro(pc.bgYellow(pc.black(" Status ")));
  for (const row of rows) {
    const state = !row.configured
      ? muted("not configured")
      : row.healthy
        ? ok("healthy")
        : pc.red("needs repair");
    const lines = [
      `  ${em(brand(row.label))}  ${muted(row.kind)}  ${state}`,
      `  ${muted("Binary")}   ${row.binaryPath || muted("not in PATH")}`,
      `  ${muted("Config")}   ${truncateMiddle(row.path, 55)} ${row.configExists ? ok("yes") : muted("no")}`,
    ];
    if (row.launcher) {
      lines.push(`  ${muted("Launcher")} ${row.launcher} ${row.launcherExists ? ok("yes") : muted("no")}`);
    }
    lines.push(`  ${muted("Key")}      ${row.hasKey ? accent(row.keyPreview) : muted("missing")}`);
    p.log.message(lines.join("\n"));
    p.log.message(`  ${DIVIDER_THIN}`);
  }
  const healthy = rows.filter((row) => row.healthy).length;
  p.outro(`${healthy}/${rows.length} targets healthy.`);
}

function runRestore(cli) {
  const kind = cli.targets[0];
  if (!kind) {
    throw new Error("restore requires --target <kind>");
  }
  const result = restoreTarget(kind);
  if (cli.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }
  p.log.success(`Restored ${result.label} from ${result.restoredFrom}`);
  p.outro(ok("Restore complete."));
}

module.exports = { runStatus, runRestore };
