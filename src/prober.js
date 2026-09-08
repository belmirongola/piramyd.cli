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
    probedAt: session.probed_at || session.created_at || null,
    error: session.error || null,
  };
}

module.exports = {
  DEFAULT_API_URL,
  httpRequest,
  fetchLatestProbeRun,
  summarizeSession,
  relativeAge,
};
