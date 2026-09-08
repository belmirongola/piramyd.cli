const { parseCliArgs } = require("../src/cli-args");

describe("parseCliArgs", () => {
  test("defaults to onboard", () => {
    expect(parseCliArgs([]).command).toBe("onboard");
  });

  test("parses commands and flags", () => {
    const parsed = parseCliArgs(["status", "--json", "--dry-run"]);
    expect(parsed.command).toBe("status");
    expect(parsed.json).toBe(true);
    expect(parsed.dryRun).toBe(true);
  });

  test("parses non-interactive onboard options", () => {
    const parsed = parseCliArgs([
      "--yes",
      "--target",
      "codex,claude",
      "--api-key",
      "sk-test",
      "--model=gpt-5.6-sol",
    ]);
    expect(parsed.yes).toBe(true);
    expect(parsed.targets).toEqual(["codex", "claude"]);
    expect(parsed.apiKey).toBe("sk-test");
    expect(parsed.model).toBe("gpt-5.6-sol");
  });

  test("restore is a command", () => {
    expect(parseCliArgs(["restore", "--target=codex"]).command).toBe("restore");
    expect(parseCliArgs(["restore", "--target=codex"]).targets).toEqual(["codex"]);
  });

  test("prober command with api key and model filter", () => {
    const parsed = parseCliArgs(["prober", "--api-key", "sk-admin", "--model", "gpt-4o-mini"]);
    expect(parsed.command).toBe("prober");
    expect(parsed.apiKey).toBe("sk-admin");
    expect(parsed.model).toBe("gpt-4o-mini");
  });

  test("prober api key falls back to PIRAMYD_API_KEY env", () => {
    const prev = process.env.PIRAMYD_API_KEY;
    process.env.PIRAMYD_API_KEY = "sk-env";
    try {
      expect(parseCliArgs(["prober"]).apiKey).toBe("sk-env");
    } finally {
      if (prev === undefined) delete process.env.PIRAMYD_API_KEY;
      else process.env.PIRAMYD_API_KEY = prev;
    }
  });
});
