const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  isSyntheticUserText,
  claudeTextBlocks,
  summarize,
  readClaudeSession,
  readCodexRollout,
  listClaudeSessionFiles,
  listCodexRolloutFiles,
  planImport,
  importMissing,
  reconcile,
  indexSessions,
  storeByProfile,
  isRealClaudeUserTurn,
} = require("../src/chat");

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "piramyd-chat-"));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonl(filePath, records) {
  write(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

const SESSION_ID = "11111111-1111-1111-1111-111111111111";
const CWD = "/Users/test/proj";

function claudeUser(text, overrides = {}) {
  return {
    type: "user",
    message: { role: "user", content: text },
    cwd: CWD,
    timestamp: "2026-09-01T10:00:00.000Z",
    sessionId: SESSION_ID,
    toolUseResult: null,
    ...overrides,
  };
}

function claudeAssistant(text) {
  return {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
    cwd: CWD,
    timestamp: "2026-09-01T10:00:01.000Z",
    sessionId: SESSION_ID,
  };
}

describe("synthetic user text detection", () => {
  test("flags harness prefixes but keeps real input", () => {
    expect(isSyntheticUserText("<task-notification>x</task-notification>")).toBe(true);
    expect(isSyntheticUserText("<local-command-caveat>x")).toBe(true);
    expect(isSyntheticUserText("<command-name>/foo")).toBe(true);
    expect(isSyntheticUserText("Caveat: something")).toBe(true);
    expect(isSyntheticUserText("")).toBe(true);
  });

  test("does not flag pasted_content or plain text", () => {
    // pasted_content is genuine user input — a naive "starts with <" rule would
    // silently delete real conversation.
    expect(isSyntheticUserText("<pasted_content>real</pasted_content>")).toBe(false);
    expect(isSyntheticUserText("Ola, ajuda-me")).toBe(false);
    expect(isSyntheticUserText("<pasted_content id=\"d636\">x")).toBe(false);
  });
});

describe("claudeTextBlocks", () => {
  test("handles string content", () => {
    expect(claudeTextBlocks("hello")).toEqual(["hello"]);
  });

  test("extracts only text blocks, ignoring tool_result and thinking", () => {
    expect(claudeTextBlocks([
      { type: "tool_result", content: "output" },
      { type: "text", text: "real" },
      { type: "thinking", thinking: "hmm" },
    ])).toEqual(["real"]);
  });

  test("handles null and malformed input", () => {
    expect(claudeTextBlocks(null)).toEqual([]);
    expect(claudeTextBlocks([null, "string", { type: "text" }])).toEqual([]);
  });
});

describe("isRealClaudeUserTurn", () => {
  test("toolUseResult marks a record as tool plumbing, not a turn", () => {
    expect(isRealClaudeUserTurn(claudeUser("x", { toolUseResult: { ok: true } }))).toBe(false);
    expect(isRealClaudeUserTurn(claudeUser([{ type: "tool_result", content: "o" }], { toolUseResult: {} }))).toBe(false);
  });

  test("excludes isMeta and isSidechain records", () => {
    expect(isRealClaudeUserTurn(claudeUser("x", { isMeta: true }))).toBe(false);
    expect(isRealClaudeUserTurn(claudeUser("x", { isSidechain: true }))).toBe(false);
  });

  test("accepts a plain human turn", () => {
    expect(isRealClaudeUserTurn(claudeUser("Ola"))).toBe(true);
  });
});

describe("readClaudeSession", () => {
  test("counts only real turns and ignores tool results", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, `${SESSION_ID}.jsonl`);
    writeJsonl(file, [
      claudeUser("primeiro pedido"),
      claudeAssistant("claro"),
      claudeUser([{ type: "tool_result", content: "out" }], { toolUseResult: { ok: true } }),
      claudeUser("<task-notification>x</task-notification>"),
      claudeUser("<pasted_content>real</pasted_content>"),
      claudeAssistant("feito"),
    ]);

    const session = readClaudeSession(file);
    expect(session.userTurns).toBe(2);
    expect(session.assistantTurns).toBe(2);
    expect(session.turns).toBe(4);
    expect(session.cwd).toBe(CWD);
    expect(session.sessionId).toBe(SESSION_ID);
  });

  test("the LAST ai-title wins, and custom-title beats it", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, `${SESSION_ID}.jsonl`);
    writeJsonl(file, [
      { type: "ai-title", aiTitle: "titulo antigo", sessionId: SESSION_ID },
      claudeUser("ola"),
      { type: "ai-title", aiTitle: "titulo novo", sessionId: SESSION_ID },
    ]);
    expect(readClaudeSession(file).title).toBe("titulo novo");
    expect(readClaudeSession(file).titleSource).toBe("ai-title");

    writeJsonl(file, [
      { type: "ai-title", aiTitle: "gerado", sessionId: SESSION_ID },
      { type: "custom-title", customTitle: "o meu titulo", sessionId: SESSION_ID },
    ]);
    const withCustom = readClaudeSession(file);
    expect(withCustom.title).toBe("o meu titulo");
    expect(withCustom.titleSource).toBe("custom-title");
  });

  test("falls back to the first prompt when no title record exists", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, `${SESSION_ID}.jsonl`);
    writeJsonl(file, [claudeUser("   Primeiro   pedido   "), claudeAssistant("ok")]);
    const session = readClaudeSession(file);
    expect(session.title).toBe("Primeiro pedido");
    expect(session.titleSource).toBe("first-prompt");
  });

  test("tolerates a malformed line and a stub session with no cwd", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, "22222222-2222-2222-2222-222222222222.jsonl");
    write(file, [
      JSON.stringify({ type: "bridge-session", sessionId: "22222222-2222-2222-2222-222222222222" }),
      "{ this is not valid json",
      "",
    ].join("\n"));

    const session = readClaudeSession(file);
    expect(session.turns).toBe(0);
    expect(session.cwd).toBe("");
    expect(session.sessionId).toBe("22222222-2222-2222-2222-222222222222");
  });
});

