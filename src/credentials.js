/**
 * Saved credentials for the toolkit.
 *
 * The key is asked for once and kept in ~/.piramyd/credentials.json (mode 600).
 * After that every command reuses it; it only changes when the user says so
 * (`piramyd login`, `--api-key`, `--change-key`) or runs `piramyd logout`.
 *
 * Resolution order: --api-key flag > PIRAMYD_API_KEY > saved > key already
 * written in a configured CLI. Only the flag is persisted automatically — an
 * env var is the caller's own business and must not leak into the store.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const SLOT_USER = "api_key";
const SLOT_ADMIN = "admin_api_key";

function isPiramydKey(value) {
  return /^(sk-|pyd-key-)\S+$/.test(String(value || "").trim());
}

function credentialsDir() {
  return process.env.PIRAMYD_CONFIG_DIR || path.join(os.homedir(), ".piramyd");
}

function credentialsPath() {
  return path.join(credentialsDir(), "credentials.json");
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  const dir = credentialsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = credentialsPath();
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o600); } catch { /* best effort on Windows */ }
}

function getSavedKey(slot = SLOT_USER) {
  const value = String(readStore()[slot] || "").trim();
  return isPiramydKey(value) ? value : "";
}

function saveKey(key, slot = SLOT_USER) {
  const value = String(key || "").trim();
  if (!isPiramydKey(value)) throw new Error("Not a valid Piramyd API key (expected sk-... or pyd-key-...).");
  const store = readStore();
  if (store[slot] === value) return false;
  store[slot] = value;
  store[`${slot}_saved_at`] = new Date().toISOString();
  writeStore(store);
  return true;
}

function clearKeys({ slots = [SLOT_USER, SLOT_ADMIN] } = {}) {
  const store = readStore();
  let removed = 0;
  for (const slot of slots) {
    if (store[slot]) removed += 1;
    delete store[slot];
    delete store[`${slot}_saved_at`];
  }
  if (Object.keys(store).length) writeStore(store);
  else { try { fs.unlinkSync(credentialsPath()); } catch { /* already gone */ } }
  return removed;
}

/**
 * Pick the key to use without prompting.
 * @returns {{ key: string, source: "flag"|"env"|"saved"|"config"|"none" }}
 */
function resolveStoredApiKey({ flagKey = "", envKey = "", slot = SLOT_USER, configKey = "" } = {}) {
  const flag = String(flagKey || "").trim();
  if (isPiramydKey(flag)) return { key: flag, source: "flag" };
  const env = String(envKey || "").trim();
  if (isPiramydKey(env)) return { key: env, source: "env" };
  const saved = getSavedKey(slot);
  if (saved) return { key: saved, source: "saved" };
  const config = String(configKey || "").trim();
  if (slot === SLOT_USER && isPiramydKey(config)) return { key: config, source: "config" };
  return { key: "", source: "none" };
}

module.exports = {
  SLOT_USER,
  SLOT_ADMIN,
  isPiramydKey,
  credentialsPath,
  getSavedKey,
  saveKey,
  clearKeys,
  resolveStoredApiKey,
};
