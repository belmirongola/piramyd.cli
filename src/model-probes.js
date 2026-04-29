const https = require("https");
const { PIRAMYD_OPENAI_BASE_URL } = require("./constants");

const DEFAULT_PROBE_TIMEOUT_MS = 90_000;

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
  // OpenAI Responses API: output[].content[].text
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && content.text) return String(content.text).trim();
    }
  }

  // Responses API: reasoning model exhausted token budget — status=incomplete, output=[]
  // The model is reachable and processed the request; treat as alive.
  if (
    payload?.object === "response" &&
    String(payload?.status || "").toLowerCase() === "incomplete" &&
    String(payload?.incomplete_details?.reason || "") === "max_output_tokens" &&
    output.length === 0
  ) {
    return "__reasoning_only__";
  }

  if (typeof payload?.output_text === "string") return payload.output_text.trim();

  // Anthropic Messages API: content[].text
  if (Array.isArray(payload?.content)) {
    for (const content of payload.content) {
      if (content?.type === "text" && content.text) return String(content.text).trim();
    }
  }

  // OpenAI Chat Completions API: choices[].message.content
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    const msg = choice?.message;
    const content = msg?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    // Reasoning model via chat completions — content empty, reasoning_content populated
    if (msg?.reasoning_content || msg?.thinking_content) return "__reasoning_only__";
  }

  return "";
}

function normalizeProbeMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return { reason: "empty_response", detail: "empty response" };
  // Reasoning models exhaust token budget thinking — the model is reachable and working
  if (raw === "__reasoning_only__") return { reason: "ok", detail: "OK" };

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {}

  const error = parsed?.error;
  const code = String(error?.code || "").toLowerCase();
  const type = String(error?.type || "").toLowerCase();
  const errorMessage = String(error?.message || "").toLowerCase();
  const lower = raw.toLowerCase();

  // Case-insensitive OK match — models may capitalise differently or add punctuation
  if (/^ok[.!]?$/i.test(raw)) return { reason: "ok", detail: "OK" };
  if (lower.includes("timeout")) return { reason: "timeout", detail: "timeout" };
  if (code.includes("rate_limit") || type.includes("rate_limit") || errorMessage.includes("rate limit")) {
    return { reason: "rate_limited", detail: "rate limited" };
  }
  if (type.includes("server_error") || errorMessage.includes("temporarily unavailable") || errorMessage.includes("service unavailable")) {
    return { reason: "server_unavailable", detail: "server unavailable" };
  }
  if (type.includes("invalid_request") || code.includes("invalid_request") || errorMessage.includes("bad request")) {
    return { reason: "invalid_request", detail: "invalid request" };
  }
  // Reasoning models wrap their reply in <think>...</think> — strip it and check again
  if (lower.includes("<think>")) {
    const afterThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (/^ok[.!]?$/i.test(afterThink)) return { reason: "ok", detail: "OK" };
    return { reason: "unexpected_output", detail: "unexpected output" };
  }
  if (lower.startsWith("the user says:")) {
    return { reason: "unexpected_output", detail: "unexpected output" };
  }
  if (!raw) return { reason: "empty_response", detail: "empty response" };
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
            const snippet = String(body || "").slice(0, 220).replace(/\s+/g, " ").trim();
            const normalized = normalizeProbeMessage(snippet || `HTTP ${statusCode}`);
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
            const normalized = normalizeProbeMessage(text);
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
      const normalized = normalizeProbeMessage(String(error.message || error));
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

async function probeModels(apiKey, models) {
  const results = [];
  for (const model of models) {
    results.push(await probeModel(apiKey, model.id));
  }
  return results;
}

async function probeModelsConcurrent(apiKey, models, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 4);
  const onResult = typeof options.onResult === "function" ? options.onResult : null;
  const results = new Array(models.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < models.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const model = models[currentIndex];
      const result = await probeModel(apiKey, model.id, options.timeoutMs);
      results[currentIndex] = result;
      if (onResult) onResult(result, model, currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, models.length) }, () => worker());
  await Promise.all(workers);
  return results;
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
};
