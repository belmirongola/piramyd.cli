const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, ok, muted, em, DIVIDER, renderBanner } = require("../ui");
const { truncateMiddle, padRight } = require("../utils");
const { loadCatalog, VISION_ICON } = require("../catalog");
const { DEFAULT_API_URL, fetchLatestProbeRun, summarizeSession, relativeAge, checkModelsContract } = require("../prober");
const { SLOT_ADMIN, isPiramydKey } = require("../credentials");
const { obtainApiKey } = require("../key-flow");

const PROBE_STATUS_WIDTH = 9;

const PROBE_NAME_WIDTH = 34;

const PROBE_FLAG_WIDTH = 5;

const PROBE_COUNT_WIDTH = 9;

const PROBE_CONF_WIDTH = 6;

const PROBE_TIME_WIDTH = 8;

// ── prober (last probe round from the database) ─────────────────
function proberFlagCell(value) {
  if (value === true) return ok("✓");
  if (value === false) return pc.red("✗");
  return muted("?");
}

function renderProberHeader() {
  return `  ${padRight(muted("Status"), PROBE_STATUS_WIDTH)} ${padRight(muted("Model"), PROBE_NAME_WIDTH)} ${padRight(muted(VISION_ICON), PROBE_FLAG_WIDTH)} ${padRight(muted("Tool"), PROBE_FLAG_WIDTH)} ${padRight(muted("Strm"), PROBE_FLAG_WIDTH)} ${padRight(muted("Probes"), PROBE_COUNT_WIDTH)} ${padRight(muted("Conf"), PROBE_CONF_WIDTH)} ${padRight(muted("Time"), PROBE_TIME_WIDTH)} ${padRight(muted("Age"), PROBE_TIME_WIDTH)}`;
}

function formatProberRow(row) {
  const statusText =
    row.status === "completed" && !row.error
      ? ok("● OK")
      : row.status === "failed" || row.status === "error"
        ? pc.red(`● ${String(row.status).toUpperCase()}`)
        : muted(`● ${String(row.status || "?").toUpperCase()}`);

  const name = truncateMiddle(`${row.provider}/${row.model}`, PROBE_NAME_WIDTH);
  const vision =
    row.supportsVision === true
      ? brand(VISION_ICON)
      : row.supportsVision === false
        ? pc.red("✗")
        : muted("?");
  const count = row.probesTotal > 0 ? `${row.probesOk}/${row.probesTotal}` : muted("-");
  const conf = typeof row.confidence === "number" ? `${Math.round(row.confidence * 100)}%` : muted("-");
  const time = typeof row.elapsedMs === "number" ? `${(row.elapsedMs / 1000).toFixed(1)}s` : muted("-");
  const age = relativeAge(row.probedAt) || muted("-");

  const line = `  ${padRight(statusText, PROBE_STATUS_WIDTH)} ${padRight(name, PROBE_NAME_WIDTH)} ${padRight(vision, PROBE_FLAG_WIDTH)} ${padRight(proberFlagCell(row.supportsTools), PROBE_FLAG_WIDTH)} ${padRight(proberFlagCell(row.supportsStreaming), PROBE_FLAG_WIDTH)} ${padRight(count, PROBE_COUNT_WIDTH)} ${padRight(conf, PROBE_CONF_WIDTH)} ${padRight(time, PROBE_TIME_WIDTH)} ${padRight(age, PROBE_TIME_WIDTH)}`;

  const flags = [];
  if (row.finishReasonInvalid) {
    flags.push(pc.red(`⚠ bad finish_reason mid-stream (${row.finishReasonInvalidValues.map((v) => JSON.stringify(v)).join(", ")})`));
  }
  if (row.nonStandardErrors) flags.push(pc.yellow("⚠ non-standard error shape"));

  return flags.length ? `${line}\n  ${padRight("", PROBE_STATUS_WIDTH)} ${flags.join("  ")}` : line;
}

