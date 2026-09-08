const {
  buildProbePayload,
  extractProbeText,
  normalizeProbeMessage,
  PROBE_PROMPT,
} = require('../src/model-probes');

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

  test('extractProbeText returns __empty_completed__ for completed empty Responses payload', () => {
    const result = extractProbeText({
      object: 'response',
      status: 'completed',
      output: [],
    });
    expect(result).toBe('__empty_completed__');
  });

  test('extractProbeText returns __reasoning_only__ for chat completions with reasoning_content', () => {
    const result = extractProbeText({
      choices: [
        { message: { content: '', reasoning_content: 'thinking...' } },
      ],
    });
    expect(result).toBe('__reasoning_only__');
  });

  test('normalizeProbeMessage maps OpenAI invalid_api_key without implying client key only', () => {
    const body = JSON.stringify({
      error: {
        message: 'Authentication error. Please verify your API key.',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
    const result = normalizeProbeMessage(body, 401);
    expect(result.reason).toBe('auth');
    expect(result.detail.toLowerCase()).toContain('authentication');
  });

  test('normalizeProbeMessage maps upstream_auth_error distinctly', () => {
    const body = JSON.stringify({
      error: {
        message: 'Upstream provider authentication failed. Your Piramyd API key was accepted; the platform provider key needs attention.',
        type: 'authentication_error',
        code: 'upstream_auth_error',
      },
    });
    const result = normalizeProbeMessage(body, 401);
    expect(result.reason).toBe('upstream_auth');
    expect(result.detail).toBe('upstream auth error');
  });

  test('normalizeProbeMessage maps FastAPI client key rejection', () => {
    const body = JSON.stringify({
      detail: 'API Key inválida ou inexistente. Assine a Piramyd AI para começar.',
    });
    const result = normalizeProbeMessage(body, 401);
    expect(result.reason).toBe('client_auth');
    expect(result.detail).toBe('client api key rejected');
  });

  test('normalizeProbeMessage maps 503 maintenance envelope', () => {
    const body = JSON.stringify({
      error: {
        message: 'Service under maintenance. Please try again in a few minutes.',
        type: 'service_unavailable',
        code: 503,
      },
    });
    const result = normalizeProbeMessage(body, 503);
    expect(result.reason).toBe('server_unavailable');
    expect(result.detail).toBe('server unavailable');
  });
});
