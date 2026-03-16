const https = require("https");
const { PIRAMYD_OPENAI_BASE_URL } = require("./constants");
const { coercePositiveNumber } = require("./utils");

async function fetchModels(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `${PIRAMYD_OPENAI_BASE_URL}/cli/metadata`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "piramyd-cli/4.0",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`status ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("timeout"));
    });
  });
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
  const metadata = await fetchModels(apiKey);
  const rawModels = Array.isArray(metadata.models) ? metadata.models : metadata.data || [];
  const remote = sanitizeCatalog(rawModels);
  if (!remote.length) throw new Error("empty catalog or no valid text/coding models found");
  return { 
    source: `${PIRAMYD_OPENAI_BASE_URL}/cli/metadata`, 
    sourceType: "remote", 
    tier: metadata.tier || "free",
    models: remote 
  };
}

module.exports = { fetchModels, normalizeCatalogEntry, sanitizeCatalog, loadCatalog };
