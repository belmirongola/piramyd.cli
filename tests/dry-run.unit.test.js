const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateConfig, writeConfig } = require('../src/patchers');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piramyd-dryrun-test-'));
}

const TEST_API_KEY = 'sk-test-dryrun-key';
const TEST_CATALOG = {
  tier: 'free',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 },
  ],
  defaultModelId: 'gpt-4o',
};

describe('generateConfig (dry-run preview)', () => {
  test.each(['openclaw', 'claude', 'gemini', 'qwen', 'opencode'])(
    '%s — returns config string without writing files',
    (kind) => {
      const dir = mkTmpDir();
      const filePath = path.join(dir, `config-${kind}.json`);
      const target = { kind, path: filePath };

      const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
      expect(typeof preview.config).toBe('string');
      expect(preview.config.length).toBeGreaterThan(10);
      expect(preview.files.length).toBeGreaterThanOrEqual(1);
      expect(preview.files[0].path).toBe(filePath);
      // File should NOT exist (preview only)
      expect(fs.existsSync(filePath)).toBe(false);
    }
  );

  test('kimi — returns TOML preview without writing', () => {
    const dir = mkTmpDir();
    const filePath = path.join(dir, 'config.toml');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'default_model = "x"\n', 'utf8');

    const target = { kind: 'kimi', path: filePath };
    const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
    expect(preview.config).toContain('[providers.piramyd]');
    expect(preview.config).toContain(TEST_API_KEY);
  });

  test('codex — returns config + 2 extra files (env, launcher)', () => {
    const dir = mkTmpDir();
    const filePath = path.join(dir, 'config.toml');
    const target = { kind: 'codex', path: filePath };

    const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
    expect(preview.files.length).toBe(3); // config + env + launcher
    expect(preview.files[1].content).toContain('OPENAI_API_KEY=');
    expect(preview.files[2].content).toContain('codex');
  });
});

describe('writeConfig with dryRun option', () => {
  test('dryRun: true returns preview without writing file', () => {
    const dir = mkTmpDir();
    const filePath = path.join(dir, 'settings.json');
    const target = { kind: 'gemini', path: filePath };

    const result = writeConfig(target, TEST_API_KEY, TEST_CATALOG, { dryRun: true });
    expect(result.preview).toBeTruthy();
    expect(result.preview.config).toContain(TEST_API_KEY);
    expect(result.backups).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('dryRun: false (default) writes the file', () => {
    const dir = mkTmpDir();
    const filePath = path.join(dir, '.gemini', 'settings.json');
    const target = { kind: 'gemini', path: filePath };

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    expect(fs.existsSync(filePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(content.security.auth.apiKey).toBe(TEST_API_KEY);
  });
});
