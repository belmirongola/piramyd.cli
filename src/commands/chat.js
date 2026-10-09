const p = require("@clack/prompts");
const pc = require("picocolors");
const { brand, accent, ok, muted, em, DIVIDER, renderBanner } = require("../ui");
const { truncateMiddle, padRight } = require("../utils");
const { relativeAge } = require("../prober");
const { listChatStores, storeByProfile, buildChatIndex, planImport, importMissing } = require("../chat");

// ── chat (reconcile conversations across Piramyd profiles) ──────
const CHAT_STATE_WIDTH = 9;

const CHAT_TITLE_WIDTH = 38;

const CHAT_PROFILE_WIDTH = 17;

const CHAT_COUNT_WIDTH = 8;

const CHAT_SIZE_WIDTH = 9;

const CHAT_AGE_WIDTH = 7;

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function chatStateCell(state) {
  if (state === "both") return ok("● ambos");
  if (state === "onlyA") return brand("● só A");
  if (state === "onlyB") return accent("● só B");
  if (state === "live") return pc.yellow("▲ live");
  if (state === "ambiguous") return pc.yellow("▲ difere");
  return muted("·");
}

function renderChatHeader() {
  return `  ${padRight(muted("Estado"), CHAT_STATE_WIDTH)} ${padRight(muted("Sessão"), CHAT_TITLE_WIDTH)} ${padRight(muted("Perfil"), CHAT_PROFILE_WIDTH)} ${padRight(muted("Turnos"), CHAT_COUNT_WIDTH)} ${padRight(muted("Tam"), CHAT_SIZE_WIDTH)} ${padRight(muted("Age"), CHAT_AGE_WIDTH)}`;
}

function formatChatRow(state, session, profile) {
  const title = session.title ? truncateMiddle(session.title, CHAT_TITLE_WIDTH) : muted("(sem título)");
  const cells = [
    padRight(chatStateCell(state), CHAT_STATE_WIDTH),
    padRight(title, CHAT_TITLE_WIDTH),
    padRight(truncateMiddle(profile, CHAT_PROFILE_WIDTH), CHAT_PROFILE_WIDTH),
    padRight(String(session.turns), CHAT_COUNT_WIDTH),
    padRight(formatBytes(session.bytes), CHAT_SIZE_WIDTH),
    padRight(relativeAge(session.updatedAt ? new Date(session.updatedAt).toISOString() : null) || muted("-"), CHAT_AGE_WIDTH),
  ];
  const line = `  ${cells.join(" ")}`;
  const cwd = session.cwd ? truncateMiddle(session.cwd, 58) : "";
  return cwd ? `${line}\n  ${padRight("", CHAT_STATE_WIDTH)} ${muted(cwd)}` : line;
}

/**
 * Codex's two profiles read the same sessions/ tree. Reporting it once (with a
 * provider split) avoids showing the same 52 files as two separate stores.
 */

function collapseSharedStores(idx) {
  const seen = new Set();
  const out = [];
  for (const entry of idx.inventory) {
    if (!entry.store.shared) {
      out.push(entry);
      continue;
    }
    if (seen.has(entry.store.cli)) continue;
    seen.add(entry.store.cli);
    out.push(entry);
  }
  return out;
}

function showChatInventory(idx) {
  console.log(DIVIDER);
  console.log(`  ${em("Stores")}`);
  console.log(DIVIDER);
  for (const entry of collapseSharedStores(idx)) {
    const { store, sessions } = entry;
    const withTurns = sessions.filter((session) => session.turns > 0).length;
    console.log(`  ${brand(store.label.padEnd(CHAT_PROFILE_WIDTH))} ${padRight(String(sessions.length), 5)} ${muted("sessões")}  ${padRight(String(withTurns), 5)} ${muted("com conversa")}  ${muted(store.dir)}`);
    if (store.shared) {
      const native = sessions.filter((session) => session.profile === "codex").length;
      const piramyd = sessions.filter((session) => session.profile === "codex-piramyd").length;
      console.log(`  ${padRight("", CHAT_PROFILE_WIDTH)} ${muted(`partilhado pelos dois perfis: ${native} nativo · ${piramyd} piramyd (model_provider em cada rollout)`)}`);
    }
  }
  console.log("");
}

