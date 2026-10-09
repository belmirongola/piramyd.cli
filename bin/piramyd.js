#!/usr/bin/env node
const p = require("@clack/prompts");
const { parseCliArgs } = require("../src/cli-args");
const { printHelp } = require("../src/help");
const { runOnboard, runNonInteractiveOnboard } = require("../src/commands/onboard");
const { runDoctor } = require("../src/commands/doctor");
const { runModels } = require("../src/commands/models");
const { runProber, runProberLive } = require("../src/commands/prober");
const { runChat } = require("../src/commands/chat");
const { runStatus, runRestore } = require("../src/commands/status");
const { runLogin, runLogout, runWhoami } = require("../src/commands/session");

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    process.exit(0);
  }

  const commands = {
    login: runLogin,
    logout: runLogout,
    whoami: runWhoami,
    doctor: runDoctor,
    models: runModels,
    prober: (c) => (c.live ? runProberLive(c) : runProber(c)),
    status: runStatus,
    restore: runRestore,
    chat: runChat,
  };
  if (commands[cli.command]) return commands[cli.command](cli);

  if (cli.yes) return runNonInteractiveOnboard(cli);
  return runOnboard(cli);
}

main().catch((err) => {
  if (err.message !== "cancelled") {
    p.log.error(err.message || String(err));
  }
  process.exit(1);
});
