const fs = require("fs");
const os = require("os");
const path = require("path");
const { listBackupsForFile } = require("../src/utils");
const { resolveSelectedTargets } = require("../src/ops");

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "piramyd-ops-"));
}

describe("ops", () => {
  test("resolveSelectedTargets maps kinds to known targets", () => {
    const targets = resolveSelectedTargets(["codex", "claude"]);
    expect(targets.map((t) => t.kind)).toEqual(["codex", "claude"]);
  });

  test("resolveSelectedTargets rejects unknown kinds", () => {
    expect(() => resolveSelectedTargets(["nope"])).toThrow(/Unknown target/);
  });

  test("listBackupsForFile returns newest first", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "v1");
    fs.writeFileSync(`${file}.bak.100`, "old");
    fs.writeFileSync(`${file}.bak.200`, "new");
    const backups = listBackupsForFile(file);
    expect(backups.map((b) => path.basename(b.path))).toEqual([
      "settings.json.bak.200",
      "settings.json.bak.100",
    ]);
  });

  test("restoreTarget copies the latest backup", () => {
    const dir = mkTmpDir();
    const file = path.join(dir, "openclaw.json");
    fs.writeFileSync(file, "current");
    fs.writeFileSync(`${file}.bak.1`, "backup-one");
    fs.writeFileSync(`${file}.bak.9`, "backup-nine");

    const ops = require("../src/ops");
    const constants = require("../src/constants");
    const original = constants.KNOWN_TARGETS.find((t) => t.kind === "openclaw");
    const prevPath = original.path;
    original.path = file;
    try {
      const result = ops.restoreTarget("openclaw");
      expect(fs.readFileSync(file, "utf8")).toBe("backup-nine");
      expect(result.restoredTo).toBe(file);
    } finally {
      original.path = prevPath;
    }
  });
});
