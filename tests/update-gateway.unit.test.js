const { parseVersion, compareVersions } = require("../src/update");
const { completionText, parseSse } = require("../src/gateway-check");

describe("version compare", () => {
  test("orders releases", () => {
    expect(compareVersions("0.3.0", "0.4.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
    expect(compareVersions("v0.4.0", "0.4.0")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
  });
  test("a release outranks its prerelease", () => {
    expect(compareVersions("0.4.0", "0.4.0-beta.1")).toBe(1);
    expect(compareVersions("0.4.0-beta.1", "0.4.0")).toBe(-1);
  });
  test("non-semver gives null", () => {
    expect(compareVersions("latest", "0.4.0")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("gateway check parsing", () => {
  test("reads text from string and array content", () => {
    expect(completionText({ choices: [{ message: { content: "OK" } }] })).toBe("OK");
    expect(completionText({ choices: [{ message: { content: [{ type: "text", text: "OK" }] } }] })).toBe("OK");
    expect(completionText({ choices: [{ message: { content: null } }] })).toBe("");
    expect(completionText(null)).toBe("");
  });
  test("joins SSE deltas and detects the sentinel", () => {
    const raw = 'data: {"choices":[{"delta":{"content":"O"}}]}\n\ndata: {"choices":[{"delta":{"content":"K"}}]}\n\ndata: [DONE]\n\n';
    expect(parseSse(raw)).toEqual({ text: "OK", done: true });
  });
  test("a stream with only reasoning or whitespace is not an answer", () => {
    const raw = 'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\ndata: {"choices":[{"delta":{"content":"\\n"}}]}\n\ndata: [DONE]\n\n';
    expect(parseSse(raw).text.trim()).toBe("");
  });
  test("a truncated stream has no sentinel", () => {
    expect(parseSse('data: {"choices":[{"delta":{"content":"O"}}]}\n\n').done).toBe(false);
  });
});
