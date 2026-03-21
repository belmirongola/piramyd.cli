const fs = require('fs');
const os = require('os');
const path = require('path');
const { targetBaseUrl, targetDefaultModel, writeConfig } = require('../src/patchers');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piramyd-patcher-test-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(read(filePath));
}

const TEST_API_KEY = 'sk-test-1234567890abcdef';

const TEST_CATALOG = {
  tier: 'free',
  models: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, input: ['text', 'image'], contextWindow: 1000000, maxTokens: 128000 },
    { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', reasoning: true, input: ['text', 'image'], contextWindow: 1000000, maxTokens: 128000 },
    { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, input: ['text', 'image'], contextWindow: 128000, maxTokens: 4096 },
  ],
  defaultModelId: 'claude-sonnet-4-6',
};

// ─── targetBaseUrl ───────────────────────────────────────────────

describe('targetBaseUrl', () => {
  test('claude returns Anthropic base URL', () => {
    expect(targetBaseUrl({ kind: 'claude' })).toBe('https://api.piramyd.cloud');
  });

  test.each(['codex', 'kimi', 'openclaw', 'gemini', 'qwen', 'opencode'])(
    '%s returns OpenAI base URL',
    (kind) => {
      expect(targetBaseUrl({ kind })).toBe('https://api.piramyd.cloud/v1');
    }
  );
});

// ─── targetDefaultModel ──────────────────────────────────────────

describe('targetDefaultModel', () => {
  const models = TEST_CATALOG.models;

  test('claude picks sonnet when available', () => {
    const result = targetDefaultModel({ kind: 'claude' }, models, 'free', 'claude-sonnet-4-6');
    expect(result).toBe('claude-sonnet-4-6');
  });

  test('openclaw prefixes model with piramyd/', () => {
    const result = targetDefaultModel({ kind: 'openclaw' }, models, 'free', 'gpt-4o');
    expect(result).toBe('piramyd/gpt-4o');
  });

  test('codex does NOT prefix model', () => {
    const result = targetDefaultModel({ kind: 'codex' }, models, 'free', 'claude-sonnet-4-6');
    expect(result).toBe('claude-sonnet-4-6');
  });

  test('kimi prefixes model with piramyd/', () => {
    const result = targetDefaultModel({ kind: 'kimi' }, models, 'free', 'gpt-4o');
    expect(result).toBe('piramyd/gpt-4o');
  });
});

// ─── OpenClaw patcher ────────────────────────────────────────────

describe('writeConfig — openclaw', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'openclaw', path: path.join(dir, '.openclaw', 'openclaw.json') };
    const result = writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    const config = readJson(target.path);
    expect(config.models.providers.piramyd.baseUrl).toBe('https://api.piramyd.cloud/v1');
    expect(config.models.providers.piramyd.apiKey).toBe(TEST_API_KEY);
    expect(config.agents.defaults.model.primary).toMatch(/^piramyd\//);
    expect(result.backups).toEqual([]);
  });

  test('preserves existing fields', () => {
    const dir = mkTmpDir();
    const target = { kind: 'openclaw', path: path.join(dir, 'openclaw.json') };
    write(target.path, JSON.stringify({ customField: 'keep-me', models: { extra: true } }, null, 2));

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const config = readJson(target.path);
    expect(config.customField).toBe('keep-me');
    expect(config.models.extra).toBe(true);
    expect(config.models.providers.piramyd.apiKey).toBe(TEST_API_KEY);
  });

  test('idempotency — second write produces identical output', () => {
    const dir = mkTmpDir();
    const target = { kind: 'openclaw', path: path.join(dir, 'openclaw.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    // Remove meta.lastTouchedAt which changes
    const normalize = (s) => s.replace(/"lastTouchedAt":\s*"[^"]*"/g, '"lastTouchedAt":"X"');
    expect(normalize(second)).toBe(normalize(first));
  });
});

// ─── Claude patcher ──────────────────────────────────────────────

describe('writeConfig — claude', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'claude', path: path.join(dir, '.claude', 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    const config = readJson(target.path);
    expect(config.env.ANTHROPIC_BASE_URL).toBe('https://api.piramyd.cloud');
    expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe(TEST_API_KEY);
  });

  test('preserves existing fields', () => {
    const dir = mkTmpDir();
    const target = { kind: 'claude', path: path.join(dir, 'settings.json') };
    write(target.path, JSON.stringify({ permissions: { allow: ['tool1'] }, env: { MY_VAR: 'hello' } }, null, 2));

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const config = readJson(target.path);
    expect(config.permissions.allow).toContain('tool1');
    expect(config.env.MY_VAR).toBe('hello');
    expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe(TEST_API_KEY);
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'claude', path: path.join(dir, 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });
});

// ─── Gemini patcher ──────────────────────────────────────────────

describe('writeConfig — gemini', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'gemini', path: path.join(dir, '.gemini', 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    const config = readJson(target.path);
    expect(config.security.auth.apiKey).toBe(TEST_API_KEY);
    expect(config.security.auth.selectedType).toBe('gemini-api-key');
    expect(config.security.gatewayUrl).toBe('https://api.piramyd.cloud/v1');
  });

  test('preserves existing fields', () => {
    const dir = mkTmpDir();
    const target = { kind: 'gemini', path: path.join(dir, 'settings.json') };
    write(target.path, JSON.stringify({ theme: 'dark' }, null, 2));

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const config = readJson(target.path);
    expect(config.theme).toBe('dark');
    expect(config.security.auth.apiKey).toBe(TEST_API_KEY);
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'gemini', path: path.join(dir, 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });
});

