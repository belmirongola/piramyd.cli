/**
 * `piramyd chat` — reconcile conversation history across Piramyd profiles.
 *
 * The toolkit runs each CLI through an isolated profile: `claude-piramyd` uses
 * CLAUDE_CONFIG_DIR=~/.claude-piramyd, `codex-piramyd` uses `--profile piramyd`.
 * The isolation is deliberate, but it means chats stay trapped in whichever
 * profile created them. This module inventories both stores and can copy the
 * sessions that exist in one but not the other.
 *
 * Two readers, two very different storage models:
 *   - Claude: one JSONL per session under projects/<cwd-slug>/.
 *   - Codex:  one shared sessions/YYYY/MM/DD/ tree for BOTH profiles; each
 *             rollout records which provider it ran against in session_meta.
 *
 * Everything here is streaming and side-effect free. Writing lives in
 * `importMissing()` only, and only ever adds files that are absent.
 */
const fs = require("fs");
const path = require("path");
const {
  CLAUDE_HOME_DIR, CLAUDE_CONFIG_DIR,
  CODEX_HOME_DIR,
} = require("./constants");
const { existsPath, ensureParentDir } = require("./utils");

// Prefixes Claude Code uses for harness-generated user records that are not
// human input. `pasted_content` is deliberately absent — that IS user input.
const SYNTHETIC_USER_PREFIXES = [
  "task-notification",
  "local-command-caveat",
  "local-command-stdout",
  "command-name",
  "command-message",
];

// Codex wraps harness context in XML-ish tags with no human text behind them.
const CODEX_SYNTHETIC_TAGS = [
  "environment_context",
  "permissions",
  "turn_aborted",
  "recommended_plugins",
  "image",
];

/**
 * Every chat store we know how to read, regardless of whether it exists.
 * `profile` is the value users pass to --from/--to.
 */
function listChatStores(options = {}) {
  const homeDir = options.homeDir || null;
  const resolve = (absolute, ...rest) => (homeDir ? path.resolve(homeDir, ...rest) : absolute);

  const claudeDir = resolve(CLAUDE_HOME_DIR, ".claude");
  const claudePiramydDir = resolve(CLAUDE_CONFIG_DIR, ".claude-piramyd");
  const codexDir = resolve(CODEX_HOME_DIR, ".codex");

  return [
    {
      cli: "claude",
      profile: "claude",
      label: "Claude Code",
      cliName: "claude",
      dir: claudeDir,
      projectsDir: path.join(claudeDir, "projects"),
      sessionsDir: path.join(claudeDir, "sessions"),
      isolated: false,
    },
    {
      cli: "claude",
      profile: "claude-piramyd",
      label: "Claude Code (Piramyd)",
      cliName: "claude",
      dir: claudePiramydDir,
      projectsDir: path.join(claudePiramydDir, "projects"),
      sessionsDir: path.join(claudePiramydDir, "sessions"),
      isolated: true,
    },
    {
      cli: "codex",
      profile: "codex",
      label: "Codex (nativo)",
      cliName: "codex",
      dir: codexDir,
      sessionsDir: path.join(codexDir, "sessions"),
      stateDbPath: path.join(codexDir, "state_5.sqlite"),
      isolated: false,
      shared: true,
    },
    {
      cli: "codex",
      profile: "codex-piramyd",
      label: "Codex (Piramyd)",
      cliName: "codex",
      dir: codexDir,
      sessionsDir: path.join(codexDir, "sessions"),
      stateDbPath: path.join(codexDir, "state_5.sqlite"),
      isolated: true,
      shared: true,
    },
  ];
}

/** Stores that actually have something on disk. */
function visibleChatStores(options = {}) {
  return listChatStores(options).filter((store) => existsPath(store.dir));
}

function storeByProfile(profile, options = {}) {
  const wanted = String(profile || "").trim().toLowerCase();
  if (!wanted) return null;
  return listChatStores(options).find((store) => store.profile === wanted) || null;
}


// ── Shared streaming helpers ────────────────────────────────────

/**
 * Walk a JSONL file line by line. The biggest transcripts here are ~40 MB with
 * individual lines over 1 MB, so we never read a whole file into memory.
 * `visit` returns false to stop early. Malformed lines are skipped, not fatal —
 * live sessions are appended to concurrently and can be caught mid-write.
 */
