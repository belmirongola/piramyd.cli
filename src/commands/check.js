const p = require("@clack/prompts");
const pc = require("picocolors");
const { ok, muted, DIVIDER, renderBanner } = require("../ui");
const { listAvailableTargets, truncateMiddle, padRight } = require("../utils");
const { loadCatalog } = require("../catalog");
const { findReusableApiKey } = require("../diagnosis");
const { inspectAllTargets } = require("../ops");
const { obtainApiKey, authHint } = require("../key-flow");
const { checkChat, checkStream } = require("../gateway-check");
const { formatMs } = require("../model-summary");

function row(result) {
  const mark = result.ok ? ok("\u2713") : pc.red("\u2717");
  const detail = result.ok ? muted(result.detail) : pc.red(result.detail);
  return `  ${mark} ${padRight(truncateMiddle(result.name, 28), 28)} ${padRight(muted(formatMs(result.ms)), 8)} ${detail}`;
}

/** `piramyd test`: the same calls a coding CLI makes, plus the state of each configured CLI. */
async function runTest(cli) {
  const jsonOut = cli.json;
  if (!jsonOut) {
    console.log(renderBanner("Test", "End-to-end check of key, models and configured CLIs"));
    p.intro(pc.bgYellow(pc.black(" Piramyd Test ")));
  }

  const targets = listAvailableTargets();
  const apiKey = await obtainApiKey(cli, {
    configKey: targets.length ? findReusableApiKey(targets, targets[0]) : "",
    interactive: !jsonOut,
  });
  if (!apiKey) throw new Error("No API key: run `piramyd login`, or pass --api-key / PIRAMYD_API_KEY");

  const results = [];
  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    results.push({ name: "key + catalog", ok: true, ms: 0, detail: `tier ${String(catalog.tier).toUpperCase()}, ${catalog.models.length} models` });
  } catch (err) {
    results.push({ name: "key + catalog", ok: false, ms: 0, detail: authHint(err) });
  }

  if (catalog) {
    const model = cli.model || catalog.defaultModelId || (catalog.models[0] && catalog.models[0].id);
    const spinner = jsonOut ? null : p.spinner();
    if (spinner) spinner.start("Calling the gateway...");
    results.push(await checkChat(apiKey, model));
    results.push(await checkStream(apiKey, model));
    // The Kairos fallback must always answer, whatever the catalog says.
    results.push(await checkChat(apiKey, "kairos", "chat (kairos fallback)"));
    if (spinner) spinner.stop("Gateway checks finished.");
  }

  for (const target of inspectAllTargets().filter((item) => item.configured)) {
    results.push({
      name: `${target.label} config`,
      ok: target.healthy,
      ms: 0,
      detail: target.healthy ? "points at Piramyd" : "needs repair \u2014 run `piramyd doctor`",
    });
  }

  const failed = results.filter((result) => !result.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
  } else {
    console.log("");
    console.log(DIVIDER);
    for (const result of results) console.log(row(result));
    console.log(DIVIDER);
    console.log("");
    p.outro(failed.length ? pc.red(`${failed.length} of ${results.length} checks failed.`) : ok(`All ${results.length} checks passed.`));
  }
  process.exitCode = failed.length ? 1 : 0;
}

module.exports = { runTest };
