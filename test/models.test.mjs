import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModelCache,
  fetchModels,
  getCachedModels,
  isCacheValid,
  refreshModels,
} from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;

const CONFIG = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'test-key',
  apiMode: 'chat',
  modelCacheTtl: 60000,
};

afterEach(() => {
  clearModelCache();
  global.fetch = ORIGINAL_FETCH;
});

// Helper to create a mock fetch that only counts /v1/models calls
// and returns valid empty responses for other endpoints (combos, models.dev)
function createMockFetch() {
  let modelCalls = 0;

  const mockFetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (url.includes('/v1/models')) {
      modelCalls += 1;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: `model-${modelCalls}`, name: `Model ${modelCalls}` }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Return empty valid responses for other endpoints (combos, models.dev)
    return new Response(
      JSON.stringify({ data: [] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  return { mockFetch, getCalls: () => modelCalls };
}

test('fetchModels caches successful responses', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  const first = await fetchModels(CONFIG, CONFIG.apiKey, false);
  const second = await fetchModels(CONFIG, CONFIG.apiKey, false);

  assert.equal(getCalls(), 1);
  assert.equal(first[0].id, 'model-1');
  assert.equal(second[0].id, 'model-1');
  assert.ok(getCachedModels(CONFIG, CONFIG.apiKey));
  assert.equal(isCacheValid(CONFIG, CONFIG.apiKey), true);
});

test('refreshModels forces refetch', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  await fetchModels(CONFIG, CONFIG.apiKey, false);
  const refreshed = await refreshModels(CONFIG, CONFIG.apiKey);

  assert.equal(getCalls(), 2);
  assert.equal(refreshed[0].id, 'model-2');
});

test('fetchModels falls back to defaults when response shape is invalid', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, true);
  assert.ok(models.length > 0);
  assert.ok(typeof models[0].id === 'string');
});