describe("readCodexRollout", () => {
  test("counts user and assistant turns, ignoring developer and synthetic context", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, "rollout-2026-09-01T10-00-00-33333333-3333-3333-3333-333333333333.jsonl");
    const id = "33333333-3333-3333-3333-333333333333";
    writeJsonl(file, [
      { type: "session_meta", payload: { id, timestamp: "2026-09-01T09:00:00.000Z", cwd: CWD, model_provider: "piramyd" } },
      { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "system prompt" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>x</environment_context>" }] } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "faz isto" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "input_text", text: "feito" }] } },
      { type: "event_msg", payload: { type: "agent_message", message: "feito" } },
      { type: "response_item", payload: { type: "function_call", name: "shell" } },
    ]);

    const session = readCodexRollout(file);
    expect(session.userTurns).toBe(1);
    expect(session.assistantTurns).toBe(1);
    // agent_message must NOT be summed in as a second assistant turn
    expect(session.turns).toBe(2);
    expect(session.provider).toBe("piramyd");
    expect(session.cwd).toBe(CWD);
    expect(session.sessionId).toBe(id);
    expect(session.title).toBe("faz isto");
  });
});

describe("store discovery", () => {
  test("resolves profiles", () => {
    expect(storeByProfile("claude").profile).toBe("claude");
    expect(storeByProfile("claude-piramyd").cli).toBe("claude");
    expect(storeByProfile("codex-piramyd").shared).toBe(true);
    expect(storeByProfile("nope")).toBeNull();
    expect(storeByProfile("")).toBeNull();
  });
});

describe("listClaudeSessionFiles", () => {
  test("finds top-level sessions but not subagent transcripts", () => {
    const dir = mkTmpDir();
    const projects = path.join(dir, "projects");
    const slug = path.join(projects, "-Users-test-proj");
    write(path.join(slug, `${SESSION_ID}.jsonl`), "{}\n");
    write(path.join(slug, SESSION_ID, "subagents", "agent-abc.jsonl"), "{}\n");

    const files = listClaudeSessionFiles(projects);
    expect(files).toHaveLength(1);
    expect(path.basename(files[0].path)).toBe(`${SESSION_ID}.jsonl`);
    expect(files[0].hasSiblingDir).toBe(true);
  });

  test("returns empty for a missing directory", () => {
    expect(listClaudeSessionFiles(path.join(mkTmpDir(), "nope"))).toEqual([]);
  });
});

