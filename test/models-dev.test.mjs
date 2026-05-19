import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchModelsDevData,
  getModelsDevIndex,
  clearModelsDevCache,
} from '../dist/src/models-dev.js';

const ORIGINAL_FETCH = global.fetch;
const MOCK_URL = 'http://localhost:99999/models-dev.json';

afterEach(() => {
  clearModelsDevCache();
  global.fetch = ORIGINAL_FETCH;
});

// Helper to create an AbortError for simulating timeout
function createAbortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

// Helper to create a valid models.dev response
function createValidModelsDevResponse() {
  return {
    openai: {
      id: 'openai',
      models: {
        'gpt-4o': {
          id: 'gpt-4o',
          name: 'GPT-4o',
        },
      },
    },
  };
}

// Base config for models.dev tests
function createConfig(modelsDevOverrides = {}) {
  return {
    baseUrl: 'http://localhost:20128/v1',
    apiKey: 'test-key',
    apiMode: 'chat',
    modelsDev: {
      url: MOCK_URL,
      cacheTtl: 60000,
      timeoutMs: 5000,
      ...modelsDevOverrides,
    },
  };
}

test('fresh cache hit - no second network call', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      return new Response(JSON.stringify(createValidModelsDevResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const first = await fetchModelsDevData(config);
  const second = await fetchModelsDevData(config);

  assert.equal(calls, 1, 'Should only make one network call');
  assert.ok(first, 'First fetch should return data');
  assert.deepStrictEqual(first, second, 'Should return cached data on second call');
});

test('timeout then success - retries and returns data', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      if (calls === 1) {
        throw createAbortError();
      }
      return new Response(JSON.stringify(createValidModelsDevResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const result = await fetchModelsDevData(config);
  assert.ok(result, 'Should return data after retry');
  assert.equal(calls, 2, 'Should make exactly 2 attempts');
});

test('retryable HTTP failure then success - retries 503', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(createValidModelsDevResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const result = await fetchModelsDevData(config);
  assert.ok(result, 'Should return data after retry');
  assert.equal(calls, 2, 'Should make exactly 2 attempts');
});

test('all attempts fail with stale cache available - returns stale data', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      if (calls === 1) {
        // Seed cache on first call
        return new Response(JSON.stringify(createValidModelsDevResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // All subsequent calls fail
      throw new Error('Network error');
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig({ cacheTtl: 0 }); // 0ms TTL — cache is immediately stale

  // Seed cache
  const first = await fetchModelsDevData(config);
  assert.ok(first, 'First fetch should succeed');
  assert.equal(calls, 1, 'Should make 1 call to seed cache');

  // All refresh attempts fail, should return stale cache
  const second = await fetchModelsDevData(config);
  assert.ok(second, 'Should return stale cache');
  assert.deepStrictEqual(second, first, 'Should return same data as first fetch');
  assert.equal(calls, 4, 'Should make 1 + 3 attempts total');
});

test('all attempts fail with no cache - returns null', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      throw new Error('Network error');
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const result = await fetchModelsDevData(config);
  assert.equal(result, null, 'Should return null when all attempts fail');
  assert.equal(calls, 3, 'Should make exactly 3 attempts');
});

test('non-retryable HTTP failure - fail fast on 404', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const result = await fetchModelsDevData(config);
  assert.equal(result, null, 'Should return null on 404');
  assert.equal(calls, 1, 'Should only make 1 attempt for non-retryable errors');
});

test('invalid response structure with stale cache - returns stale data', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      if (calls === 1) {
        // Seed cache on first call
        return new Response(JSON.stringify(createValidModelsDevResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Return invalid structure (array instead of object)
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig({ cacheTtl: 0 }); // 0ms TTL — cache is immediately stale

  // Seed cache
  const first = await fetchModelsDevData(config);
  assert.ok(first, 'First fetch should succeed');
  assert.equal(calls, 1, 'Should make 1 call to seed cache');

  // Refresh returns invalid structure, should fall back to stale cache
  const second = await fetchModelsDevData(config);
  assert.ok(second, 'Should return stale cache');
  assert.deepStrictEqual(second, first, 'Should return same data as first fetch');
  assert.equal(calls, 2, 'Should make 1 + 1 attempts (invalid structure is non-retryable)');
});

test('invalid provider structure with no cache - returns null', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      return new Response(JSON.stringify({ openai: { id: 'openai', models: null } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const result = await fetchModelsDevData(config);
  assert.equal(result, null, 'Should return null for malformed provider entries');
  assert.equal(calls, 1, 'Should not retry structurally invalid responses');
});

// Integration test: verify getModelsDevIndex uses the improved fetch pipeline
test('getModelsDevIndex integrates with retry and cache', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === MOCK_URL) {
      calls++;
      if (calls === 1) {
        throw createAbortError();
      }
      return new Response(JSON.stringify(createValidModelsDevResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const config = createConfig();

  const index = await getModelsDevIndex(config);
  assert.ok(index, 'Should return index after retry');
  assert.ok(index.exactByProvider.has('openai'), 'Should have openai provider');
  assert.equal(calls, 2, 'Should retry via fetchModelsDevData');
});
