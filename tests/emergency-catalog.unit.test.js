const {
  FALLBACK_DEFAULT_MODEL,
  buildEmergencyCatalog,
  uniqueModels,
  applyCatalogSelection,
  findModelById,
} = require('../src/emergency-catalog');

describe('emergency-catalog', () => {
  test('FALLBACK_DEFAULT_MODEL is claude-sonnet-4-6', () => {
    expect(FALLBACK_DEFAULT_MODEL).toBe('claude-sonnet-4-6');
  });

  test('buildEmergencyCatalog returns valid catalog', () => {
    const catalog = buildEmergencyCatalog();
    expect(catalog.sourceType).toBe('local-fallback');
    expect(catalog.models).toHaveLength(4);
    expect(catalog.models[0].id).toBe('claude-opus-4.6');
    expect(catalog.defaultModelId).toBe('claude-sonnet-4-6');
    expect(catalog.warning).toBeTruthy();
  });

  test('uniqueModels deduplicates by id', () => {
    const models = uniqueModels([
      { id: 'a', name: 'A' },
      { id: 'a', name: 'A-dup' },
      { id: 'b', name: 'B' },
    ]);
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('a');
    expect(models[1].id).toBe('b');
  });

  test('uniqueModels handles null/invalid entries', () => {
    const models = uniqueModels([null, undefined, 'string', { id: '' }, { id: 'valid' }]);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('valid');
  });

  test('uniqueModels returns empty for null input', () => {
    expect(uniqueModels(null)).toEqual([]);
    expect(uniqueModels(undefined)).toEqual([]);
  });

  test('applyCatalogSelection merges extra models and sets defaultModelId', () => {
    const catalog = { models: [{ id: 'a', name: 'A' }], tier: 'free' };
    const extra = [{ id: 'b', name: 'B' }];
    const result = applyCatalogSelection(catalog, 'b', extra);
    expect(result.models).toHaveLength(2);
    expect(result.defaultModelId).toBe('b');
    expect(result.tier).toBe('free');
  });

  test('applyCatalogSelection does not duplicate existing models', () => {
    const catalog = { models: [{ id: 'a', name: 'A' }] };
    const extra = [{ id: 'a', name: 'A2' }];
    const result = applyCatalogSelection(catalog, 'a', extra);
    expect(result.models).toHaveLength(1);
  });

  test('findModelById finds model case-insensitively', () => {
    const models = [{ id: 'GPT-4o' }, { id: 'claude-sonnet-4-6' }];
    expect(findModelById(models, 'gpt-4o').id).toBe('GPT-4o');
    expect(findModelById(models, 'GPT-4O').id).toBe('GPT-4o');
  });

  test('findModelById returns null for empty/missing id', () => {
    expect(findModelById([{ id: 'a' }], '')).toBeNull();
    expect(findModelById([{ id: 'a' }], null)).toBeNull();
    expect(findModelById([], 'a')).toBeNull();
  });
});
