const p = require("@clack/prompts");
const { accent, ok, muted } = require("./ui");
const { maskApiKey } = require("./utils");
const { SLOT_USER, SLOT_ADMIN, isPiramydKey, credentialsPath, saveKey, resolveStoredApiKey } = require("./credentials");

// ── API key prompt ──────────────────────────────────────────────
async function promptNewApiKey({ admin = false } = {}) {
  const value = await p.password({
    message: admin
      ? "Paste your Piramyd admin API key (sk-... or pyd-key-...)"
      : "Paste your Piramyd API key (sk-... or pyd-key-...)",
    mask: "*",
    validate(input) {
      return isPiramydKey(input) ? undefined : "Provide a valid Piramyd API key (sk-... or pyd-key-...).";
    },
  });
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return String(value || "").trim();
}

const KEY_SOURCE_LABEL = { flag: "the key you passed", env: "PIRAMYD_API_KEY", saved: "saved key", config: "key found in your CLI config" };

/**
 * One place decides which key to use, so no command asks for it twice.
 * A key is only requested when none is saved, or when the user asks to change it
 * (`piramyd login`, `--api-key`, `--change-key`).
 */

async function obtainApiKey(cli, { slot = SLOT_USER, configKey = "", interactive = true } = {}) {
  const found = resolveStoredApiKey({
    flagKey: cli.apiKeyFlag,
    envKey: process.env.PIRAMYD_API_KEY,
    slot,
    configKey,
  });

  if (found.key && !(cli.changeKey && found.source !== "flag")) {
    // An explicit --api-key replaces the saved one; a key adopted from a CLI
    // config is remembered so later commands don't depend on that CLI.
    if (found.source === "flag" || found.source === "config") {
      try { saveKey(found.key, slot); } catch { /* unreadable store: still usable this run */ }
    }
    if (interactive) {
      const hint = found.source === "saved" ? muted(" \u2014 change it with `piramyd login`") : "";
      p.log.info(`${ok("\u2713")} Using ${KEY_SOURCE_LABEL[found.source]} ${accent(maskApiKey(found.key))}${hint}`);
    }
    return found.key;
  }

  if (!interactive) return "";

  const key = await promptNewApiKey({ admin: slot === SLOT_ADMIN });
  try {
    saveKey(key, slot);
    p.log.info(`${ok("\u2713")} Key saved ${muted(`(${credentialsPath()})`)} \u2014 you won't be asked again.`);
  } catch (err) {
    p.log.warn(`Could not save the key (${err.message}); it will be asked again next time.`);
  }
  return key;
}

function authHint(err) {
  const message = String((err && err.message) || err || "");
  return /\b(401|403)\b|unauthor|invalid.*key|credential/i.test(message)
    ? `${message}\n  ${muted("The saved key was rejected \u2014 run `piramyd login` to replace it.")}`
    : message;
}

module.exports = { promptNewApiKey, KEY_SOURCE_LABEL, obtainApiKey, authHint };
