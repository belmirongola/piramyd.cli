const { buildProbePayload, extractProbeText, PROBE_PROMPT } = require('../src/model-probes');

describe('model-probes', () => {
  test('buildProbePayload uses minimal OK prompt', () => {
    const payload = JSON.parse(buildProbePayload('gpt-4o'));

    expect(payload.model).toBe('gpt-4o');
    expect(payload.input).toBe(PROBE_PROMPT);
    expect(payload.max_output_tokens).toBe(150);
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

  test('extractProbeText returns __reasoning_only__ for Responses API incomplete with max_output_tokens', () => {
    const result = extractProbeText({
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    });
    expect(result).toBe('__reasoning_only__');
  });

  test('extractProbeText returns __reasoning_only__ for chat completions with reasoning_content', () => {
    const result = extractProbeText({
      choices: [
        { message: { content: '', reasoning_content: 'thinking...' } },
      ],
    });
    expect(result).toBe('__reasoning_only__');
  });
});
