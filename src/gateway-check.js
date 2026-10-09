/**
 * End-to-end checks against the gateway with the user's key — the same path a
 * coding CLI uses. Each check resolves to { name, ok, ms, detail }.
 */
const https = require("https");
const { PIRAMYD_ROOT_URL } = require("./constants");

const CHECK_TIMEOUT_MS = 90_000;

function post(path, apiKey, body, { stream = false } = {}) {
  const url = new URL(`${PIRAMYD_ROOT_URL}${path}`);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "piramyd-toolkit",
          ...(stream ? { Accept: "text/event-stream" } : {}),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode, text }));
      }
    );
    req.on("error", reject);
    req.setTimeout(CHECK_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.end(payload);
  });
}

function messageText(message) {
  const content = message && message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("");
  return "";
}

/** Text of a non-streaming chat completion. */
function completionText(json) {
  const choice = json && Array.isArray(json.choices) ? json.choices[0] : null;
  return choice ? messageText(choice.message) : "";
}

/** Joined text of an SSE body plus whether the [DONE] sentinel was seen. */
function parseSse(raw) {
  let text = "";
  let done = false;
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") { done = true; continue; }
    try {
      const choice = (JSON.parse(data).choices || [])[0];
      if (choice && choice.delta && typeof choice.delta.content === "string") text += choice.delta.content;
    } catch { /* keep-alive or partial line */ }
  }
  return { text, done };
}

async function timed(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: result.ok, ms: Date.now() - started, detail: result.detail };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - started, detail: String((err && err.message) || err) };
  }
}

const PROMPT = [{ role: "user", content: "Reply with the single word OK." }];

function checkChat(apiKey, model, label = `chat (${model})`) {
  return timed(label, async () => {
    const res = await post("/v1/chat/completions", apiKey, { model, messages: PROMPT, max_tokens: 300 });
    if (res.status !== 200) return { ok: false, detail: `HTTP ${res.status}` };
    let json;
    try { json = JSON.parse(res.text); } catch { return { ok: false, detail: "invalid JSON" }; }
    const text = completionText(json).trim();
    return text ? { ok: true, detail: `answered "${text.slice(0, 24)}"` } : { ok: false, detail: "empty answer" };
  });
}

function checkStream(apiKey, model) {
  return timed(`stream (${model})`, async () => {
    const res = await post("/v1/chat/completions", apiKey, { model, messages: PROMPT, max_tokens: 300, stream: true }, { stream: true });
    if (res.status !== 200) return { ok: false, detail: `HTTP ${res.status}` };
    const { text, done } = parseSse(res.text);
    if (!done) return { ok: false, detail: "stream ended without [DONE]" };
    return text.trim() ? { ok: true, detail: `answered "${text.trim().slice(0, 24)}"` } : { ok: false, detail: "empty answer" };
  });
}

module.exports = { checkChat, checkStream, completionText, parseSse };
