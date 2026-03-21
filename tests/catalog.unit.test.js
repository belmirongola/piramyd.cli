const { normalizeCatalogEntry, sanitizeCatalog } = require('../src/catalog');

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
});
