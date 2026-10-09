const p = require("@clack/prompts");
const pc = require("picocolors");
const { accent, ok, muted, em } = require("../ui");
const { maskApiKey } = require("../utils");
const { loadCatalog } = require("../catalog");
const { SLOT_USER, SLOT_ADMIN, isPiramydKey, credentialsPath, saveKey, clearKeys, getSavedKey, resolveStoredApiKey } = require("../credentials");
const { promptNewApiKey, KEY_SOURCE_LABEL } = require("../key-flow");

// ── login / logout / whoami ─────────────────────────────────────
async function runLogin(cli) {
  const interactive = !cli.json;
  if (interactive) p.intro(pc.bgYellow(pc.black(" Piramyd Login ")));

  const slot = cli.admin ? SLOT_ADMIN : SLOT_USER;
  let key = isPiramydKey(cli.apiKeyFlag) ? cli.apiKeyFlag : "";
  if (!key) {
    if (!interactive) throw new Error("login --json needs --api-key");
    key = await promptNewApiKey({ admin: slot === SLOT_ADMIN });
  }

  if (slot === SLOT_USER) {
    const spinner = interactive ? p.spinner() : null;
    if (spinner) spinner.start("Checking the key...");
    try {
      const catalog = await loadCatalog(key);
      if (spinner) spinner.stop(`Key accepted ${muted(`(tier ${String(catalog.tier || "unknown").toUpperCase()}, ${catalog.models.length} models)`)}`);
    } catch (err) {
      if (spinner) spinner.stop(pc.red("Key rejected."));
      throw new Error(`Piramyd rejected that key: ${err.message || err}`);
    }
  }

  saveKey(key, slot);
  if (cli.json) {
    console.log(JSON.stringify({ saved: true, slot, key: maskApiKey(key), path: credentialsPath() }));
    return;
  }
  p.outro(ok(`Saved ${maskApiKey(key)} to ${credentialsPath()}. Commands will reuse it from now on.`));
}

function runLogout(cli) {
  const removed = clearKeys();
  if (cli.json) {
    console.log(JSON.stringify({ removed }));
    return;
  }
  console.log(removed
    ? `${ok("\u2713")} Removed ${removed} saved key${removed === 1 ? "" : "s"}. CLI configs written by the wizard were left as they are.`
    : `${muted("No saved key to remove.")}`);
}

function runWhoami(cli) {
  const found = resolveStoredApiKey({
    flagKey: cli.apiKeyFlag,
    envKey: process.env.PIRAMYD_API_KEY,
    slot: SLOT_USER,
  });
  const admin = getSavedKey(SLOT_ADMIN);
  if (cli.json) {
    console.log(JSON.stringify({
      key: found.key ? maskApiKey(found.key) : null,
      source: found.source,
      admin_key_saved: Boolean(admin),
      path: credentialsPath(),
    }));
    return;
  }
  if (!found.key) {
    console.log(`  ${muted("No key saved.")} Run ${em("piramyd login")} once and every command will reuse it.`);
    return;
  }
  console.log(`  ${em("Key:")}    ${accent(maskApiKey(found.key))}  ${muted(`(${KEY_SOURCE_LABEL[found.source]})`)}`);
  console.log(`  ${em("Admin:")}  ${admin ? accent(maskApiKey(admin)) : muted("none saved")}`);
  console.log(`  ${em("Store:")}  ${muted(credentialsPath())}`);
}

module.exports = { runLogin, runLogout, runWhoami };
