const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, accent, ok, muted, em, renderBanner } = require("../ui");
const { listAvailableTargets } = require("../utils");
const { loadCatalog } = require("../catalog");
const { writeConfig } = require("../patchers");
const { getExistingApiKey, findReusableApiKey, targetNeedsRepair, codexShimHealth, syncClaudeState } = require("../diagnosis");
const { isPiramydKey } = require("../credentials");
const { showSuccess } = require("./onboard");

// ── Doctor mode ─────────────────────────────────────────────────
async function runDoctor() {
  console.clear();
  console.log(renderBanner("Doctor", "Auto-repair for CLI configurations"));
  p.intro(pc.bgYellow(pc.black(" Piramyd Doctor ")));

  const spinner = p.spinner();
  spinner.start("Scanning for configured CLI instances...");

  const allTargets = listAvailableTargets();
  if (!allTargets.length) {
    spinner.stop("No supported CLI targets found in your PATH.", 1);
    process.exit(1);
  }

  let foundApiKey = "";
  let targetsNeedingRepair = [];

  for (const target of allTargets) {
    const key = getExistingApiKey(target) || findReusableApiKey(allTargets, target);
    if (isPiramydKey(key)) foundApiKey = key;
    if (targetNeedsRepair(target)) targetsNeedingRepair.push(target);
  }

  // Surface CCLI-level shim errors before attributing anything to implementation/key issues
  const shimStatus = codexShimHealth();
  if (!shimStatus.healthy) {
    spinner.stop(pc.yellow("⚠ Codex Node shim has a problem — this is a CCLI-level issue, not a configuration error."));
    p.log.warn([
      `  Shim path: ${accent(require("../src/constants").CODEX_NODE_SHIM_PATH)}`,
      `  Problem:   ${pc.red(shimStatus.error || "unknown error")}`,
      "",
      "  The shim will be regenerated when you proceed with the repair below.",
      `  This is typically caused by a Node.js version incompatibility (${muted("e.g., Node.js v25+ strict quote parsing")}).`,
    ].join("\n"));
  }

  if (targetsNeedingRepair.length === 0) {
    spinner.stop(ok("All targets are correctly configured. Nothing to repair."));
    p.outro(ok("Your setup is healthy."));
    process.exit(0);
  }

  if (!foundApiKey) {
    spinner.stop("Targets need configuration, but no existing Piramyd API key was found.");
    p.cancel("Run `npx piramyd` normally to onboard.");
    process.exit(1);
  }

  const repairList = targetsNeedingRepair.map(t => brand(t.label)).join(muted(", "));
  spinner.stop(`Found ${em(String(targetsNeedingRepair.length))} target(s) needing repair: ${repairList}`);

  const apply = await p.confirm({
    message: `Attempt automatic repair? ${muted(`(using key ending in ...${foundApiKey.slice(-4)})`)}`,
    initialValue: true,
  });

  if (p.isCancel(apply) || !apply) { p.cancel('Operation cancelled.'); process.exit(0); }

  spinner.start("Refreshing catalog from Piramyd...");
  let catalog;
  try {
    catalog = await loadCatalog(foundApiKey);
    spinner.stop(`Catalog refreshed: ${em(String(catalog.models.length))} models found.`);
  } catch (err) {
    spinner.stop(pc.red("Catalog refresh failed."));
    p.cancel(err.message || String(err));
    process.exit(1);
  }

  const results = [];
  spinner.start("Repairing configurations...");
  for (const target of targetsNeedingRepair) {
    spinner.message(`Updating ${brand(target.label)}...`);
    const writeResult = writeConfig(target, foundApiKey, catalog);
    results.push({ target, ...writeResult });
  }
  spinner.stop(ok("Configurations repaired."));

  const includesClaude = allTargets.some((target) => target.kind === "claude");
  let claudeSync = null;
  if (includesClaude) {
    spinner.start("Syncing Claude state into claude-piramyd...");
    claudeSync = syncClaudeState();
    const syncedCount = claudeSync.synced.length;
    const skippedCount = claudeSync.skipped.length;
    spinner.stop(`Claude sync complete: ${em(String(syncedCount))} item(s) synced${skippedCount ? `, ${muted(String(skippedCount))} skipped` : ""}.`);
  }

  showSuccess({ results, catalog });
  if (claudeSync && claudeSync.synced.length) {
    const sample = claudeSync.synced.slice(0, 6).join(muted(", "));
    p.log.step(`Claude shared state synced: ${sample}${claudeSync.synced.length > 6 ? muted(", ...") : ""}`);
  }
  p.outro(ok("Doctor completed successfully!"));
}

module.exports = { runDoctor };
