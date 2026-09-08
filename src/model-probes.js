/**
 * Realtime model probes for `piramyd models`.
 *
 * Strategy:
 * 1) Live probe each model with the user's Piramyd API key via POST /v1/responses
 *    (true end-to-end path the customer uses).
 * 2) If live probe cannot run (no key / network), fall back to public
 *    GET /v1/status/models (background platform health cache).
 */
const https = require("https");
const { PIRAMYD_OPENAI_BASE_URL, PIRAMYD_ROOT_URL } = require("./constants");

const DEFAULT_PROBE_TIMEOUT_MS = 90_000;
const STATUS_MODELS_URL = `${PIRAMYD_ROOT_URL}/v1/status/models`;
const STATUS_FETCH_TIMEOUT_MS = 10_000;

const PROBE_PROMPT = [
  "Return exactly this token and nothing else: OK",
  "Do not explain.",
  "Do not think aloud.",
  "Do not add punctuation.",
].join(" ");

function buildProbePayload(modelId) {
  return JSON.stringify({
    model: modelId,
    input: PROBE_PROMPT,
    max_output_tokens: 150,
  });
}

function extractProbeText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && content.text) return String(content.text).trim();
    }
  }

  if (
    payload?.object === "response" &&
    String(payload?.status || "").toLowerCase() === "incomplete" &&
    String(payload?.incomplete_details?.reason || "") === "max_output_tokens" &&
    output.length === 0
  ) {
    return "__reasoning_only__";
  }

  if (
    payload?.object === "response" &&
    String(payload?.status || "").toLowerCase() === "completed" &&
    output.length === 0
  ) {
    return "__empty_completed__";
  }

  if (typeof payload?.output_text === "string") return payload.output_text.trim();

  if (Array.isArray(payload?.content)) {
    for (const content of payload.content) {
      if (content?.type === "text" && content.text) return String(content.text).trim();
    }
  }

  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    const msg = choice?.message;
    const content = msg?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (msg?.reasoning_content || msg?.thinking_content) return "__reasoning_only__";
    if (choice?.finish_reason === "length" && (!content || !String(content).trim())) {
      return "__empty_completed__";
    }
  }

  return "";
}

function _shortDetail(text, max = 48) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "failed";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function normalizeProbeMessage(message, statusCode = 0) {
  const raw = String(message || "").trim();
  const status = Number(statusCode || 0);

  if (raw === "__reasoning_only__" || raw === "__empty_completed__") {
    return { reason: "ok", detail: "OK" };
  }
  if (!raw) {
    if (status >= 200 && status < 300) return { reason: "ok", detail: "OK" };
    return { reason: "empty_response", detail: "empty response" };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // not JSON
  }

  const error = parsed && typeof parsed === "object" ? parsed.error : null;
  const detailField = parsed && typeof parsed === "object" ? parsed.detail : null;
  const code = String((error && error.code) || "").toLowerCase();
  const type = String((error && error.type) || "").toLowerCase();
  const errorMessage = String(
    (error && error.message) || (typeof detailField === "string" ? detailField : "") || ""
  ).toLowerCase();
  const lower = raw.toLowerCase();

  if (/^ok[.!]?$/i.test(raw)) return { reason: "ok", detail: "OK" };

  if (lower.includes("timeout") || status === 504 || status === 524) {
    return { reason: "timeout", detail: "timeout" };
  }

  if (
    typeof detailField === "string" &&
    (detailField.toLowerCase().includes("api key inválida") ||
      detailField.toLowerCase().includes("api key invalida") ||
      (detailField.toLowerCase().includes("chave") &&
        detailField.toLowerCase().includes("inválid")))
  ) {
    return { reason: "client_auth", detail: "client api key rejected" };
  }

  if (
    status === 401 ||
    code === "invalid_api_key" ||
    code === "upstream_auth_error" ||
    type.includes("authentication") ||
    errorMessage.includes("verify your api key") ||
    errorMessage.includes("invalid api key") ||
    (errorMessage.includes("api key") && (status === 401 || status === 403))
  ) {
    if (code === "upstream_auth_error" || errorMessage.includes("upstream")) {
      return { reason: "upstream_auth", detail: "upstream auth error" };
    }
    if (error && error.message) {
      return { reason: "auth", detail: _shortDetail(error.message, 40) };
    }
    if (typeof detailField === "string" && detailField.trim()) {
      return { reason: "client_auth", detail: "client api key rejected" };
    }
    return { reason: "auth", detail: "auth error" };
  }

  if (
    code.includes("rate_limit") ||
    type.includes("rate_limit") ||
    errorMessage.includes("rate limit") ||
    status === 429
  ) {
    return { reason: "rate_limited", detail: "rate limited" };
  }

  if (
    type.includes("server_error") ||
    type.includes("service_unavailable") ||
    code === "service_maintenance" ||
    code === "service_unavailable" ||
    errorMessage.includes("temporarily unavailable") ||
    errorMessage.includes("service unavailable") ||
    errorMessage.includes("under maintenance") ||
    status === 503 ||
    status === 502
  ) {
    return { reason: "server_unavailable", detail: "server unavailable" };
  }

  if (
    type.includes("invalid_request") ||
    code.includes("invalid_request") ||
    errorMessage.includes("bad request") ||
    status === 400
  ) {
    return { reason: "invalid_request", detail: "invalid request" };
  }

  if (lower.includes("<think>")) {
    const afterThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (/^ok[.!]?$/i.test(afterThink)) return { reason: "ok", detail: "OK" };
    return { reason: "unexpected_output", detail: "unexpected output" };
  }
  if (lower.startsWith("the user says:")) {
    return { reason: "unexpected_output", detail: "unexpected output" };
  }

  if (error && error.message) {
    return { reason: "upstream_error", detail: _shortDetail(error.message, 40) };
  }
  if (typeof detailField === "string" && detailField.trim()) {
    return { reason: "upstream_error", detail: _shortDetail(detailField, 40) };
  }

  if (status >= 400) {
    return { reason: "http_error", detail: `HTTP ${status}` };
  }

  return { reason: "unexpected_output", detail: "unexpected output" };
}

