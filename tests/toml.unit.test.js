const { parseTomlSections, upsertTopLevelSetting } = require('../src/toml');

describe('toml helpers', () => {
  test('parseTomlSections splits preamble and sections', () => {
    const raw = [
      'default_model = "a"',
      '',
      '[providers.piramyd]',
      'type = "openai"',
      '',
      '[models."x"]',
      'provider = "piramyd"',
    ].join('\n');

    const out = parseTomlSections(raw);
    expect(out.preamble.length).toBeGreaterThan(0);
    expect(out.sections.length).toBe(2);
    expect(out.sections[0].header).toBe('providers.piramyd');
  });

  test('upsertTopLevelSetting updates existing key', () => {
    const lines = ['a = 1', 'b = 2'];
    const out = upsertTopLevelSetting(lines, 'b', '3');
    expect(out).toContain('b = 3');
  });
});
