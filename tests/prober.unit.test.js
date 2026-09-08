const { summarizeSession, relativeAge } = require("../src/prober");

describe("summarizeSession", () => {
  test("flattens a stored ModelProbeSession row", () => {
    const row = summarizeSession({
      id: 42,
      probe_session_id: "5b1c-uuid",
      model_id: 259,
      provider: "kg",
      provider_model_id: "kagiro/glm-5-1",
      status: "completed",
      triggered_by: "scheduled",
      probes_total: 12,
      probes_ok: 10,
      probes_error: 2,
      probes_timeout: 0,
      elapsed_ms: 14055,
      normalization_confidence: 0.88,
      quirks: { supports_vision: false, supports_tools: true, supports_streaming: false },
      probed_at: "2026-09-08T04:00:00.000Z",
      error: null,
    });

    expect(row).toMatchObject({
      provider: "kg",
      model: "kagiro/glm-5-1",
      registryId: 259,
      sessionId: "5b1c-uuid",
      status: "completed",
      triggeredBy: "scheduled",
      probesTotal: 12,
      probesOk: 10,
      probesError: 2,
      confidence: 0.88,
      elapsedMs: 14055,
      supportsVision: false,
      supportsTools: true,
      supportsStreaming: false,
      probedAt: "2026-09-08T04:00:00.000Z",
      error: null,
    });
  });

  test("missing quirks and counts degrade gracefully", () => {
    const row = summarizeSession({
      provider: "openai",
      provider_model_id: "gpt-4o",
      status: "error",
      error: "upstream 500",
      probe_results: [{ status: "ok", scored_ok: true }, { status: "error" }],
    });
    expect(row.supportsVision).toBeNull();
    expect(row.supportsTools).toBeNull();
    expect(row.probesTotal).toBe(2);
    expect(row.probesOk).toBe(1);
    expect(row.confidence).toBeNull();
    expect(row.status).toBe("error");
  });

  test("falls back to created_at when probed_at is absent", () => {
    const row = summarizeSession({ provider_model_id: "x", created_at: "2026-09-01T00:00:00Z" });
    expect(row.probedAt).toBe("2026-09-01T00:00:00Z");
  });
});

describe("relativeAge", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");

  test("seconds", () => {
    expect(relativeAge("2026-09-08T11:59:30.000Z", now)).toBe("30s");
  });

  test("minutes", () => {
    expect(relativeAge("2026-09-08T11:20:00.000Z", now)).toBe("40m");
  });

  test("hours", () => {
    expect(relativeAge("2026-09-08T04:00:00.000Z", now)).toBe("8h");
  });

  test("days", () => {
    expect(relativeAge("2026-09-04T12:00:00.000Z", now)).toBe("4d");
  });

  test("empty / invalid input", () => {
    expect(relativeAge(null, now)).toBe("");
    expect(relativeAge("not-a-date", now)).toBe("");
  });
});
