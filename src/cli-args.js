const COMMANDS = new Set(["doctor", "models", "status", "restore", "prober", "chat", "login", "logout", "whoami"]);

function parseCliArgs(argv) {
  const raw = Array.isArray(argv) ? argv.slice() : [];
  const flags = new Set();
  const opts = {};
  const positionals = [];

  for (let i = 0; i < raw.length; i += 1) {
    const token = String(raw[i] || "");
    if (
      token === "--dry-run" ||
      token === "--yes" ||
      token === "--json" ||
      token === "--help" ||
      token === "--live" ||
      token === "--all" ||
      token === "--change-key" ||
      token === "--admin"
    ) {
      flags.add(token);
      continue;
    }
    if (token === "-y") {
      flags.add("--yes");
      continue;
    }
    if (token === "-h") {
      flags.add("--help");
      continue;
    }
    if (token.startsWith("--") && token.includes("=")) {
      const eq = token.indexOf("=");
      opts[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    if (token.startsWith("--") && i + 1 < raw.length && !String(raw[i + 1]).startsWith("-")) {
      opts[token.slice(2)] = String(raw[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      flags.add(token);
      continue;
    }
    positionals.push(token);
  }

  const command = COMMANDS.has(positionals[0]) ? positionals[0] : "onboard";
  const targetRaw = String(opts.target || opts.targets || "").trim();
  const targets = targetRaw
    ? targetRaw.split(/[,\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    command,
    dryRun: flags.has("--dry-run"),
    yes: flags.has("--yes"),
    json: flags.has("--json"),
    help: flags.has("--help"),
    live: flags.has("--live"),
    all: flags.has("--all"),
    changeKey: flags.has("--change-key"),
    admin: flags.has("--admin"),
    targets,
    apiKey: String(opts["api-key"] || process.env.PIRAMYD_API_KEY || "").trim(),
    apiKeyFlag: String(opts["api-key"] || "").trim(),
    model: String(opts.model || "").trim(),
    apiBase: String(opts["api-base"] || process.env.PIRAMYD_BASE_URL || "").trim(),
    from: String(opts.from || "").trim().toLowerCase(),
    to: String(opts.to || "").trim().toLowerCase(),
  };
}

module.exports = { parseCliArgs, COMMANDS };
