const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { writeConfig } = require('../src/patchers');
const { sanitizeCatalog } = require('../src/catalog');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piramyd-toolkit-test-'));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function testOpenClawCreateFromMissing() {
  const dir = mkTmpDir();
  const target = { kind: 'openclaw', path: path.join(dir, '.openclaw', 'openclaw.json') };
  const catalog = {
    tier: 'free',
    models: [
      { id: 'gpt-test', name: 'GPT Test', reasoning: false, input: ['text'], contextWindow: 8192, maxTokens: 1024 },
    ],
    defaultModelId: 'gpt-test',
  };

  writeConfig(target, 'sk-test-1234567890', catalog);
  const parsed = JSON.parse(fs.readFileSync(target.path, 'utf8'));

  assert.strictEqual(parsed.models.providers.piramyd.baseUrl, 'https://api.piramyd.cloud/v1');
  assert.strictEqual(parsed.models.providers.piramyd.apiKey, 'sk-test-1234567890');
  assert.strictEqual(parsed.agents.defaults.model.primary, 'piramyd/gpt-test');
}

function testClaudeInvalidJsonThrowsFriendlyError() {
  const dir = mkTmpDir();
  const target = { kind: 'claude', path: path.join(dir, '.claude', 'settings.json') };
  write(target.path, '{invalid json');

  const catalog = {
    tier: 'free',
    models: [{ id: 'claude-sonnet-test', name: 'Claude Sonnet', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 4096 }],
    defaultModelId: 'claude-sonnet-test',
  };

  let failed = false;
  try {
    writeConfig(target, 'sk-test-1234567890', catalog);
  } catch (err) {
    failed = true;
    assert.match(String(err.message), /Invalid JSON in Claude Code config/);
  }

  assert.strictEqual(failed, true, 'Expected friendly JSON parse failure for Claude config');
}

function run() {
  testOpenClawCreateFromMissing();
  testClaudeInvalidJsonThrowsFriendlyError();
  testCatalogSanitizeFromModelsFallback();
  testAggregateErrorFriendlyFormatting();
  testFallbackModelIdConstant();
  console.log('smoke-write-config: ok');
}

function testCatalogSanitizeFromModelsFallback() {
  const sanitized = sanitizeCatalog([
    { id: 'model-a', name: 'Model A', type: 'model', input: ['text'], context_length: 1000, max_output_tokens: 200 },
    { id: 'img-model', name: 'Image Model', type: 'image' },
  ]);

  assert.strictEqual(Array.isArray(sanitized), true);
  assert.strictEqual(sanitized.length, 1);
  assert.strictEqual(sanitized[0].id, 'model-a');
}

function testAggregateErrorFriendlyFormatting() {
  const aggregate = new AggregateError([
    new Error('connect ECONNREFUSED 2606:4700::'),
    new Error('connect ECONNREFUSED 104.26.10.78:443'),
  ], 'All promises were rejected');

  const messages = [];
  if (aggregate.message) messages.push(String(aggregate.message));
  if (Array.isArray(aggregate.errors)) {
    for (const inner of aggregate.errors) {
      if (inner?.message) messages.push(String(inner.message));
    }
  }

  assert.strictEqual(messages.length >= 2, true);
  assert.strictEqual(messages.some((m) => m.includes('ECONNREFUSED')), true);
}

function testFallbackModelIdConstant() {
  const emergencySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'emergency-catalog.js'), 'utf8');
  assert.strictEqual(emergencySource.includes('FALLBACK_DEFAULT_MODEL = "claude-sonnet-4-6"'), true);
}

run();