function scanJsonl(filePath, visit) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return;
  }

  const buffer = Buffer.alloc(1024 * 1024);
  let carry = "";
  let done = false;
  let bytesRead = 0;

  try {
    while (!done) {
      let read = 0;
      try {
        read = fs.readSync(fd, buffer, 0, buffer.length, null);
      } catch {
        break;
      }
      if (read <= 0) break;
      bytesRead += read;

      const chunk = carry + buffer.toString("utf8", 0, read);
      const lines = chunk.split("\n");
      carry = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let record;
        try {
          record = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (visit(record) === false) {
          done = true;
          break;
        }
      }
    }

    const tail = carry.trim();
    if (!done && tail) {
      try {
        visit(JSON.parse(tail));
      } catch {
        // truncated final line — ignore
      }
    }
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
  }
  return bytesRead;
}

function isSyntheticUserText(text) {
  const raw = String(text || "").trimStart();
  if (!raw) return true;
  if (raw.startsWith("Caveat:")) return true;
  const match = raw.match(/^<([a-zA-Z0-9_-]+)/);
  if (!match) return false;
  return SYNTHETIC_USER_PREFIXES.includes(match[1]);
}

/** Flatten a Claude `message.content` (string or block array) to plain text. */
function claudeTextBlocks(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text) out.push(block.text);
  }
  return out;
}

function summarize(text, max = 72) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

// ── Claude reader ───────────────────────────────────────────────

/**
 * A `user` record only counts as a human turn when it is not tool plumbing and
 * not subagent traffic. Measured across 30 real files: when `toolUseResult` is
 * present, 9284/9284 records are tool results — it is an exact discriminator,
 * far more reliable than sniffing the content shape.
 */
function isRealClaudeUserTurn(record) {
  if (record.type !== "user") return false;
  if (record.toolUseResult !== null && record.toolUseResult !== undefined) return false;
  if (record.isMeta === true) return false;
  if (record.isSidechain === true) return false;
  const texts = claudeTextBlocks((record.message || {}).content);
  if (!texts.length) return false;
  return texts.some((text) => !isSyntheticUserText(text));
}

function isClaudeAssistantTurn(record) {
  if (record.type !== "assistant") return false;
  if (record.isSidechain === true) return false;
  return claudeTextBlocks((record.message || {}).content).length > 0;
}

function claudeSessionId(record, fallback) {
  return String(record.sessionId || record.session_id || fallback || "");
}

