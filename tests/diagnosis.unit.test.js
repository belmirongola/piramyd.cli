const fs = require('fs');
const os = require('os');
const path = require('path');
const { getExistingApiKey, findReusableApiKey } = require('../src/diagnosis');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piramyd-diag-test-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('diagnosis — getExistingApiKey', () => {
  test('reads claude API key from JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'settings.json');
    write(configPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-claude-key-123' } }));

    const key = getExistingApiKey({ kind: 'claude', path: configPath });
    expect(key).toBe('sk-claude-key-123');
  });

  test('reads openclaw API key from JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'openclaw.json');
    write(configPath, JSON.stringify({ models: { providers: { piramyd: { apiKey: 'sk-oc-key' } } } }));

    const key = getExistingApiKey({ kind: 'openclaw', path: configPath });
    expect(key).toBe('sk-oc-key');
  });

  test('reads gemini API key from JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'settings.json');
    write(configPath, JSON.stringify({ security: { auth: { apiKey: 'sk-gemini-key' } } }));

    const key = getExistingApiKey({ kind: 'gemini', path: configPath });
    expect(key).toBe('sk-gemini-key');
  });

  test('reads qwen API key from JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'settings.json');
    write(configPath, JSON.stringify({ security: { auth: { apiKey: 'sk-qwen-key' } } }));

    const key = getExistingApiKey({ kind: 'qwen', path: configPath });
    expect(key).toBe('sk-qwen-key');
  });

  test('reads opencode API key from JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'config.json');
    write(configPath, JSON.stringify({ providers: { piramyd: { apiKey: 'sk-oc-key' } } }));

    const key = getExistingApiKey({ kind: 'opencode', path: configPath });
    expect(key).toBe('sk-oc-key');
  });

  test('reads kimi API key from TOML', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'config.toml');
    const toml = [
      '[providers.piramyd]',
      'type = "openai_legacy"',
      'api_key = "sk-kimi-key-456"',
    ].join('\n');
    write(configPath, toml);

    const key = getExistingApiKey({ kind: 'kimi', path: configPath });
    expect(key).toBe('sk-kimi-key-456');
  });

  test('returns empty for missing file', () => {
    const key = getExistingApiKey({ kind: 'claude', path: '/nonexistent/path.json' });
    expect(key).toBe('');
  });

  test('returns empty for invalid JSON', () => {
    const dir = mkTmpDir();
    const configPath = path.join(dir, 'settings.json');
    write(configPath, '{invalid');

    const key = getExistingApiKey({ kind: 'claude', path: configPath });
    expect(key).toBe('');
  });
});

describe('diagnosis — findReusableApiKey', () => {
  test('finds sk- key from selected target first', () => {
    const dir = mkTmpDir();
    const p1 = path.join(dir, 'a.json');
    const p2 = path.join(dir, 'b.json');
    write(p1, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-first' } }));
    write(p2, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-second' } }));

    const targets = [
      { kind: 'claude', path: p1 },
      { kind: 'claude', path: p2 },
    ];
    const key = findReusableApiKey(targets, targets[0]);
    expect(key).toBe('sk-first');
  });

  test('returns empty when no sk- key exists', () => {
    const dir = mkTmpDir();
    const p1 = path.join(dir, 'a.json');
    write(p1, JSON.stringify({ env: {} }));

    const targets = [{ kind: 'claude', path: p1 }];
    const key = findReusableApiKey(targets, targets[0]);
    expect(key).toBe('');
  });
});