function showProberSummary(rows) {
  const completed = rows.filter((row) => row.status === "completed" && !row.error).length;
  const failed = rows.length - completed;
  const vision = rows.filter((row) => row.supportsVision === true).length;
  const ages = rows.map((row) => relativeAge(row.probedAt)).filter(Boolean);
  console.log(DIVIDER);
  console.log(`  ${em("Models in last round:")} ${rows.length}  ${ok(String(completed))} ok  ${pc.red(String(failed))} failed`);
  console.log(`  ${em("Vision models:")} ${brand(VISION_ICON)} ${String(vision)}`);
  if (ages.length) {
    console.log(`  ${em("Probed:")} ${muted(`${ages[ages.length - 1]} – ${ages[0]} ago`)}`);
  }
  const errs = rows.filter((row) => row.error);
  if (errs.length) {
    console.log("");
    for (const row of errs) {
      console.log(`  ${pc.red("!")} ${row.provider}/${row.model} ${muted("—")} ${truncateMiddle(String(row.error), 60)}`);
    }
  }
  const integrity = rows.filter((row) => row.finishReasonInvalid || row.nonStandardErrors);
  if (integrity.length) {
    console.log("");
    console.log(`  ${pc.yellow(`⚠ ${integrity.length} model${integrity.length === 1 ? "" : "s"} with known response-integrity issues`)} ${muted("— run `npx piramyd prober --live` to re-verify against the live API")}`);
  }
  console.log(DIVIDER);
  console.log("");
}

// ── prober --live (real request against the public API, right now) ──
function renderLiveHeader() {
  return `  ${padRight(muted("Result"), PROBE_STATUS_WIDTH)} ${padRight(muted("Model"), PROBE_NAME_WIDTH)} ${padRight(muted("Time"), PROBE_TIME_WIDTH)} ${muted("Issues")}`;
}

function formatLiveRow(result) {
  const statusText = result.ok ? ok("● OK") : pc.red("● FAIL");
  const name = truncateMiddle(result.modelId, PROBE_NAME_WIDTH);
  const time = `${(result.elapsedMs / 1000).toFixed(1)}s`;
  const issues = result.ok ? "" : result.issues.map((i) => pc.red(i)).join("; ");
  return `  ${padRight(statusText, PROBE_STATUS_WIDTH)} ${padRight(name, PROBE_NAME_WIDTH)} ${padRight(time, PROBE_TIME_WIDTH)} ${issues}`;
}