function recordTimestamp(record) {
  const raw = record.timestamp || record.probed_at || record.created_at;
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read one Claude transcript. Titles are cumulative records that get rewritten
 * as the conversation evolves, so the LAST one wins; `customTitle` (a title the
 * user typed) beats the generated `aiTitle`.
 */
function readClaudeSession(filePath) {
  const fallbackId = path.basename(filePath, ".jsonl");
  const state = {
    sessionId: fallbackId,
    cwd: "",
    gitBranch: "",
    aiTitle: "",
    customTitle: "",
    lastPrompt: "",
    firstUserTurn: "",
    createdAt: null,
    updatedAt: null,
    turns: 0,
    userTurns: 0,
    assistantTurns: 0,
    subagents: 0,
    truncated: false,
  };

  scanJsonl(filePath, (record) => {
    if (!record || typeof record !== "object") return;

    if (record.type === "bridge-session" && !state.sessionId) {
      state.sessionId = claudeSessionId(record, fallbackId);
      return;
    }

    // Titles are cumulative — keep overwriting so the last one wins.
    if (record.type === "ai-title" && record.aiTitle) state.aiTitle = String(record.aiTitle);
    if (record.type === "custom-title" && record.customTitle) state.customTitle = String(record.customTitle);
    if (record.type === "last-prompt" && record.lastPrompt) state.lastPrompt = String(record.lastPrompt).trim();

    if (record.cwd) state.cwd = String(record.cwd);
    if (record.gitBranch) state.gitBranch = String(record.gitBranch);
    const id = claudeSessionId(record, "");
    if (id) state.sessionId = id;

    const ts = recordTimestamp(record);
    if (ts !== null) {
      if (state.createdAt === null || ts < state.createdAt) state.createdAt = ts;
      if (state.updatedAt === null || ts > state.updatedAt) state.updatedAt = ts;
    }

    if (isRealClaudeUserTurn(record)) {
      state.userTurns += 1;
      state.turns += 1;
      if (!state.firstUserTurn) {
        const texts = claudeTextBlocks((record.message || {}).content);
        const human = texts.find((text) => !isSyntheticUserText(text));
        state.firstUserTurn = summarize(human || texts[0]);
      }
      return;
    }

    if (isClaudeAssistantTurn(record)) {
      state.assistantTurns += 1;
      state.turns += 1;
    }
  });

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  return finalizeSession({
    cli: "claude",
    sessionId: state.sessionId,
    cwd: state.cwd,
    gitBranch: state.gitBranch,
    title: state.customTitle || state.aiTitle || state.firstUserTurn || state.lastPrompt,
    titleSource: state.customTitle
      ? "custom-title"
      : state.aiTitle
        ? "ai-title"
        : state.firstUserTurn
          ? "first-prompt"
          : state.lastPrompt
            ? "last-prompt"
            : "",
    createdAt: state.createdAt,
    updatedAt: state.updatedAt || (stat ? stat.mtimeMs : null),
    turns: state.turns,
    userTurns: state.userTurns,
    assistantTurns: state.assistantTurns,
    bytes: stat ? stat.size : 0,
    path: filePath,
  });
}

/** Normalize a session record so every reader returns the same shape. */
function finalizeSession(raw) {
  return {
    cli: raw.cli,
    profile: raw.profile || "",
    sessionId: raw.sessionId || "",
    cwd: raw.cwd || "",
    gitBranch: raw.gitBranch || "",
    title: raw.title || "",
    titleSource: raw.titleSource || "",
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    turns: raw.turns || 0,
    userTurns: raw.userTurns || 0,
    assistantTurns: raw.assistantTurns || 0,
    bytes: raw.bytes || 0,
    path: raw.path || "",
    live: raw.live === true,
    provider: raw.provider || "",
    ambiguous: raw.ambiguous === true,
    source: raw.source || "",
  };
}

/**
 * Every top-level `<uuid>.jsonl` under projects/. Nested files
 * (`<parent>/subagents/agent-<hex>.jsonl`) are subagent traffic and are
 * deliberately excluded — they share the parent's cwd but are not chats.
 */
function listClaudeSessionFiles(projectsDir) {
  if (!existsPath(projectsDir)) return [];
  const found = [];

  let slugs;
  try {
    slugs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const slugEntry of slugs) {
    if (!slugEntry.isDirectory()) continue;
    const slugDir = path.join(projectsDir, slugEntry.name);

    let entries;
    try {
      entries = fs.readdirSync(slugDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".jsonl")) continue;
      const sessionId = entry.name.slice(0, -".jsonl".length);
      found.push({
        path: path.join(slugDir, entry.name),
        slug: slugEntry.name,
        sessionId,
        hasSiblingDir: existsPath(path.join(slugDir, sessionId)),
      });
    }
  }

  return found;
}

/** Read every Claude session in one store. */
function readClaudeSessions(store, options = {}) {
  const projectsDir = store.projectsDir;
  const files = listClaudeSessionFiles(projectsDir);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  const sessions = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    let session;
    try {
      session = readClaudeSession(file.path);
    } catch (err) {
      session = finalizeSession({
        cli: "claude",
        sessionId: file.sessionId,
        path: file.path,
        source: "unreadable",
      });
      session.error = String(err.message || err);
    }
    session.profile = store.profile;
    session.source = session.source || "claude";
    session.hasSiblingDir = file.hasSiblingDir;
    sessions.push(session);
    if (onProgress) onProgress(session, i + 1, files.length);
  }

  return sessions;
}

// ── Codex reader ────────────────────────────────────────────────

function isCodexSyntheticUserText(text) {
  const raw = String(text || "").trimStart();
  if (!raw) return true;
  if (raw.startsWith("Caveat:")) return true;
  const match = raw.match(/^<([a-zA-Z0-9_-]+)/);
  if (!match) return false;
  return CODEX_SYNTHETIC_TAGS.includes(match[1]);
}

function codexTextBlocks(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (typeof block.text === "string" && block.text) out.push(block.text);
  }
  return out;
}