function probeModel(apiKey, modelId, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
  const requestBody = buildProbePayload(modelId);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = https.request(
      `${PIRAMYD_OPENAI_BASE_URL}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
          "User-Agent": "piramyd-cli/4.0",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const latencyMs = Date.now() - startedAt;
          const statusCode = Number(res.statusCode || 0);

          if (statusCode < 200 || statusCode >= 300) {
            const snippet = String(body || "").slice(0, 400).replace(/\s+/g, " ").trim();
            const normalized = normalizeProbeMessage(snippet || `HTTP ${statusCode}`, statusCode);
            resolve({
              modelId,
              ok: false,
              statusCode,
              latencyMs,
              reason: normalized.reason,
              message: normalized.detail,
            });
            return;
          }

          try {
            const payload = JSON.parse(body);
            const text = extractProbeText(payload);
            const normalized = normalizeProbeMessage(text, statusCode);
            resolve({
              modelId,
              ok: normalized.reason === "ok",
              statusCode,
              latencyMs,
              reason: normalized.reason,
              message: normalized.detail,
            });
          } catch {
            resolve({
              modelId,
              ok: false,
              statusCode,
              latencyMs,
              reason: "unexpected_output",
              message: "unexpected output",
            });
          }
        });
      }
    );

    req.on("error", (error) => {
      const normalized = normalizeProbeMessage(String(error.message || error), 0);
      resolve({
        modelId,
        ok: false,
        statusCode: 0,
        latencyMs: Date.now() - startedAt,
        reason: normalized.reason,
        message: normalized.detail,
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });

    req.write(requestBody);
    req.end();
  });
}

function fetchModelHealthStatus(timeoutMs = STATUS_FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      STATUS_MODELS_URL,
      { headers: { "User-Agent": "piramyd-cli/4.0" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("invalid JSON from /v1/status/models"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

function healthStatusToProbeResult(modelId, h) {
  if (!h) {
    return {
      modelId,
      ok: false,
      statusCode: 0,
      latencyMs: null,
      reason: "unknown",
      message: "no health data",
    };
  }
  const status = String(h.status || "unknown").toLowerCase();
  const ok = status === "ok";
  const reason = ok
    ? "ok"
    : status === "degraded"
      ? "rate_limited"
      : status === "down"
        ? "server_unavailable"
        : "unknown";
  const message = ok
    ? "OK"
    : h.error_code
      ? String(h.error_code).replace(/_/g, " ")
      : status;
  return {
    modelId,
    ok,
    statusCode: ok ? 200 : 503,
    latencyMs: typeof h.latency_ms === "number" ? h.latency_ms : null,
    reason,
    message,
  };
}

async function probeModels(apiKey, models) {
  return probeModelsConcurrent(apiKey, models);
}

async function probeModelsConcurrent(apiKey, models, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 4);
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  const key = String(apiKey || "").trim();

  // Prefer live probes with the user's key (real product path).
  if (key.startsWith("sk-")) {
    const results = new Array(models.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < models.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const model = models[currentIndex];
        const result = await probeModel(key, model.id, options.timeoutMs);
        results[currentIndex] = result;
        if (onResult) onResult(result, model, currentIndex);
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, models.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  }

  // Fallback: platform cached health (no customer key).
  let healthMap = {};
  try {
    const data = await fetchModelHealthStatus();
    healthMap =
      typeof data.models === "object" && data.models !== null ? data.models : {};
  } catch {
    // leave empty
  }

  return models.map((model, index) => {
    const result = healthStatusToProbeResult(model.id, healthMap[model.id] ?? null);
    if (onResult) onResult(result, model, index);
    return result;
  });
}

module.exports = {
  PROBE_PROMPT,
  DEFAULT_PROBE_TIMEOUT_MS,
  buildProbePayload,
  extractProbeText,
  normalizeProbeMessage,
  probeModel,
  probeModels,
  probeModelsConcurrent,
  fetchModelHealthStatus,
  healthStatusToProbeResult,
};
