const FALLBACK_DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Hardcoded emergency catalog used when remote fetch fails.
 */
function buildEmergencyCatalog() {
  return {
    source: "built-in-emergency-fallback",
    sourceType: "local-fallback",
    tier: "unknown",
    warning: "Catalog fetch failed. Continuing with local fallback model list.",
    models: [
      {
        id: "claude-opus-4.6",
        name: "Claude Opus 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 128000,
      },
      {
        id: FALLBACK_DEFAULT_MODEL,
        name: "Claude Sonnet 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 128000,
      },
      {
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 64000,
      },
      {
        id: "claude-opus-4-1",
        name: "Claude Opus 4.1",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 32000,
      },
    ],
    defaultModelId: FALLBACK_DEFAULT_MODEL,
  };
}

/**
 * Deduplicate model list by id.
 */
function uniqueModels(models) {
  const seen = new Set();
  const list = [];
  for (const entry of models || []) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push({ ...entry, id, name: String(entry.name || id) });
  }
  return list;
}

/**
 * Merge user selection into catalog (extra manual models + chosen default).
 */
function applyCatalogSelection(catalog, selectedDefaultModelId, extraModels = []) {
  const merged = uniqueModels([...(catalog.models || []), ...extraModels]);
  return {
    ...catalog,
    models: merged,
    defaultModelId: String(selectedDefaultModelId || "").trim(),
  };
}

/**
 * Find a model by ID (case-insensitive).
 */
function findModelById(models, modelId) {
  const wanted = String(modelId || "").trim().toLowerCase();
  if (!wanted) return null;
  return (models || []).find((model) => String(model.id || "").trim().toLowerCase() === wanted) || null;
}

module.exports = {
  FALLBACK_DEFAULT_MODEL,
  buildEmergencyCatalog,
  uniqueModels,
  applyCatalogSelection,
  findModelById,
};