/**
 * Read one Codex rollout. Only `response_item` message records count —
 * `event_msg.agent_message` is a near-duplicate mirror of the same assistant
 * text, so counting both would double every reply.
 */
function readCodexRollout(filePath) {
  const state = {
    sessionId: "",
    cwd: "",
    provider: "",
    originator: "",
    cliVersion: "",
    firstUserTurn: "",
    createdAt: null,
    updatedAt: null,
    userTurns: 0,
    assistantTurns: 0,
    compacted: 0,
  };

  const filenameId = (path.basename(filePath, ".jsonl").match(/([0-9a-f-]{36})$/) || [])[1] || "";

  scanJsonl(filePath, (record) => {
    if (!record || typeof record !== "object") return;

    const ts = recordTimestamp(record);
    if (ts !== null) {
      if (state.createdAt === null || ts < state.createdAt) state.createdAt = ts;
      if (state.updatedAt === null || ts > state.updatedAt) state.updatedAt = ts;
    }

    if (record.type === "session_meta") {
      const payload = record.payload || {};
      state.sessionId = String(payload.id || payload.session_id || filenameId);
      state.cwd = String(payload.cwd || "");
      state.provider = String(payload.model_provider || "");
      state.originator = String(payload.originator || "");
      state.cliVersion = String(payload.cli_version || "");
      // session_meta.timestamp is UTC and authoritative; the filename's stamp is
      // local time, so prefer the payload value for ordering.
      const metaTs = payload.timestamp ? new Date(payload.timestamp).getTime() : null;
      if (Number.isFinite(metaTs)) {
        state.createdAt = state.createdAt === null ? metaTs : Math.min(state.createdAt, metaTs);
      }
      return;
    }

    if (record.type === "compacted") {
      state.compacted += 1;
      return;
    }

    if (record.type !== "response_item") return;
    const payload = record.payload || {};
    if (payload.type !== "message") return;

    const role = String(payload.role || "");
    const texts = codexTextBlocks(payload.content);
    if (!texts.length) return;

    if (role === "user") {
      const human = texts.find((text) => !isCodexSyntheticUserText(text));
      if (!human) return;
      state.userTurns += 1;
      if (!state.firstUserTurn) state.firstUserTurn = summarize(human);
      return;
    }

    if (role === "assistant") {
      state.assistantTurns += 1;
    }
    // role === "developer" is the system prompt — never a turn.
  });

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  return finalizeSession({
    cli: "codex",
    sessionId: state.sessionId || filenameId,
    cwd: state.cwd,
    provider: state.provider,
    title: state.firstUserTurn,
    titleSource: state.firstUserTurn ? "first-prompt" : "",
    createdAt: state.createdAt,
    updatedAt: state.updatedAt || (stat ? stat.mtimeMs : null),
    turns: state.userTurns + state.assistantTurns,
    userTurns: state.userTurns,
    assistantTurns: state.assistantTurns,
    bytes: stat ? stat.size : 0,
    path: filePath,
    source: "codex",
  });
}

/** Every rollout file under sessions/YYYY/MM/DD/. */
function listCodexRolloutFiles(sessionsDir) {
  if (!existsPath(sessionsDir)) return [];
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(sessionsDir, 0);
  return found;
}

/**
 * Read the Codex metadata index (state_5.sqlite, table `threads`). This is the
 * authoritative title/message-count source — far more complete than
 * session_index.jsonl. The DB is live (WAL), so it is opened read-only and any
 * failure degrades to "no metadata" rather than throwing.
 */
function readCodexThreadIndex(dbPath) {
  const byId = new Map();
  if (!existsPath(dbPath)) return byId;

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return byId; // Node < 22.5 — titles fall back to the first prompt
  }
  if (typeof DatabaseSync !== "function") return byId;

  let db;
  try {
    db = new DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
  } catch {
    return byId;
  }

  try {
    const rows = db.prepare(
      "SELECT id, rollout_path, cwd, title, first_user_message, model_provider, archived, updated_at, created_at FROM threads"
    ).all();
    for (const row of rows) {
      if (!row || !row.id) continue;
      byId.set(String(row.id), {
        title: String(row.title || "").trim(),
        firstUserMessage: String(row.first_user_message || "").trim(),
        provider: String(row.model_provider || ""),
        cwd: String(row.cwd || ""),
        rolloutPath: String(row.rollout_path || ""),
        archived: row.archived === 1 || row.archived === true,
        updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
      });
    }
  } catch {
    // schema drift or busy DB — fall back to JSONL-only metadata
  } finally {
    try {
      db.close();
    } catch {
      // already closed
    }
  }

  return byId;
}

