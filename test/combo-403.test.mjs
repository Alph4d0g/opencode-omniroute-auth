import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearModelCache, fetchModels } from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;
const CONFIG = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'test-key',
  apiMode: 'chat',
};

afterEach(() => {
  clearModelCache();
  global.fetch = ORIGINAL_FETCH;
});

test('403 on /v1/combos does not break /v1/models model listing', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (url.includes('/v1/combos')) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
            { id: 'my-combo', name: 'My Combo' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  clearModelCache();
  const models = await fetchModels(CONFIG, CONFIG.apiKey, true);

  assert.equal(models.length, 2);
  assert.ok(models.find((m) => m.id === 'openai/gpt-4o'));
  assert.ok(models.find((m) => m.id === 'my-combo'));
  console.log('Models returned:', models.map((m) => ({ id: m.id, supportsTools: m.supportsTools })));
});
