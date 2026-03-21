const { parseTomlSections, upsertTopLevelSetting, trimBoundaryBlankLines } = require('../src/toml');

describe('toml round-trip', () => {
  test('parse → reconstruct produces equivalent output', () => {
    const original = [
      'default_model = "piramyd/gpt-4o"',
      'default_thinking = true',
      '',
      '[providers.custom]',
      'type = "openai"',
      'base_url = "https://example.com"',
      '',
      '[models."custom/test"]',
      'provider = "custom"',
      'model = "test"',
    ].join('\n');

    const { preamble, sections } = parseTomlSections(original);

    // Reconstruct
    const chunks = [];
    if (preamble.length) chunks.push(trimBoundaryBlankLines(preamble).join('\n'));
    if (sections.length) {
      chunks.push(
        sections
          .map((s) => trimBoundaryBlankLines(s.lines).join('\n'))
          .filter(Boolean)
          .join('\n\n')
      );
    }
    const reconstructed = chunks.filter(Boolean).join('\n\n') + '\n';

    // Both should have the same meaningful content
    expect(reconstructed).toContain('default_model = "piramyd/gpt-4o"');
    expect(reconstructed).toContain('[providers.custom]');
    expect(reconstructed).toContain('base_url = "https://example.com"');
    expect(reconstructed).toContain('[models."custom/test"]');
  });

  test('upsertTopLevelSetting inserts new key', () => {
    const lines = ['a = 1', ''];
    const result = upsertTopLevelSetting(lines, 'b', '"2"');
    expect(result).toContain('b = "2"');
    expect(result).toContain('a = 1');
  });

  test('upsertTopLevelSetting replaces existing key', () => {
    const lines = ['default_model = "old"', 'default_thinking = false'];
    const result = upsertTopLevelSetting(lines, 'default_model', '"new"');
    expect(result).toContain('default_model = "new"');
    expect(result).not.toContain('"old"');
  });

  test('upsertTopLevelSetting is idempotent', () => {
    const lines = ['a = 1', 'b = 2'];
    const first = upsertTopLevelSetting(lines, 'b', '3');
    const second = upsertTopLevelSetting(first, 'b', '3');
    expect(second).toEqual(first);
  });

  test('trimBoundaryBlankLines removes leading and trailing empty lines', () => {
    const lines = ['', '', 'content', '', ''];
    expect(trimBoundaryBlankLines(lines)).toEqual(['content']);
  });

  test('trimBoundaryBlankLines leaves content intact', () => {
    const lines = ['a = 1', '', 'b = 2'];
    expect(trimBoundaryBlankLines(lines)).toEqual(['a = 1', '', 'b = 2']);
  });

  test('parseTomlSections handles \r\n line endings', () => {
    const raw = 'key = "value"\r\n\r\n[section]\r\nfoo = "bar"\r\n';
    const { preamble, sections } = parseTomlSections(raw);
    expect(preamble[0]).toBe('key = "value"');
    expect(sections).toHaveLength(1);
    expect(sections[0].header).toBe('section');
  });

  test('parseTomlSections with empty input', () => {
    const { preamble, sections } = parseTomlSections('');
    expect(preamble).toEqual(['']);
    expect(sections).toEqual([]);
  });

  test('parseTomlSections with multiple sections, no preamble', () => {
    const raw = '[a]\nfoo = 1\n[b]\nbar = 2\n';
    const { preamble, sections } = parseTomlSections(raw);
    expect(preamble).toEqual([]);
    expect(sections).toHaveLength(2);
    expect(sections[0].header).toBe('a');
    expect(sections[1].header).toBe('b');
  });
});