describe("listCodexRolloutFiles", () => {
  test("walks the date tree and ignores non-rollout files", () => {
    const dir = mkTmpDir();
    write(path.join(dir, "2026", "09", "01", "rollout-2026-09-01T10-00-00-abc.jsonl"), "{}\n");
    write(path.join(dir, "2026", "09", "01", "notes.txt"), "x");
    expect(listCodexRolloutFiles(dir)).toHaveLength(1);
  });
});

describe("reconcile", () => {
  test("splits sessions into onlyA, onlyB and both", () => {
    const storeA = { profile: "claude", cli: "claude" };
    const storeB = { profile: "claude-piramyd", cli: "claude" };
    const result = reconcile(
      storeA,
      [{ cli: "claude", sessionId: "a", cwd: CWD }, { cli: "claude", sessionId: "shared", cwd: CWD }],
      storeB,
      [{ cli: "claude", sessionId: "b", cwd: CWD }, { cli: "claude", sessionId: "shared", cwd: CWD }]
    );
    expect(result.onlyA.map((s) => s.sessionId)).toEqual(["a"]);
    expect(result.onlyB.map((s) => s.sessionId)).toEqual(["b"]);
    expect(result.both.map((s) => s.sessionId)).toEqual(["shared"]);
    expect(result.ambiguous).toEqual([]);
  });

  test("flags the same id under different cwds as ambiguous instead of merging", () => {
    const result = reconcile(
      { profile: "claude" },
      [{ cli: "claude", sessionId: "dup", cwd: "/a" }],
      { profile: "claude-piramyd" },
      [{ cli: "claude", sessionId: "dup", cwd: "/b" }]
    );
    expect(result.both).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].sessionId).toBe("dup");
  });

  test("indexSessions reports duplicates rather than silently dropping", () => {
    const { byKey, duplicates } = indexSessions([
      { cli: "claude", sessionId: "x" },
      { cli: "claude", sessionId: "x" },
    ]);
    expect(byKey.size).toBe(1);
    expect(duplicates).toEqual(["claude::x"]);
  });
});

describe("planImport", () => {
  const storeA = { cli: "claude", profile: "claude", projectsDir: "/a", label: "A" };
  const storeB = { cli: "claude", profile: "claude-piramyd", projectsDir: "/b", label: "B" };

  test("plans to copy sessions absent from the target", () => {
    const plan = planImport(storeA, [{ cli: "claude", sessionId: "s1", cwd: CWD }], storeB, { targetSessions: [] });
    expect(plan.ok).toBe(true);
    expect(plan.toCopy).toHaveLength(1);
  });

  test("skips sessions already present, never overwriting", () => {
    const plan = planImport(
      storeA,
      [{ cli: "claude", sessionId: "s1", cwd: CWD }],
      storeB,
      { targetSessions: [{ sessionId: "s1", cwd: CWD }] }
    );
    expect(plan.toCopy).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });

  test("same id with a different cwd is a conflict, not a copy", () => {
    const plan = planImport(
      storeA,
      [{ cli: "claude", sessionId: "s1", cwd: "/a" }],
      storeB,
      { targetSessions: [{ sessionId: "s1", cwd: "/b" }] }
    );
    expect(plan.toCopy).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(1);
  });

  test("refuses cross-CLI conversion", () => {
    const plan = planImport(storeA, [], { cli: "codex", profile: "codex", label: "C" }, {});
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/different CLIs/);
  });

  test("refuses Codex profiles that share one storage tree", () => {
    const shared = { cli: "codex", profile: "codex", label: "Codex", shared: true, sessionsDir: "/x" };
    const target = { cli: "codex", profile: "codex-piramyd", label: "Codex P", shared: true, sessionsDir: "/x" };
    const plan = planImport(shared, [], target, {});
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/share the same storage/);
  });

  test("requires both sides", () => {
    expect(planImport(null, [], storeB, {}).ok).toBe(false);
    expect(planImport(storeA, [], null, {}).ok).toBe(false);
  });
});