function showChatReconciliation(result) {
  const { storeA, storeB } = result;
  console.log(DIVIDER);
  console.log(`  ${em(`Conciliação ${storeA.label} ↔ ${storeB.label}`)}`);
  console.log(`  ${muted(`A = ${storeA.profile}   B = ${storeB.profile}`)}`);
  console.log(DIVIDER);
  console.log("");
  console.log(renderChatHeader());
  console.log("");

  const rows = [];
  for (const session of result.both) rows.push(["both", session.a, storeA.profile, session.a]);
  for (const session of result.onlyA) rows.push(["onlyA", session, storeA.profile, session]);
  for (const session of result.onlyB) rows.push(["onlyB", session, storeB.profile, session]);
  for (const item of result.ambiguous) rows.push(["ambiguous", item.a, storeA.profile, item.a]);

  rows.sort((x, y) => (y[3].updatedAt || 0) - (x[3].updatedAt || 0));

  for (const [state, session, profile] of rows) {
    console.log(formatChatRow(state, session, profile));
  }
  if (!rows.length) console.log(`  ${muted("Nenhuma sessão encontrada.")}`);
  console.log("");

  const shown = rows.slice(0, 40);
  if (rows.length > shown.length) {
    console.log(`  ${muted(`… e mais ${rows.length - shown.length} sessão(ões). Usa --json para a lista completa.`)}`);
    console.log("");
  }

  console.log(DIVIDER);
  console.log(`  ${em("Só A:")} ${brand(String(result.onlyA.length))}   ${em("Só B:")} ${accent(String(result.onlyB.length))}   ${em("Em ambos:")} ${ok(String(result.both.length))}${result.ambiguous.length ? `   ${em("Ambíguas:")} ${pc.yellow(String(result.ambiguous.length))}` : ""}`);
  console.log(DIVIDER);
  console.log("");

  if (result.onlyB.length) {
    console.log(`  ${muted("Para trazer para A o que só existe em B:")}`);
    console.log(`  ${ok("$")} ${brand(`npx piramyd chat --from ${storeB.profile} --to ${storeA.profile} --dry-run`)}`);
    console.log("");
  }
  if (result.onlyA.length) {
    console.log(`  ${muted("Para trazer para B o que só existe em A:")}`);
    console.log(`  ${ok("$")} ${brand(`npx piramyd chat --from ${storeA.profile} --to ${storeB.profile} --dry-run`)}`);
    console.log("");
  }
}

function showChatAmbiguous(result) {
  if (!result.ambiguous.length) return;
  console.log(pc.yellow(`  ⚠ ${result.ambiguous.length} sessão(ões) com o mesmo id mas cwd diferente — não são fundidas:`));
  for (const item of result.ambiguous.slice(0, 5)) {
    console.log(`    ${muted(item.sessionId.slice(0, 8))}  A=${muted(truncateMiddle(item.a.cwd, 46))}`);
    console.log(`    ${padRight("", 8)}  B=${muted(truncateMiddle(item.b.cwd, 46))}`);
  }
  console.log("");
}

