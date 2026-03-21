const FALLBACK_DEFAULT_MODEL = "claude-sonnet-4.5";

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
        id: FALLBACK_DEFAULT_MODEL,
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
        contextWindow: 200000,
        maxTokens: 8192,
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
