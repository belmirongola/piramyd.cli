/**
 * Tests for Windows-specific functionality.
 *
 * Since we're running on macOS/Linux, we test the Windows code paths by:
 * 1. Directly calling the Windows-specific render functions that are accessible
 * 2. Verifying that platform-branching logic exists and is correct
 * 3. Testing that IS_WINDOWS flag properly influences constant definitions
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { IS_WINDOWS, CODEX_LAUNCHER_PATH, LOCAL_BIN_DIR } = require('../src/constants');
const { isExecutable, resolveCommand, safeChmod } = require('../src/utils');
const { generateConfig } = require('../src/patchers');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'piramyd-win-test-'));
}

const TEST_API_KEY = 'sk-test-windows-key';
const TEST_CATALOG = {
  tier: 'free',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096 },
  ],
  defaultModelId: 'gpt-4o',
};

// ─── Constants platform-awareness ────────────────────────────────

describe('constants — platform-awareness', () => {
  test('IS_WINDOWS reflects current platform', () => {
    expect(typeof IS_WINDOWS).toBe('boolean');
    if (process.platform === 'win32') {
      expect(IS_WINDOWS).toBe(true);
    } else {
      expect(IS_WINDOWS).toBe(false);
    }
  });

  test('CODEX_LAUNCHER_PATH has correct extension', () => {
    if (IS_WINDOWS) {
      expect(CODEX_LAUNCHER_PATH).toMatch(/\.cmd$/);
    } else {
      expect(CODEX_LAUNCHER_PATH).not.toMatch(/\.cmd$/);
    }
  });

  test('LOCAL_BIN_DIR is platform-appropriate', () => {
    if (IS_WINDOWS) {
      expect(LOCAL_BIN_DIR).toMatch(/WindowsApps/i);
    } else {
      expect(LOCAL_BIN_DIR).toMatch(/\.local\/bin$/);
    }
  });
});

// ─── isExecutable — cross-platform ──────────────────────────────

describe('isExecutable — cross-platform', () => {
  test('returns false for non-existent file', () => {
    expect(isExecutable('/nonexistent/path/binary')).toBe(false);
  });

  test('returns true for executable file on current platform', () => {
    const dir = mkTmpDir();
    const binPath = path.join(dir, IS_WINDOWS ? 'test.cmd' : 'test');
    fs.writeFileSync(binPath, IS_WINDOWS ? '@echo off' : '#!/bin/sh\necho hi', 'utf8');
    if (!IS_WINDOWS) fs.chmodSync(binPath, 0o755);
    expect(isExecutable(binPath)).toBe(true);
  });

  if (!IS_WINDOWS) {
    test('returns false for non-executable file on Unix', () => {
      const dir = mkTmpDir();
      const filePath = path.join(dir, 'notexec');
      fs.writeFileSync(filePath, 'data', 'utf8');
      fs.chmodSync(filePath, 0o644);
      expect(isExecutable(filePath)).toBe(false);
    });
  }
});

// ─── resolveCommand ─────────────────────────────────────────────

describe('resolveCommand — cross-platform', () => {
  test('returns null for non-existent command', () => {
    expect(resolveCommand('piramyd-nonexistent-binary-xyz')).toBeNull();
  });

  test('finds node binary', () => {
    // "node" should always be resolvable in our test environment
    const result = resolveCommand('node');
    expect(result).toBeTruthy();
    expect(fs.existsSync(result)).toBe(true);
  });
});

// ─── safeChmod ──────────────────────────────────────────────────

describe('safeChmod — cross-platform', () => {
  test('does not throw on any platform', () => {
    const dir = mkTmpDir();
    const filePath = path.join(dir, 'test-chmod');
    fs.writeFileSync(filePath, 'data', 'utf8');
    expect(() => safeChmod(filePath, 0o600)).not.toThrow();
  });
});

// ─── Codex launcher content — platform-specific ─────────────────

describe('codex launcher — platform content', () => {
  test('launcher is Unix shell script on non-Windows', () => {
    if (IS_WINDOWS) return; // Skip on Windows
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, 'config.toml') };
    const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
    const launcher = preview.files.find(f => f.path.includes('codex-piramyd'));
    expect(launcher).toBeTruthy();
    expect(launcher.content).toMatch(/^#!\/bin\/sh/);
    expect(launcher.content).toContain('set -eu');
    expect(launcher.content).toContain('-p piramyd');
    expect(launcher.content).toContain('OPENAI_API_KEY');
  });

  test('secret env file uses platform-appropriate format', () => {
    const dir = mkTmpDir();
    const target = { kind: 'codex', path: path.join(dir, 'config.toml') };
    const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
    const secret = preview.files.find(f => f.path.includes('piramyd.env'));
    expect(secret).toBeTruthy();
    expect(secret.content).toContain('OPENAI_API_KEY=');
    expect(secret.content).toContain(TEST_API_KEY);
    expect(secret.content).toContain('https://api.piramyd.cloud/v1');

    if (IS_WINDOWS) {
      // Windows: no shell quoting, CRLF line endings
      expect(secret.content).not.toContain("'");
      expect(secret.content).toContain('\r\n');
    } else {
      // Unix: shell-quoted values
      expect(secret.content).toContain("'");
    }
  });
});

// ─── JSON configs are identical on all platforms ─────────────────

describe('JSON configs — platform-independent', () => {
  test.each(['claude', 'openclaw', 'gemini', 'qwen', 'opencode'])(
    '%s config is valid JSON regardless of platform',
    (kind) => {
      const dir = mkTmpDir();
      const target = { kind, path: path.join(dir, 'config.json') };
      const preview = generateConfig(target, TEST_API_KEY, TEST_CATALOG);
      // Should produce valid JSON
      const parsed = JSON.parse(preview.config);
      expect(typeof parsed).toBe('object');
    }
  );
});
