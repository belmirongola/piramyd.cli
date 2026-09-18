/**
 * `piramyd prober` — read the last probe round from piramyd.api and print it.
 *
 * Authenticates with a normal Piramyd API key (sk-...); the API requires that
 * key to belong to an admin (superuser) account. Nothing is probed here — this
 * just reads what the scheduled cloud prober already stored.
 *
 *   GET {API}/v1/admin/prober/latest[?model=<provider_model_id>]
 *     -> { total, items: [ModelProbeSession, ...] }  (latest session per model)
 */
const https = require("https");
const { PIRAMYD_ROOT_URL } = require("./constants");

const DEFAULT_API_URL = PIRAMYD_ROOT_URL;

function httpRequest(method, url, token, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`invalid URL: ${url}`));
      return;
    }

    const req = https.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "piramyd-toolkit-prober/0.2",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          const status = Number(res.statusCode || 0);
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = { raw };
          }
          if (status < 200 || status >= 300) {
            const detail =
              (parsed && (parsed.message || parsed.error || parsed.detail)) ||
              String(raw || "").slice(0, 200).replace(/\s+/g, " ").trim();
            const err = new Error(`HTTP ${status}${detail ? ` - ${detail}` : ""}`);
            err.statusCode = status;
            err.body = parsed;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function fetchLatestProbeRun(apiUrl, apiKey, options = {}) {
  const base = String(apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  const params = [];
  if (options.model) params.push(`model=${encodeURIComponent(options.model)}`);
  if (options.limit) params.push(`limit=${encodeURIComponent(String(options.limit))}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  const data = await httpRequest(
    "GET",
    `${base}/v1/admin/prober/latest${qs}`,
    apiKey,
    options.timeoutMs || 30_000
  );
  return Array.isArray(data && data.items) ? data.items : [];
}

function relativeAge(isoOrDate, now = Date.now()) {
  if (!isoOrDate) return "";
  const then = new Date(isoOrDate).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 90) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function summarizeSession(item) {
  const session = item || {};
  const quirks = session.quirks || {};
  const results = Array.isArray(session.probe_results) ? session.probe_results : [];

  const probesTotal =
    session.probes_total !== undefined && session.probes_total !== null
      ? session.probes_total
      : results.length;
  const probesOk =
    session.probes_ok !== undefined && session.probes_ok !== null
      ? session.probes_ok
      : results.filter((r) => r.scored_ok === true || r.status === "ok").length;

  const confidenceRaw = Number(session.normalization_confidence);

  const num = (value, fallback) => (typeof value === "number" ? value : fallback);

  return {
    provider: session.provider || "",
    model: session.provider_model_id || "",
    registryId: num(session.model_id, null),
    sessionId: session.probe_session_id || null,
    status: session.status || "unknown",
    triggeredBy: session.triggered_by || "",
    probesTotal,
    probesOk,
    probesError: num(session.probes_error, 0),
    probesTimeout: num(session.probes_timeout, 0),
    confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : null,
    elapsedMs: typeof session.elapsed_ms === "number" ? session.elapsed_ms : null,
    supportsVision: "supports_vision" in quirks ? quirks.supports_vision : null,
    supportsTools: "supports_tools" in quirks ? quirks.supports_tools : null,
    supportsStreaming: "supports_streaming" in quirks ? quirks.supports_streaming : null,
    // Stored quirks from the last cloud probe round — surfaced here so
    // `npx piramyd prober` flags known integrity bugs (invalid mid-stream
    // finish_reason, non-standard error shapes) without a live re-check.
    finishReasonInvalid: quirks.streaming_finish_reason_invalid === true,
    finishReasonInvalidValues: Array.isArray(quirks.streaming_finish_reason_invalid_values)
      ? quirks.streaming_finish_reason_invalid_values
      : [],
    nonStandardErrors: quirks.non_standard_errors === true,
    probedAt: session.probed_at || session.created_at || null,
    error: session.error || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Live contract check — hits the real public API directly (not the stored
// probe DB) and validates the response Piramyd actually hands a client:
//   1. finish_reason (every stream chunk, and the final body) is null or a
//      valid OpenAI enum member — never "" or provider-specific garbage.
//   2. response.model always equals the model the client asked for — the
//      raw upstream/provider id must never leak, even when the request was
//      silently substituted internally (roteamento universal).
//   3. No "provider" / "system_fingerprint" key leaks upstream reseller info.
// This is what actually caught the swastic finish_reason:"" bug and the
// kagiro provider-name leak — both were invisible to a DB-only prober.
// ─────────────────────────────────────────────────────────────────────────

const VALID_FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
]);

function httpPostRaw(url, apiKey, body, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`invalid URL: ${url}`));
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = https.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          "User-Agent": "piramyd-toolkit-prober/0.2",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ statusCode: Number(res.statusCode || 0), body: raw }));
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.end(payload);
  });
}

function extractSseDataLines(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
}

function checkChunkForIssues(chunk, requestedModel, issues, seenModels) {
  if (!chunk || typeof chunk !== "object") return;
  if ("provider" in chunk) issues.add(`provider field leaked: "${chunk.provider}"`);
  if ("system_fingerprint" in chunk && chunk.system_fingerprint) {
    issues.add(`system_fingerprint leaked: "${chunk.system_fingerprint}"`);
  }
  if (typeof chunk.model === "string" && chunk.model) seenModels.add(chunk.model);
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== "object") continue;
    const fr = choice.finish_reason;
    if (fr === null || fr === undefined) continue;
    if (typeof fr !== "string" || !VALID_FINISH_REASONS.has(fr)) {
      issues.add(`invalid finish_reason: ${JSON.stringify(fr)}`);
    }
  }
}

/**
 * Runs one non-streaming + one streaming chat completion against the real
 * public API for `modelId` and checks the response contract described above.
 * Returns { modelId, ok, issues: string[], elapsedMs, requestedModel }.
 */
async function checkModelContract(apiUrl, apiKey, modelId, options = {}) {
  const base = String(apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  const url = `${base}/v1/chat/completions`;
  const timeoutMs = options.timeoutMs || 30_000;
  const startedAt = Date.now();
  const issues = new Set();
  const seenModels = new Set();

  const prompt = { role: "user", content: "Reply with exactly the word: PIRAMYD_CONTRACT_CHECK_OK" };

  try {
    const nonStream = await httpPostRaw(
      url,
      apiKey,
      { model: modelId, messages: [prompt], max_tokens: 20, stream: false },
      timeoutMs
    );
    if (nonStream.statusCode >= 200 && nonStream.statusCode < 300) {
      let parsed = null;
      try {
        parsed = JSON.parse(nonStream.body);
      } catch {
        issues.add("non-stream response body is not valid JSON");
      }
      if (parsed) checkChunkForIssues(parsed, modelId, issues, seenModels);
    } else if (nonStream.statusCode !== 429 && nonStream.statusCode !== 503) {
      issues.add(`non-stream HTTP ${nonStream.statusCode}`);
    }
  } catch (err) {
    issues.add(`non-stream request failed: ${err.message}`);
  }

  try {
    const streamed = await httpPostRaw(
      url,
      apiKey,
      { model: modelId, messages: [prompt], max_tokens: 20, stream: true },
      timeoutMs
    );
    if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
      for (const dataLine of extractSseDataLines(streamed.body)) {
        try {
          checkChunkForIssues(JSON.parse(dataLine), modelId, issues, seenModels);
        } catch {
          // non-JSON SSE line (e.g. a raw ": heartbeat" comment) — ignore.
        }
      }
    } else if (streamed.statusCode !== 429 && streamed.statusCode !== 503) {
      issues.add(`stream HTTP ${streamed.statusCode}`);
    }
  } catch (err) {
    issues.add(`stream request failed: ${err.message}`);
  }

  for (const seen of seenModels) {
    if (seen !== modelId) {
      issues.add(`model leak: requested "${modelId}", response reported "${seen}"`);
    }
  }

  return {
    modelId,
    ok: issues.size === 0,
    issues: Array.from(issues),
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Live-checks several models with bounded concurrency and returns results
 * in the same order as `modelIds`.
 */
async function checkModelsContract(apiUrl, apiKey, modelIds, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 3);
  const ids = Array.isArray(modelIds) ? modelIds : [];
  const results = new Array(ids.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= ids.length) return;
      results[i] = await checkModelContract(apiUrl, apiKey, ids[i], options);
      options.onProgress?.(results[i], i + 1, ids.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}

module.exports = {
  DEFAULT_API_URL,
  httpRequest,
  fetchLatestProbeRun,
  summarizeSession,
  relativeAge,
  VALID_FINISH_REASONS,
  checkModelContract,
  checkModelsContract,
  extractSseDataLines,
  checkChunkForIssues,
};
