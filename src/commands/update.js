const p = require("@clack/prompts");
const pc = require("picocolors");
const { ok, muted, em, VERSION } = require("../ui");
const { compareVersions, fetchLatestVersion } = require("../update");

async function runUpdate(cli) {
  let latest;
  try {
    latest = await fetchLatestVersion();
  } catch (err) {
    if (cli.json) {
      console.log(JSON.stringify({ current: VERSION, latest: null, error: err.message }));
    } else {
      p.log.error(`Could not reach the npm registry (${err.message}).`);
    }
    process.exitCode = 1;
    return;
  }

  const cmp = compareVersions(VERSION, latest);
  const upToDate = cmp === null ? VERSION === latest : cmp >= 0;
  if (cli.json) {
    console.log(JSON.stringify({ current: VERSION, latest, up_to_date: upToDate }));
    return;
  }
  if (upToDate) {
    p.log.success(`Piramyd toolkit ${em(`v${VERSION}`)} is up to date.`);
    return;
  }
  p.log.warn(`New version available: ${muted(`v${VERSION}`)} \u2192 ${ok(`v${latest}`)}`);
  p.log.message(`  Run ${pc.bold("npx piramyd@latest")} (or ${pc.bold("npm i -g piramyd@latest")}) to update.`);
}

module.exports = { runUpdate };
