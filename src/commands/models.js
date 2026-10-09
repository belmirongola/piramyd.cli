const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, ok, muted, em, DIVIDER, clearCurrentTerminalLine, updateModelProbeProgress, renderBanner } = require("../ui");
const { listAvailableTargets, truncateMiddle, padRight } = require("../utils");
const { loadCatalog, modelHasVision, VISION_ICON } = require("../catalog");
const { findReusableApiKey } = require("../diagnosis");
const { probeModelsConcurrent } = require("../model-probes");
const { obtainApiKey, authHint } = require("../key-flow");
const { summarizeProbeResults, filterModels, formatSeconds } = require("../model-summary");

const MODEL_STATUS_WIDTH = 8;

const MODEL_NAME_WIDTH = 32;

const MODEL_VISION_WIDTH = 2;

const MODEL_LATENCY_WIDTH = 8;

const MODEL_RESPONSE_WIDTH = 26;

function showModelProbeResults(catalog, results) {
  const summary = summarizeProbeResults(results);
  const visionCount = catalog.models.filter((model) => modelHasVision(model)).length;
  const downRows = results.filter((result) => !result.ok);

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Models checked:")} ${summary.total}  ${ok(String(summary.up))} up  ${summary.down ? pc.red(String(summary.down)) : muted("0")} down`);
  console.log(`  ${em("Latency:")} median ${em(formatSeconds(summary.p50_ms))}  p95 ${em(formatSeconds(summary.p95_ms))}  slowest ${em(formatSeconds(summary.slowest_ms))}`);
  console.log(`  ${em("Vision models:")} ${brand(VISION_ICON)} ${String(visionCount)}`);
  if (downRows.length) {
    console.log("");
    console.log(`  ${em("Down:")}`);
    for (const row of downRows) {
      console.log(`    ${pc.red("\u25cf")} ${padRight(truncateMiddle(row.modelId, MODEL_NAME_WIDTH), MODEL_NAME_WIDTH)} ${muted(truncateMiddle(String(row.message || "failed"), 40))}`);
    }
  }
  console.log(DIVIDER);
  console.log("");
}

function formatModelProbeRow(catalog, result) {
  const model = catalog.models.find((entry) => entry.id === result.modelId);
  const status = result.ok ? ok("● UP") : pc.red("● DOWN");
  const latency = formatSeconds(result.latencyMs);
  const name = model ? model.id : result.modelId;
  const vision = padRight(modelHasVision(model) ? brand(VISION_ICON) : "", MODEL_VISION_WIDTH);
  const paddedStatus = padRight(status, MODEL_STATUS_WIDTH);
  const paddedName = padRight(truncateMiddle(name, MODEL_NAME_WIDTH), MODEL_NAME_WIDTH);
  const paddedLatency = padRight(truncateMiddle(latency, MODEL_LATENCY_WIDTH), MODEL_LATENCY_WIDTH);
  const detailText = truncateMiddle(String(result.message || "failed"), MODEL_RESPONSE_WIDTH);
  const paddedDetails = result.ok
    ? padRight(muted(detailText), MODEL_RESPONSE_WIDTH)
    : padRight(pc.red(detailText), MODEL_RESPONSE_WIDTH);
  return `  ${paddedStatus} ${paddedName} ${vision} ${paddedLatency} ${paddedDetails}`;
}

function renderModelProbeHeader() {
  return `  ${padRight(muted("Status"), MODEL_STATUS_WIDTH)} ${padRight(muted("Model"), MODEL_NAME_WIDTH)} ${padRight(muted(VISION_ICON), MODEL_VISION_WIDTH)} ${padRight(muted("Latency"), MODEL_LATENCY_WIDTH)} ${padRight(muted("Response"), MODEL_RESPONSE_WIDTH)}`;
}

async function runModels(cli) {
  const jsonOut = cli.json;

  if (!jsonOut) {
    console.clear();
    console.log(renderBanner("Models", "Realtime model health check"));
    p.intro(pc.bgYellow(pc.black(" Piramyd Models ")));
  }

  const targets = listAvailableTargets();
  const apiKey = await obtainApiKey(cli, {
    configKey: targets.length ? findReusableApiKey(targets, targets[0]) : "",
    interactive: !jsonOut,
  });
  if (!apiKey) throw new Error("No API key: run `piramyd login`, or pass --api-key / PIRAMYD_API_KEY");

  const spinner = jsonOut ? null : p.spinner();
  if (spinner) spinner.start("Loading model catalog from Piramyd...");

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    if (spinner) spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${String(catalog.tier || "unknown").toUpperCase()})`)}`);
  } catch (error) {
    if (spinner) spinner.stop(`Catalog load failed ${muted(`(${authHint(error)})`)}`);
    else console.error(JSON.stringify({ error: authHint(error) }));
    process.exit(1);
  }

  const models = filterModels(catalog.models, cli.filter);
  if (!models.length) {
    const reason = cli.filter ? `No model matches "${cli.filter}".` : "The catalog has no models.";
    if (jsonOut) console.log(JSON.stringify({ tier: catalog.tier, summary: summarizeProbeResults([]), results: [], note: reason }));
    else p.outro(reason);
    return;
  }
  const probeCatalog = { ...catalog, models };

  if (jsonOut) {
    const results = await probeModelsConcurrent(apiKey, models, { concurrency: cli.concurrency });
    console.log(JSON.stringify({
      tier: catalog.tier,
      summary: summarizeProbeResults(results),
      results: results.map((result) => ({
        model: result.modelId,
        ok: Boolean(result.ok),
        latency_ms: result.latencyMs ?? null,
        status_code: result.statusCode ?? null,
        message: result.message || null,
      })),
    }, null, 2));
    process.exitCode = results.some((result) => result.ok) ? 0 : 1;
    return;
  }

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Probing:")} ${models.length} models with concurrency ${em(String(cli.concurrency))}${cli.filter ? ` ${muted(`(filter "${cli.filter}")`)}` : ""}`);
  console.log(DIVIDER);
  console.log("");
  let progressFrame = 0;
  updateModelProbeProgress(0, models.length, progressFrame);
  console.log("");
  console.log(renderModelProbeHeader());
  console.log(`  ${brand(VISION_ICON)} ${muted("= computer vision / multimodal")}`);
  console.log("");

  let completed = 0;
  const results = await probeModelsConcurrent(apiKey, models, {
    concurrency: cli.concurrency,
    onResult(result) {
      completed += 1;
      progressFrame += 1;
      clearCurrentTerminalLine();
      console.log(formatModelProbeRow(probeCatalog, result));
      updateModelProbeProgress(completed, models.length, progressFrame);
    },
  });

  console.log("");

  showModelProbeResults(probeCatalog, results);
  p.outro(results.some((result) => result.ok) ? ok("Model check completed.") : pc.red("Every model failed \u2014 check your key and network."));
  process.exitCode = results.some((result) => result.ok) ? 0 : 1;
}

module.exports = { runModels };
