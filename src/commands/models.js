const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, ok, muted, em, DIVIDER, clearCurrentTerminalLine, updateModelProbeProgress, renderBanner } = require("../ui");
const { listAvailableTargets, truncateMiddle, padRight } = require("../utils");
const { loadCatalog, modelHasVision, VISION_ICON } = require("../catalog");
const { findReusableApiKey } = require("../diagnosis");
const { probeModelsConcurrent } = require("../model-probes");
const { obtainApiKey, authHint } = require("../key-flow");

const MODEL_STATUS_WIDTH = 8;

const MODEL_NAME_WIDTH = 32;

const MODEL_VISION_WIDTH = 2;

const MODEL_LATENCY_WIDTH = 8;

const MODEL_RESPONSE_WIDTH = 26;

function showModelProbeResults(catalog, results) {
  const upCount = results.filter((result) => result.ok).length;
  const downCount = results.length - upCount;
  const visionCount = catalog.models.filter((model) => modelHasVision(model)).length;

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Models checked:")} ${results.length}  ${ok(String(upCount))} up  ${pc.red(String(downCount))} down`);
  console.log(`  ${em("Vision models:")} ${brand(VISION_ICON)} ${String(visionCount)}`);
  console.log(DIVIDER);
  console.log("");
}

function formatModelProbeRow(catalog, result) {
  const model = catalog.models.find((entry) => entry.id === result.modelId);
  const status = result.ok ? ok("● UP") : pc.red("● DOWN");
  const latency = result.latencyMs ? `${result.latencyMs}ms` : "-";
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
  console.clear();
  console.log(renderBanner("Models", "Realtime model health check"));
  p.intro(pc.bgYellow(pc.black(" Piramyd Models ")));

  const targets = listAvailableTargets();
  const apiKey = await obtainApiKey(cli, { configKey: targets.length ? findReusableApiKey(targets, targets[0]) : "" });

  const spinner = p.spinner();
  spinner.start("Loading model catalog from Piramyd...");

  let catalog;
  try {
    catalog = await loadCatalog(apiKey);
    spinner.stop(`Catalog loaded: ${em(String(catalog.models.length))} models ${muted(`(tier ${String(catalog.tier || "unknown").toUpperCase()})`)}`);
  } catch (error) {
    spinner.stop(`Catalog load failed ${muted(`(${authHint(error)})`)}`);
    process.exit(1);
  }

  console.log(DIVIDER);
  console.log(`  ${em("Tier:")} ${brand(String(catalog.tier || "unknown").toUpperCase())}`);
  console.log(`  ${em("Probing:")} ${catalog.models.length} models with concurrency ${em("4")}`);
  console.log(DIVIDER);
  console.log("");
  let progressFrame = 0;
  updateModelProbeProgress(0, catalog.models.length, progressFrame);
  console.log("");
  console.log(renderModelProbeHeader());
  console.log(`  ${brand(VISION_ICON)} ${muted("= computer vision / multimodal")}`);
  console.log("");

  let completed = 0;
  const results = await probeModelsConcurrent(apiKey, catalog.models, {
    concurrency: 4,
    onResult(result) {
      completed += 1;
      progressFrame += 1;
      clearCurrentTerminalLine();
      console.log(formatModelProbeRow(catalog, result));
      updateModelProbeProgress(completed, catalog.models.length, progressFrame);
    },
  });

  console.log("");

  showModelProbeResults(catalog, results);
  p.outro(ok("Model check completed."));
}

module.exports = { runModels };
