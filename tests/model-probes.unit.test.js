const { buildProbePayload, extractProbeText, PROBE_PROMPT } = require('../src/model-probes');

describe('model-probes', () => {
  test('buildProbePayload uses minimal OK prompt', () => {
    const payload = JSON.parse(buildProbePayload('gpt-4o'));

    expect(payload.model).toBe('gpt-4o');
    expect(payload.input).toBe(PROBE_PROMPT);
    expect(payload.max_output_tokens).toBe(30);
  });

  test('extractProbeText reads Responses API output text', () => {
    const text = extractProbeText({
      output: [
        {
          content: [
            { type: 'output_text', text: 'OK' },
          ],
        },
      ],
    });

    expect(text).toBe('OK');
  });

  test('extractProbeText falls back to output_text shortcut', () => {
    expect(extractProbeText({ output_text: 'OK' })).toBe('OK');
  });
});
