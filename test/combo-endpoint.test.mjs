import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearComboCache, fetchComboData } from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;
const CONFIG = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'test-key',
  apiMode: 'chat',
};

afterEach(() => {
  clearComboCache();
  global.fetch = ORIGINAL_FETCH;
});

test('fetchComboData reads new /v1/combos proxy format', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    assert.ok(url.includes('/v1/combos'), `expected /v1/combos but got ${url}`);
    return new Response(
      JSON.stringify({
        object: 'list',
        data: [
          {
            name: 'k2p6',
            strategy: 'priority',
            models: [
              { kind: 'model', model: 'openai/gpt-4o', providerId: 'openai' },
              { kind: 'model', model: 'anthropic/claude-3-5-sonnet', providerId: 'anthropic' },
            ],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const combos = await fetchComboData(CONFIG);
  assert.ok(combos);
  assert.equal(combos.has('k2p6'), true);
  const combo = combos.get('k2p6');
  assert.deepEqual(combo.models, [
    { kind: 'model', model: 'openai/gpt-4o', providerId: 'openai' },
    { kind: 'model', model: 'anthropic/claude-3-5-sonnet', providerId: 'anthropic' },
  ]);
});

test('fetchComboData falls back to /api/combos on 404', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/combos')) {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }
    assert.ok(url.includes('/api/combos'), `expected /api/combos fallback but got ${url}`);
    return new Response(
      JSON.stringify({
        combos: [
          {
            name: 'legacy-combo',
            strategy: 'round-robin',
            models: ['openai/gpt-4o'],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const combos = await fetchComboData(CONFIG);
  assert.ok(combos);
  assert.equal(combos.has('legacy-combo'), true);
});

test('fetchComboData returns null on 403', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    assert.ok(url.includes('/v1/combos'));
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  };

  const combos = await fetchComboData(CONFIG);
  assert.equal(combos, null);
});
