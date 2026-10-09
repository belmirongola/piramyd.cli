/** Pure helpers for `piramyd models` (kept free of UI deps so they are unit-testable). */

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

/** Up/down counts and latency percentiles of the models that answered. */
function summarizeProbeResults(results) {
  const up = results.filter((result) => result.ok);
  const latencies = up.map((result) => result.latencyMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  return {
    total: results.length,
    up: up.length,
    down: results.length - up.length,
    p50_ms: percentile(latencies, 0.5),
    p95_ms: percentile(latencies, 0.95),
    slowest_ms: latencies.length ? latencies[latencies.length - 1] : null,
  };
}

/** Durations are shown in seconds everywhere in the UI (JSON output keeps raw milliseconds). */
function formatSeconds(valueMs) {
  if (!Number.isFinite(valueMs)) return "-";
  if (valueMs > 0 && valueMs < 100) return "<0.1s";
  return `${(valueMs / 1000).toFixed(1)}s`;
}

function filterModels(models, filter) {
  const needle = String(filter || "").trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => String(model.id || "").toLowerCase().includes(needle));
}

module.exports = { summarizeProbeResults, filterModels, formatSeconds, percentile };