async function runChat(cli) {
  const jsonOut = cli.json;
  const index = buildChatIndex({ onProgress: null });

  // ── Import mode ──
  if (cli.from || cli.to) {
    const fromStore = storeByProfile(cli.from);
    const toStore = storeByProfile(cli.to);
    if (!fromStore || !toStore) {
      const known = listChatStores().map((store) => store.profile).join(", ");
      throw new Error(`Unknown profile. Use --from/--to with one of: ${known}`);
    }

    const sourceSessions = index.sessionsByProfile[fromStore.profile] || [];
    const targetSessions = index.sessionsByProfile[toStore.profile] || [];
    const plan = planImport(fromStore, sourceSessions, toStore, { targetSessions });

    if (!plan.ok) throw new Error(plan.error);

    if (jsonOut) {
      const result = cli.dryRun
        ? { ...plan, written: [], errors: [], dryRun: true }
        : importMissing(fromStore, sourceSessions, toStore, { targetSessions });
      console.log(JSON.stringify({
        ok: true,
        from: fromStore.profile,
        to: toStore.profile,
        dryRun: Boolean(cli.dryRun),
        toCopy: plan.toCopy.map((s) => ({ sessionId: s.sessionId, title: s.title, cwd: s.cwd, turns: s.turns })),
        skipped: plan.skipped.length,
        conflicts: plan.conflicts.length,
        written: result.written.map((w) => w.destination),
        errors: result.errors,
      }, null, 2));
      return;
    }

    console.log(renderBanner("Chat", "Reconcile conversations across Piramyd profiles"));
    p.intro(pc.bgYellow(pc.black(" Piramyd Chat — importar ")));
    console.log(DIVIDER);
    console.log(`  ${em("De:")}      ${brand(fromStore.label)} ${muted(fromStore.profile)}`);
    console.log(`  ${em("Para:")}    ${brand(toStore.label)} ${muted(toStore.profile)}`);
    console.log(`  ${em("A copiar:")} ${ok(String(plan.toCopy.length))}  ${em("Já presentes:")} ${muted(String(plan.skipped.length))}`);
    console.log(DIVIDER);
    console.log("");

    if (!plan.toCopy.length) {
      p.outro(ok("Nada a importar — o destino já tem todas as sessões."));
      return;
    }

    for (const session of plan.toCopy) {
      console.log(formatChatRow("onlyA", session, session.profile));
    }
    console.log("");

    if (cli.dryRun) {
      p.outro(pc.yellow("Dry-run: nada foi escrito. Repete sem --dry-run para aplicar."));
      return;
    }

    if (!cli.yes) {
      const confirmed = await p.confirm({
        message: `Copiar ${plan.toCopy.length} sessão(ões) para ${toStore.label}? ${muted("(só adiciona; nunca sobrescreve)")}`,
        initialValue: true,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel("Nada foi alterado.");
        return;
      }
    }

    const result = importMissing(fromStore, sourceSessions, toStore, { targetSessions });
    console.log("");
    console.log(DIVIDER);
    console.log(`  ${em("Copiadas:")} ${ok(String(result.written.length))}   ${em("Ignoradas:")} ${muted(String(result.skipped.length))}   ${em("Erros:")} ${result.errors.length ? pc.red(String(result.errors.length)) : "0"}`);
    console.log(DIVIDER);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  ${pc.red("!")} ${err.session.sessionId.slice(0, 8)} ${muted("—")} ${truncateMiddle(err.error, 56)}`);
    }
    console.log("");
    console.log(`  ${muted("Reabre o CLI com o perfil")} ${em(toStore.profile)} ${muted("para veres as sessões.")}`);
    console.log("");
    p.outro(ok("Import concluído."));
    return;
  }

  // ── Inventory / reconcile mode (read-only) ──
  if (jsonOut) {
    const result = index.reconciliations[0] || null;
    console.log(JSON.stringify({
      ok: true,
      stores: collapseSharedStores(index).map((entry) => ({
        profile: entry.store.profile,
        label: entry.store.label,
        dir: entry.store.dir,
        shared: Boolean(entry.store.shared),
        sessions: entry.sessions.length,
        withTurns: entry.sessions.filter((session) => session.turns > 0).length,
        ...(entry.store.shared
          ? {
            byProvider: entry.sessions.reduce((acc, session) => {
              acc[session.profile] = (acc[session.profile] || 0) + 1;
              return acc;
            }, {}),
          }
          : {}),
      })),
      reconciliation: result
        ? {
          a: result.storeA.profile,
          b: result.storeB.profile,
          totalA: result.totalA,
          totalB: result.totalB,
          onlyA: result.onlyA.map((s) => ({ sessionId: s.sessionId, title: s.title, cwd: s.cwd, turns: s.turns, updatedAt: s.updatedAt })),
          onlyB: result.onlyB.map((s) => ({ sessionId: s.sessionId, title: s.title, cwd: s.cwd, turns: s.turns, updatedAt: s.updatedAt })),
          both: result.both.map((item) => ({ sessionId: item.sessionId, title: item.a.title, cwd: item.a.cwd })),
          ambiguous: result.ambiguous.map((item) => ({ sessionId: item.sessionId, cwdA: item.a.cwd, cwdB: item.b.cwd })),
        }
        : null,
    }, null, 2));
    return;
  }

  console.log(renderBanner("Chat", "Reconcile conversations across Piramyd profiles"));
  p.intro(pc.bgYellow(pc.black(" Piramyd Chat ")));
  showChatInventory(index);

  for (const result of index.reconciliations) {
    showChatReconciliation(result);
    showChatAmbiguous(result);
  }

  const codexAll = (index.inventory.find((entry) => entry.store.profile === "codex") || {}).sessions || [];
  if (codexAll.length) {
    console.log(pc.yellow(`  ⚠ Codex e Codex-Piramyd partilham ${muted("~/.codex/sessions")} — não há dois destinos, por isso não há import entre eles.`));
    console.log(`  ${muted("O inventário acima mostra os dois perfis; a distinção vive no campo model_provider de cada rollout.")}`);
    console.log("");
  }

  if (!index.reconciliations.length) {
    p.outro(muted("Só foi encontrado um perfil Claude — nada para conciliar."));
    return;
  }
  p.outro(ok("Inventário concluído. Nada foi alterado."));
}

module.exports = { runChat };
