const { normalizeCatalogEntry, sanitizeCatalog, modelHasVision, visionIcon, VISION_ICON } = require('../src/catalog');

describe('catalog normalize/sanitize', () => {
  test('normalizeCatalogEntry keeps text model', () => {
    const model = normalizeCatalogEntry({
      id: 'gpt-test',
      name: 'GPT Test',
      type: 'model',
      input: ['text'],
      context_length: 12000,
      max_output_tokens: 2048,
    });

    expect(model).toBeTruthy();
    expect(model.id).toBe('gpt-test');
    expect(model.input).toEqual(['text']);
  });

  test('normalizeCatalogEntry filters image generation model', () => {
    const model = normalizeCatalogEntry({
      id: 'img-gen',
      type: 'image',
      input: ['text'],
    });

    expect(model).toBeNull();
  });

  test('normalizeCatalogEntry filters embeddings, speech and System One models', () => {
    const base = { type: 'chat', input: ['text'] };
    expect(normalizeCatalogEntry({ ...base, id: 'bge-m3', architecture: 'embeddings' })).toBeNull();
    expect(normalizeCatalogEntry({ ...base, id: 'jev-latest', architecture: 'systemone' })).toBeNull();
    expect(normalizeCatalogEntry({ ...base, id: 'whisper', endpoints: ['/v1/audio/transcriptions'] })).toBeNull();
    expect(normalizeCatalogEntry({ ...base, id: 'chat', architecture: 'completions', endpoint: '/v1/chat/completions' })).toBeTruthy();
  });

  test('normalizeCatalogEntry marks vision from capabilities', () => {
    const model = normalizeCatalogEntry({
      id: 'gpt-vision',
      type: 'model',
      capabilities: ['text', 'vision'],
    });

    expect(model).toBeTruthy();
    expect(model.hasVision).toBe(true);
    expect(model.input).toEqual(['text', 'image']);
  });

  test('normalizeCatalogEntry marks vision from image_in and multimodal', () => {
    const imageIn = normalizeCatalogEntry({
      id: 'img-in',
      type: 'model',
      capabilities: ['text', 'image_in'],
    });
    const multimodal = normalizeCatalogEntry({
      id: 'mm',
      type: 'model',
      capabilities: ['multimodal'],
      input: ['text'],
    });

    expect(imageIn.hasVision).toBe(true);
    expect(multimodal.hasVision).toBe(true);
  });

  test('normalizeCatalogEntry does not mark text-only models as vision', () => {
    const model = normalizeCatalogEntry({
      id: 'text-only',
      type: 'model',
      input: ['text'],
      capabilities: ['text', 'tool-calling'],
    });

    expect(model.hasVision).toBe(false);
    expect(model.input).toEqual(['text']);
  });

  test('sanitizeCatalog removes duplicates and invalid entries', () => {
    const list = sanitizeCatalog([
      { id: 'a', type: 'model', input: ['text'] },
      { id: 'a', type: 'model', input: ['text'] },
      { id: '', type: 'model', input: ['text'] },
      { id: 'img', type: 'image', input: ['text'] },
    ]);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
  });

  test('modelHasVision and visionIcon follow hasVision / input', () => {
    expect(modelHasVision({ id: 'a', hasVision: true })).toBe(true);
    expect(modelHasVision({ id: 'b', input: ['text', 'image'] })).toBe(true);
    expect(modelHasVision({ id: 'c', input: ['text'] })).toBe(false);
    expect(visionIcon({ hasVision: true })).toBe(VISION_ICON);
    expect(visionIcon({ input: ['text'] })).toBe('');
  });
});

describe("fetchModels with a rejected key", () => {
  test("does not fall back to the public list on 401/403", async () => {
    const https = require("https");
    const { EventEmitter } = require("events");
    const spy = jest.spyOn(https, "get").mockImplementation((_url, _opts, cb) => {
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.destroy = () => {};
      setTimeout(() => {
        const res = new EventEmitter();
        res.statusCode = 401;
        cb(res);
        res.emit("data", '{"detail":"nope"}');
        res.emit("end");
      }, 0);
      return req;
    });
    try {
      const { fetchModels } = require("../src/catalog");
      await expect(fetchModels("sk-bogus")).rejects.toThrow(/rejected/);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