/**
 * Read every Codex rollout, enriched with the metadata index. Both profiles
 * live in the same tree, so each session is tagged with the `model_provider`
 * it recorded — that is what separates "codex" from "codex-piramyd".
 */
function readCodexSessions(store, options = {}) {
  const files = listCodexRolloutFiles(store.sessionsDir);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const threadIndex = options.skipIndex ? new Map() : readCodexThreadIndex(store.stateDbPath);

  const sessions = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    let session;
    try {
      session = readCodexRollout(file);
    } catch (err) {
      session = finalizeSession({ cli: "codex", path: file, source: "unreadable" });
      session.error = String(err.message || err);
    }

    const meta = threadIndex.get(session.sessionId);
    if (meta) {
      // The DB title is preferred, but many Codex titles are just the raw first
      // prompt ("hi"), so only take it when it says something.
      if (meta.title) {
        session.title = meta.title;
        session.titleSource = "thread-title";
      } else if (meta.firstUserMessage) {
        session.title = summarize(meta.firstUserMessage);
        session.titleSource = "first-prompt";
      }
      if (!session.cwd && meta.cwd) session.cwd = meta.cwd;
      if (!session.provider && meta.provider) session.provider = meta.provider;
      session.archived = meta.archived === true;
    }

    session.profile = session.provider === "piramyd" ? "codex-piramyd" : "codex";
    session.source = "codex";
    sessions.push(session);
    if (onProgress) onProgress(session, i + 1, files.length);
  }

  return sessions;
}

module.exports = {
  SYNTHETIC_USER_PREFIXES,
  CODEX_SYNTHETIC_TAGS,
  listChatStores,
  visibleChatStores,
  storeByProfile,
  scanJsonl,
  isSyntheticUserText,
  claudeTextBlocks,
  summarize,
  finalizeSession,
  isRealClaudeUserTurn,
  isClaudeAssistantTurn,
  listClaudeSessionFiles,
  readClaudeSession,
  readClaudeSessions,
  isCodexSyntheticUserText,
  codexTextBlocks,
  readCodexRollout,
  listCodexRolloutFiles,
  readCodexThreadIndex,
  readCodexSessions,
  indexSessions,
  reconcile,
  buildChatIndex,
  planImport,
  importMissing,
};

// ── Reconciliation ──────────────────────────────────────────────

/** Index a session list by "cli::sessionId". */
function indexSessions(sessions) {
  const byKey = new Map();
  const duplicates = [];
  for (const session of sessions || []) {
    const key = `${session.cli}::${session.sessionId}`;
    if (byKey.has(key)) {
      duplicates.push(key);
      continue;
    }
    byKey.set(key, session);
  }
  return { byKey, duplicates };
}

/**
 * Compare two stores of the SAME cli. Sessions are matched by id alone; when
 * the same id exists on both sides under a different cwd we flag it ambiguous
 * rather than guessing which one is "the" chat.
 */
function reconcile(storeA, sessionsA, storeB, sessionsB) {
  const a = indexSessions(sessionsA);
  const b = indexSessions(sessionsB);

  const onlyA = [];
  const onlyB = [];
  const both = [];
  const ambiguous = [];

  for (const [key, session] of a.byKey) {
    const counterpart = b.byKey.get(key);
    if (!counterpart) {
      onlyA.push(session);
      continue;
    }
    if (session.cwd && counterpart.cwd && session.cwd !== counterpart.cwd) {
      ambiguous.push({ key, sessionId: session.sessionId, a: session, b: counterpart });
      continue;
    }
    both.push({ sessionId: session.sessionId, a: session, b: counterpart });
  }

  for (const [key, session] of b.byKey) {
    if (!a.byKey.has(key)) onlyB.push(session);
  }

  const sortByUpdated = (list) =>
    [...list].sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));

  return {
    storeA,
    storeB,
    onlyA: sortByUpdated(onlyA),
    onlyB: sortByUpdated(onlyB),
    ambiguous,
    both: sortByUpdated(both),
    totalA: a.byKey.size,
    totalB: b.byKey.size,
  };
}

