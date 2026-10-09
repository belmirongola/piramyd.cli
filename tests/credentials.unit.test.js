const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  isPiramydKey,
  getSavedKey,
  saveKey,
  clearKeys,
  resolveStoredApiKey,
  credentialsPath,
  SLOT_USER,
  SLOT_ADMIN,
} = require("../src/credentials");
const { parseCliArgs } = require("../src/cli-args");

describe("credentials store", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "piramyd-creds-"));
    process.env.PIRAMYD_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.PIRAMYD_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("accepts sk- and pyd-key- keys, rejects anything else", () => {
    expect(isPiramydKey("sk-abc123")).toBe(true);
    expect(isPiramydKey("pyd-key-abc123")).toBe(true);
    expect(isPiramydKey("pyd-key-")).toBe(false);
    expect(isPiramydKey("abc")).toBe(false);
    expect(isPiramydKey("")).toBe(false);
  });

  test("saves once and reads back, file is private", () => {
    expect(saveKey("pyd-key-one")).toBe(true);
    expect(getSavedKey()).toBe("pyd-key-one");
    if (process.platform !== "win32") {
      expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    }
    expect(saveKey("pyd-key-one")).toBe(false);
  });

  test("refuses to save a malformed key", () => {
    expect(() => saveKey("nope")).toThrow(/valid Piramyd API key/);
    expect(getSavedKey()).toBe("");
  });

  test("a saved key is reused with no flag or env", () => {
    saveKey("sk-saved");
    expect(resolveStoredApiKey({})).toEqual({ key: "sk-saved", source: "saved" });
  });

  test("explicit flag beats env beats saved beats CLI config", () => {
    saveKey("sk-saved");
    const base = { configKey: "sk-config" };
    expect(resolveStoredApiKey({ ...base, flagKey: "sk-flag", envKey: "sk-env" }).source).toBe("flag");
    expect(resolveStoredApiKey({ ...base, envKey: "sk-env" }).source).toBe("env");
    expect(resolveStoredApiKey(base).source).toBe("saved");
    clearKeys();
    expect(resolveStoredApiKey(base)).toEqual({ key: "sk-config", source: "config" });
    expect(resolveStoredApiKey({})).toEqual({ key: "", source: "none" });
  });

  test("admin slot never falls back to a normal key from a CLI config", () => {
    expect(resolveStoredApiKey({ slot: SLOT_ADMIN, configKey: "sk-config" }).source).toBe("none");
    saveKey("sk-admin", SLOT_ADMIN);
    expect(resolveStoredApiKey({ slot: SLOT_ADMIN }).key).toBe("sk-admin");
    expect(getSavedKey(SLOT_USER)).toBe("");
  });

  test("logout removes keys and the file", () => {
    saveKey("sk-a");
    saveKey("sk-b", SLOT_ADMIN);
    expect(clearKeys()).toBe(2);
    expect(fs.existsSync(credentialsPath())).toBe(false);
    expect(clearKeys()).toBe(0);
  });

  test("a corrupt store is treated as empty", () => {
    fs.writeFileSync(credentialsPath(), "{not json");
    expect(getSavedKey()).toBe("");
    expect(saveKey("sk-fresh")).toBe(true);
  });
});

describe("cli args for credentials", () => {
  test("separates the --api-key flag from the env var", () => {
    process.env.PIRAMYD_API_KEY = "sk-env";
    try {
      const flagged = parseCliArgs(["--api-key", "sk-flag"]);
      expect(flagged.apiKey).toBe("sk-flag");
      expect(flagged.apiKeyFlag).toBe("sk-flag");
      const envOnly = parseCliArgs([]);
      expect(envOnly.apiKey).toBe("sk-env");
      expect(envOnly.apiKeyFlag).toBe("");
    } finally {
      delete process.env.PIRAMYD_API_KEY;
    }
  });

  test("parses login, logout, whoami, --change-key and --admin", () => {
    expect(parseCliArgs(["login"]).command).toBe("login");
    expect(parseCliArgs(["logout"]).command).toBe("logout");
    expect(parseCliArgs(["whoami"]).command).toBe("whoami");
    const cli = parseCliArgs(["login", "--admin", "--change-key"]);
    expect(cli.admin).toBe(true);
    expect(cli.changeKey).toBe(true);
  });
});
