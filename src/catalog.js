const https = require("https");
const { PIRAMYD_OPENAI_BASE_URL } = require("./constants");
const { coercePositiveNumber } = require("./utils");

function flattenErrorMessages(error) {
  if (!error) return [];
  const messages = [];
  if (error.message) messages.push(String(error.message));
  if (Array.isArray(error.errors)) {
    for (const inner of error.errors) {
      if (inner?.message) messages.push(String(inner.message));
    }
  }
  return [...new Set(messages.filter(Boolean))];
}

function isAggregateNetworkError(error) {
  if (!error) return false;
  if (error.name === "AggregateError") return true;
  const msg = flattenErrorMessages(error).join(" ").toLowerCase();
  return msg.includes("aggregateerror") || msg.includes("aggregate error");
}

function fetchJson(url, apiKey, timeoutMs = 30_000, options = {}) {
  const { family } = options;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        ...(family ? { family } : {}),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "piramyd-cli/4.0",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) {
            const snippet = String(body || "").slice(0, 220).replace(/\s+/g, " ").trim();
            const err = new Error(`HTTP ${status}${snippet ? ` - ${snippet}` : ""}`);
            err.statusCode = status;
            reject(err);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`invalid JSON from ${url}: ${err.message}`));
          }
        });
      }
    );

    req.on("error", (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

function shouldRetry(error) {
  const msg = String(error?.message || "").toLowerCase();
  const status = Number(error?.statusCode || 0);
  if (status >= 500 || status === 429) return true;
  return msg.includes("timeout")
    || msg.includes("eai_again")
    || msg.includes("econntreset")
    || msg.includes("socket hang up")
    || msg.includes("etimedout");
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, apiKey, attempts = 3) {
  let lastError;
  let forceIpv4 = false;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetchJson(url, apiKey, 30_000, forceIpv4 ? { family: 4 } : undefined);
    } catch (error) {
      lastError = error;

      if (!forceIpv4 && isAggregateNetworkError(error)) {
        forceIpv4 = true;
      }

      if (i === attempts || !shouldRetry(error)) break;
      await sleep(250 * i);
    }
  }

  const details = flattenErrorMessages(lastError).join(" | ");
  if (details) {
    const composed = new Error(details);
    if (lastError?.statusCode) composed.statusCode = lastError.statusCode;
    throw composed;
  }

  throw lastError;
}

async function fetchModels(apiKey) {
  const metadataUrl = `${PIRAMYD_OPENAI_BASE_URL}/cli/metadata`;
  const modelsUrl = `${PIRAMYD_OPENAI_BASE_URL}/models`;

  try {
    const metadata = await fetchWithRetry(metadataUrl, apiKey, 3);
    return { payload: metadata, source: metadataUrl, sourceType: "remote" };
  } catch (metadataError) {
    try {
      const fallback = await fetchWithRetry(modelsUrl, apiKey, 2);
      const models = Array.isArray(fallback?.data) ? fallback.data : Array.isArray(fallback?.models) ? fallback.models : [];
      return {
        payload: { models, tier: "unknown" },
        source: modelsUrl,
        sourceType: "fallback-models",
        warning: `Metadata endpoint unavailable (${metadataError.message}). Used /v1/models fallback.`,
      };
    } catch (fallbackError) {
      const metaMsg = flattenErrorMessages(metadataError).join(" | ") || String(metadataError?.message || metadataError);
      const fallbackMsg = flattenErrorMessages(fallbackError).join(" | ") || String(fallbackError?.message || fallbackError);
      throw new Error(
        `Failed to load catalog. metadata_error=${metaMsg}; fallback_error=${fallbackMsg}`
      );
    }
  }
}
function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const id = String(entry.id || "").trim();
  if (!id) return null;

  const input = Array.isArray(entry.input)
    ? entry.input.map((item) => String(item).toLowerCase())
    : [];
  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.map((item) => String(item).toLowerCase())
    : [];

  // Strictly ignore models designed for image/audio generation or purely non-text modalities.
  const type = String(entry.type || entry.object || "").toLowerCase();
  if (type.includes("image") || type.includes("audio")) return null;

  // Check endpoints if available
  const endpoint = String(entry.endpoint || "").toLowerCase();
  const endpoints = Array.isArray(entry.endpoints) ? entry.endpoints.map(e => String(e).toLowerCase()) : [];
  if (endpoint.includes("/images/") || endpoints.some(e => e.includes("/images/"))) return null;

  if (capabilities.includes("image-generation") || capabilities.includes("image_generation") || capabilities.includes("text-to-image")) return null;

  // We want to ensure it has conversational or text completion capabilities.
  const hasText = input.includes("text") || input.length === 0 || capabilities.includes("chat") || capabilities.includes("text-generation");
  if (!hasText && type !== "model") return null;

  const hasVision = input.includes("image") || capabilities.includes("vision") || capabilities.includes("image-analysis");
  const hasVideo = input.includes("video") || capabilities.some((cap) => cap.includes("video"));
  const reasoning =
    Boolean(entry.reasoning) ||
    Boolean(entry.supports_reasoning) ||
    capabilities.includes("reasoning") ||
    /thinking|reason/i.test(id);

  return {
    id,
    name: String(entry.name || id),
    reasoning,
    input: hasVideo ? ["text", "image", "video"] : hasVision ? ["text", "image"] : ["text"],
    contextWindow: coercePositiveNumber(entry.contextWindow ?? entry.context_window ?? entry.context_length, 256000),
    maxTokens: coercePositiveNumber(entry.maxTokens ?? entry.max_output_tokens, 32768),
  };
}
function sanitizeCatalog(catalog) {
  const seen = new Set();
  const models = [];
  for (const entry of catalog || []) {
    const model = normalizeCatalogEntry(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}
async function loadCatalog(apiKey) {
  const fetched = await fetchModels(apiKey);
  const metadata = fetched.payload || {};
  const rawModels = Array.isArray(metadata.models) ? metadata.models : metadata.data || [];
  const remote = sanitizeCatalog(rawModels);
  if (!remote.length) throw new Error("empty catalog or no valid text/coding models found");
  return { 
    source: fetched.source,
    sourceType: fetched.sourceType,
    warning: fetched.warning,
    tier: metadata.tier || "free",
    models: remote 
  };
}

module.exports = { fetchModels, normalizeCatalogEntry, sanitizeCatalog, loadCatalog };