/**
 * Build the full picture: inventory per store plus a reconciliation for each
 * CLI that has two profiles. Codex is inventoried but NOT reconciled — both
 * profiles write into the same sessions/ tree, so there is no second location
 * to import into.
 */
function buildChatIndex(options = {}) {
  const stores = visibleChatStores(options);
  const sessionsByProfile = {};
  const inventory = [];

  for (const store of stores) {
    const sessions = store.cli === "claude"
      ? readClaudeSessions(store, options)
      : readCodexSessions(store, options);
    sessionsByProfile[store.profile] = sessions;
    inventory.push({ store, sessions, count: sessions.length });
  }

  const reconciliations = [];
  const claudeStores = stores.filter((store) => store.cli === "claude");
  if (claudeStores.length === 2) {
    reconciliations.push(
      reconcile(claudeStores[0], sessionsByProfile[claudeStores[0].profile],
        claudeStores[1], sessionsByProfile[claudeStores[1].profile])
    );
  }

  return { inventory, sessionsByProfile, reconciliations, stores };
}

// ── Import ──────────────────────────────────────────────────────

/**
 * Plan which sessions would be copied from `sourceStore` into `targetStore`.
 * Purely additive: anything already present in the target is skipped, never
 * overwritten. Shared-tree stores (Codex) are rejected upstream — there is no
 * separate destination to import into.
 */
function planImport(sourceStore, sessions, targetStore, options = {}) {
  if (!sourceStore || !targetStore) {
    return { ok: false, error: "both --from and --to are required for import." };
  }
  if (sourceStore.cli !== targetStore.cli) {
    return {
      ok: false,
      error: `--from ${sourceStore.profile} and --to ${targetStore.profile} are different CLIs. ` +
        "Cross-CLI conversion is not supported yet.",
    };
  }
  if (sourceStore.shared && targetStore.shared) {
    return {
      ok: false,
      error: `${sourceStore.label} and ${targetStore.label} share the same storage (${sourceStore.sessionsDir}). ` +
        "Both profiles write into one sessions tree, distinguished only by the model_provider recorded inside " +
        "each rollout — so there is no separate destination to import into. Nothing to do.",
    };
  }

  const targetIds = new Set((options.targetSessions || []).map((session) => session.sessionId));
  const targetCwds = new Map(
    (options.targetSessions || []).map((session) => [session.sessionId, session.cwd])
  );

  const toCopy = [];
  const skipped = [];
  const conflicts = [];

  for (const session of sessions) {
    if (!targetIds.has(session.sessionId)) {
      toCopy.push(session);
      continue;
    }
    const targetCwd = targetCwds.get(session.sessionId) || "";
    if (session.cwd && targetCwd && session.cwd !== targetCwd) {
      conflicts.push({ session, targetCwd });
      continue;
    }
    skipped.push(session);
  }

  return {
    ok: true,
    sourceStore,
    targetStore,
    toCopy,
    skipped,
    conflicts,
  };
}

/**
 * Execute a plan. Only ever creates files that do not exist — a name collision
 * is reported and skipped rather than written over, so a failed run can be
 * re-run safely.
 */
function importMissing(sourceStore, sessions, targetStore, options = {}) {
  const targetSessions = options.targetSessions || [];
  const plan = planImport(sourceStore, sessions, targetStore, { targetSessions });
  if (!plan.ok) return { ...plan, written: [], skipped: [], errors: [] };

  if (options.dryRun) return { ...plan, written: [], errors: [], dryRun: true };

  const written = [];
  const errors = [];

  for (const session of plan.toCopy) {
    try {
      const relative = sourceStore.cli === "claude"
        ? path.relative(sourceStore.projectsDir, session.path)
        : path.relative(sourceStore.sessionsDir, session.path);
      const destination = path.join(
        sourceStore.cli === "claude" ? targetStore.projectsDir : targetStore.sessionsDir,
        relative
      );

      if (existsPath(destination)) {
        plan.skipped.push(session);
        continue;
      }

      ensureParentDir(destination);
      fs.copyFileSync(session.path, destination);
      written.push({ session, destination });
    } catch (err) {
      errors.push({ session, error: String(err.message || err) });
    }
  }

  return { ...plan, written, errors, dryRun: false };
}