async function runProberLive(cli) {
  const jsonOut = cli.json;

  if (!jsonOut) {
    console.clear();
    console.log(renderBanner("Models", "Realtime model health check"));
    p.intro(pc.bgYellow(pc.black(" Piramyd Prober — live contract check ")));
  }

  const apiKey = await obtainApiKey(cli, { interactive: !jsonOut });
  if (!isPiramydKey(apiKey)) {
    throw new Error("prober --live requires an API key: run `piramyd login`, or pass --api-key / PIRAMYD_API_KEY");
  }

  const apiUrl = (cli.apiBase || DEFAULT_API_URL).replace(/\/+$/, "");

  let modelIds = [];
  if (cli.model) {
    modelIds = [cli.model];
  } else if (cli.all) {
    const spinner = jsonOut ? null : p.spinner();
    if (spinner) spinner.start("Loading catalog...");
    try {
      const catalog = await loadCatalog(apiKey);
      modelIds = catalog.models.map((m) => m.id);
    } catch (err) {
      if (spinner) spinner.stop(pc.red("Could not load catalog."));
      throw new Error(`catalog load failed: ${err.message || err}`);
    }
    if (spinner) spinner.stop(`${em(String(modelIds.length))} models in catalog`);
  } else {
    throw new Error("prober --live requires --model <id> (one model) or --all (whole catalog).");
  }

  const spinner = jsonOut ? null : p.spinner();
  if (spinner) spinner.start(`Sending real requests to ${modelIds.length} model${modelIds.length === 1 ? "" : "s"}...`);

  const results = await checkModelsContract(apiUrl, apiKey, modelIds, {
    concurrency: 3,
    timeoutMs: 30_000,
    onProgress: (_result, done, total) => {
      if (spinner) spinner.message(`Checked ${done}/${total}...`);
    },
  });

  const failed = results.filter((r) => !r.ok);

  if (spinner) {
    spinner.stop(
      failed.length
        ? pc.red(`${failed.length}/${results.length} model(s) failed the contract check`)
        : ok(`All ${results.length} model(s) passed the contract check`)
    );
  }

  if (jsonOut) {
    console.log(JSON.stringify({ ok: failed.length === 0, api: apiUrl, total: results.length, failed: failed.length, results }, null, 2));
    if (failed.length) process.exitCode = 1;
    return;
  }

  console.log(DIVIDER);
  console.log(`  ${em("Target:")}   ${apiUrl}/v1/chat/completions`);
  console.log(`  ${em("Checks:")}   finish_reason validity (every stream chunk) · model identity leak · provider/system_fingerprint leak`);
  console.log(DIVIDER);
  console.log("");
  console.log(renderLiveHeader());
  for (const result of results) {
    console.log(formatLiveRow(result));
  }
  console.log("");
  console.log(DIVIDER);
  console.log(`  ${em("Passed:")} ${ok(String(results.length - failed.length))}  ${em("Failed:")} ${failed.length ? pc.red(String(failed.length)) : "0"}`);
  console.log(DIVIDER);
  console.log("");

  if (failed.length) {
    process.exitCode = 1;
    p.outro(pc.red(`${failed.length} model(s) failed — see Issues column above.`));
  } else {
    p.outro(ok("All checked models honor the response contract."));
  }
}

async function runProber(cli) {
  const jsonOut = cli.json;

  if (!jsonOut) {
    console.clear();
    console.log(renderBanner("Models", "Realtime model health check"));
    p.intro(pc.bgYellow(pc.black(" Piramyd Prober ")));
  }

  const apiKey = await obtainApiKey(cli, { slot: SLOT_ADMIN, interactive: !jsonOut });
  if (!isPiramydKey(apiKey)) {
    throw new Error("prober requires an admin API key: pass --api-key once (it is saved), or set PIRAMYD_API_KEY");
  }

  const apiUrl = (cli.apiBase || DEFAULT_API_URL).replace(/\/+$/, "");

  const spinner = jsonOut ? null : p.spinner();
  if (spinner) spinner.start("Loading the last probe round from piramyd.api...");

  let items;
  try {
    items = await fetchLatestProbeRun(apiUrl, apiKey, { model: cli.model });
  } catch (err) {
    if (spinner) spinner.stop(pc.red("Could not load probe sessions."));
    if (err.statusCode === 403) {
      throw new Error("This API key does not belong to an admin user.");
    }
    throw new Error(`prober/latest failed: ${err.message || err}`);
  }

  const rows = items.map(summarizeSession);

  if (spinner) {
    spinner.stop(`${em(String(rows.length))} model${rows.length === 1 ? "" : "s"} in the last probe round`);
  }

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, api: apiUrl, total: rows.length, items: rows }, null, 2));
    return;
  }

  if (!rows.length) {
    p.outro(cli.model ? `No stored probe session for "${cli.model}".` : "No probe sessions stored yet.");
    return;
  }

  console.log(DIVIDER);
  console.log(`  ${em("Source:")}   ${apiUrl}/v1/admin/prober/latest`);
  console.log(`  ${em("Models:")}   ${rows.length}${cli.model ? muted(`  (filter: ${cli.model})`) : ""}`);
  console.log(DIVIDER);
  console.log("");
  console.log(renderProberHeader());
  console.log(`  ${brand(VISION_ICON)} ${muted("= computer vision / multimodal")}`);
  console.log("");
  for (const row of rows) {
    console.log(formatProberRow(row));
  }
  console.log("");
  showProberSummary(rows);
  p.outro(ok("Last probe round shown."));
}

module.exports = { runProberLive, runProber };