// ─── Qwen patcher ────────────────────────────────────────────────

describe('writeConfig — qwen', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'qwen', path: path.join(dir, '.qwen', 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    const config = readJson(target.path);
    expect(config.security.auth.apiKey).toBe(TEST_API_KEY);
    expect(config.security.gatewayUrl).toBe('https://api.piramyd.cloud/v1');
    expect(config.model.provider).toBe('piramyd');
    expect(config.model.name).toBeTruthy();
  });

  test('preserves existing fields', () => {
    const dir = mkTmpDir();
    const target = { kind: 'qwen', path: path.join(dir, 'settings.json') };
    write(target.path, JSON.stringify({ theme: 'light', extra: 42 }, null, 2));

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const config = readJson(target.path);
    expect(config.theme).toBe('light');
    expect(config.extra).toBe(42);
    expect(config.security.auth.apiKey).toBe(TEST_API_KEY);
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'qwen', path: path.join(dir, 'settings.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });
});

// ─── OpenCode patcher ────────────────────────────────────────────

describe('writeConfig — opencode', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'opencode', path: path.join(dir, '.opencode', 'config.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    const config = readJson(target.path);
    expect(config.providers.piramyd.apiKey).toBe(TEST_API_KEY);
    expect(config.providers.piramyd.baseUrl).toBe('https://api.piramyd.cloud/v1');
    expect(config.providers.piramyd.type).toBe('openai');
    expect(config.defaultProvider).toBe('piramyd');
  });

  test('preserves existing fields', () => {
    const dir = mkTmpDir();
    const target = { kind: 'opencode', path: path.join(dir, 'config.json') };
    write(target.path, JSON.stringify({ providers: { other: { key: 'value' } } }, null, 2));

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const config = readJson(target.path);
    expect(config.providers.other.key).toBe('value');
    expect(config.providers.piramyd.apiKey).toBe(TEST_API_KEY);
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'opencode', path: path.join(dir, 'config.json') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });
});

// ─── Kimi patcher (TOML) ─────────────────────────────────────────

describe('writeConfig — kimi', () => {
  test('creates config from existing empty file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'kimi', path: path.join(dir, '.kimi', 'config.toml') };
    write(target.path, '');

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const content = read(target.path);
    expect(content).toContain('[providers.piramyd]');
    expect(content).toContain('# >>> piramyd-onboard:start');
    expect(content).toContain('# <<< piramyd-onboard:end');
    expect(content).toContain(TEST_API_KEY);
    expect(content).toContain('default_model');
  });

  test('preserves user sections', () => {
    const dir = mkTmpDir();
    const target = { kind: 'kimi', path: path.join(dir, 'config.toml') };
    const existing = [
      'default_model = "old-model"',
      '',
      '[providers.custom]',
      'type = "openai"',
      'base_url = "https://custom.example.com"',
      '',
      '[models."custom/my-model"]',
      'provider = "custom"',
      'model = "my-model"',
    ].join('\n');
    write(target.path, existing);

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const content = read(target.path);
    // User sections survive
    expect(content).toContain('[providers.custom]');
    expect(content).toContain('base_url = "https://custom.example.com"');
    expect(content).toContain('[models."custom/my-model"]');
    // Piramyd sections present
    expect(content).toContain('[providers.piramyd]');
    // default_model was updated (not the old value)
    expect(content).not.toContain('"old-model"');
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'kimi', path: path.join(dir, 'config.toml') };
    write(target.path, 'default_model = "x"\n');

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });
});

// ─── Codex patcher (TOML + artifacts) ────────────────────────────

describe('writeConfig — codex', () => {
  test('creates config from missing file', () => {
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, '.codex', 'config.toml') };

    const result = writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const content = read(target.path);

    expect(content).toContain('[profiles.piramyd]');
    expect(content).toContain('[model_providers.piramyd]');
    expect(content).toContain('# >>> piramyd-onboard:start');
    expect(content).toContain('# <<< piramyd-onboard:end');
    expect(content).toContain('base_url = "https://api.piramyd.cloud/v1"');
    expect(content).toContain('wire_api = "responses"');
    expect(result.artifacts.length).toBe(2);
  });

  test('preserves user sections', () => {
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, 'config.toml') };
    const existing = [
      '[profiles.default]',
      'model_provider = "openai"',
      'model = "gpt-4o"',
    ].join('\n');
    write(target.path, existing);

    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const content = read(target.path);
    expect(content).toContain('[profiles.default]');
    expect(content).toContain('model_provider = "openai"');
    expect(content).toContain('[profiles.piramyd]');
  });

  test('idempotency', () => {
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, 'config.toml') };
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const first = read(target.path);
    writeConfig(target, TEST_API_KEY, TEST_CATALOG);
    const second = read(target.path);
    expect(second).toBe(first);
  });

  test('creates secret env file and launcher', () => {
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, 'config.toml') };
    const result = writeConfig(target, TEST_API_KEY, TEST_CATALOG);

    // Secret file exists and contains the API key
    const secretPath = result.artifacts.find((a) => a.includes('piramyd.env'));
    expect(secretPath).toBeTruthy();
    const secret = read(secretPath);
    expect(secret).toContain(TEST_API_KEY);
    expect(secret).toContain('OPENAI_API_KEY=');

    // Launcher exists and contains the profile
    const launcherPath = result.artifacts.find((a) => a.includes('codex-piramyd'));
    expect(launcherPath).toBeTruthy();
    const launcher = read(launcherPath);
    expect(launcher).toContain('-p piramyd');
    expect(launcher).toContain('https://api.piramyd.cloud/v1');
  });
});
