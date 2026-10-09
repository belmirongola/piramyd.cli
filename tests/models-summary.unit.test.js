const { summarizeProbeResults, filterModels, formatMs } = require("../src/model-summary");
const { parseCliArgs } = require("../src/cli-args");

describe("models summary", () => {
  test("counts up/down and takes latency percentiles from the models that answered", () => {
    const results = [
      { modelId: "a", ok: true, latencyMs: 1000 },
      { modelId: "b", ok: true, latencyMs: 3000 },
      { modelId: "c", ok: true, latencyMs: 2000 },
      { modelId: "d", ok: true, latencyMs: 40000 },
      { modelId: "e", ok: false, latencyMs: 90000 },
    ];
    expect(summarizeProbeResults(results)).toEqual({
      total: 5, up: 4, down: 1, p50_ms: 2000, p95_ms: 40000, slowest_ms: 40000,
    });
  });

  test("an empty or all-down run has no latency", () => {
    expect(summarizeProbeResults([]).p50_ms).toBeNull();
    expect(summarizeProbeResults([{ modelId: "a", ok: false }]).slowest_ms).toBeNull();
  });

  test("filters by substring, case-insensitive", () => {
    const models = [{ id: "GLM-5.3" }, { id: "deepseek-v4" }, { id: "glm-5.3-flash" }];
    expect(filterModels(models, "glm").map((m) => m.id)).toEqual(["GLM-5.3", "glm-5.3-flash"]);
    expect(filterModels(models, "")).toHaveLength(3);
  });

  test("formats milliseconds and seconds", () => {
    expect(formatMs(850)).toBe("850ms");
    expect(formatMs(12345)).toBe("12.3s");
    expect(formatMs(null)).toBe("-");
  });

  test("parses --filter and clamps --concurrency", () => {
    const cli = parseCliArgs(["models", "--filter", "GLM", "--concurrency", "99"]);
    expect(cli.filter).toBe("glm");
    expect(cli.concurrency).toBe(16);
    expect(parseCliArgs(["models"]).concurrency).toBe(4);
  });
});