describe("importMissing", () => {
  function mkStore(root, label) {
    return { cli: "claude", profile: label, projectsDir: path.join(root, "projects"), label };
  }

  function seed(root) {
    const slug = "-Users-test-proj";
    const source = path.join(root, "src-projects", slug, `${SESSION_ID}.jsonl`);
    write(source, JSON.stringify(claudeUser("ola")) + "\n");
    return { source, slug };
  }

  test("copies a missing session and preserves the original filename", () => {
    const root = mkTmpDir();
    const { source, slug } = seed(root);
    const targetStore = mkStore(root, "claude-piramyd");
    const sourceStore = { cli: "claude", profile: "claude", projectsDir: path.join(root, "src-projects"), label: "claude" };

    const result = importMissing(sourceStore, [{ cli: "claude", sessionId: SESSION_ID, path: source, cwd: CWD }], targetStore, { targetSessions: [] });

    expect(result.errors).toEqual([]);
    expect(result.written).toHaveLength(1);
    const destination = path.join(targetStore.projectsDir, slug, `${SESSION_ID}.jsonl`);
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.readFileSync(destination, "utf8")).toBe(fs.readFileSync(source, "utf8"));
  });

  test("dry run writes nothing", () => {
    const root = mkTmpDir();
    const { source, slug } = seed(root);
    const targetStore = mkStore(root, "claude-piramyd");
    const sourceStore = { cli: "claude", profile: "claude", projectsDir: path.join(root, "src-projects"), label: "claude" };

    const result = importMissing(sourceStore, [{ cli: "claude", sessionId: SESSION_ID, path: source, cwd: CWD }], targetStore, { targetSessions: [], dryRun: true });

    expect(result.written).toEqual([]);
    expect(fs.existsSync(path.join(targetStore.projectsDir, slug, `${SESSION_ID}.jsonl`))).toBe(false);
  });

  test("is idempotent — a second run has nothing left to copy", () => {
    const root = mkTmpDir();
    const { source } = seed(root);
    const targetStore = mkStore(root, "claude-piramyd");
    const sourceStore = { cli: "claude", profile: "claude", projectsDir: path.join(root, "src-projects"), label: "claude" };
    const sessions = [{ cli: "claude", sessionId: SESSION_ID, path: source, cwd: CWD }];

    const first = importMissing(sourceStore, sessions, targetStore, { targetSessions: [] });
    expect(first.written).toHaveLength(1);

    const second = importMissing(sourceStore, sessions, targetStore, {
      targetSessions: [{ sessionId: SESSION_ID, cwd: CWD }],
    });
    expect(second.toCopy).toHaveLength(0);
    expect(second.written).toHaveLength(0);
  });

  test("does not overwrite an existing destination file", () => {
    const root = mkTmpDir();
    const { source, slug } = seed(root);
    const targetStore = mkStore(root, "claude-piramyd");
    const sourceStore = { cli: "claude", profile: "claude", projectsDir: path.join(root, "src-projects"), label: "claude" };
    const destination = path.join(targetStore.projectsDir, slug, `${SESSION_ID}.jsonl`);
    write(destination, "keep me");

    const result = importMissing(sourceStore, [{ cli: "claude", sessionId: SESSION_ID, path: source, cwd: CWD }], targetStore, { targetSessions: [] });

    expect(result.written).toHaveLength(0);
    expect(fs.readFileSync(destination, "utf8")).toBe("keep me");
  });
});

describe("summarize", () => {
  test("collapses whitespace and truncates", () => {
    expect(summarize("  a   b  ")).toBe("a b");
    expect(summarize("x".repeat(100)).length).toBeLessThanOrEqual(72);
    expect(summarize("")).toBe("");
  });
});
