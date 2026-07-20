import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { clearComboCache, fetchComboData } from '../dist/runtime.js';

const ORIGINAL_FETCH = global.fetch;

function config(baseUrl, apiKey) {
  return {
    baseUrl,
    apiKey,
    apiMode: 'chat',
    modelCacheTtl: 60_000,
  };
}

afterEach(() => {
  clearComboCache();
  global.fetch = ORIGINAL_FETCH;
});

test('combo cache is isolated by endpoint and API key', async () => {
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    const authorization = new Headers(init.headers).get('authorization');
    calls.push({ url, authorization });
    const suffix = url.includes('a.example') && authorization === 'Bearer key-a' ? 'a' : 'b';
    return new Response(JSON.stringify({
      combos: [{
        id: `combo-${suffix}`,
        name: `combo-${suffix}`,
        models: [`provider/model-${suffix}`],
        strategy: 'priority',
        config: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const a = await fetchComboData(config('https://a.example/v1', 'key-a'));
  const b = await fetchComboData(config('https://b.example/v1', 'key-b'));
  const aAgain = await fetchComboData(config('https://a.example/v1', 'key-a'));

  assert.deepEqual([...a.keys()], ['combo-a']);
  assert.deepEqual([...b.keys()], ['combo-b']);
  assert.deepEqual([...aAgain.keys()], ['combo-a']);
  assert.equal(calls.length, 2, 'each cache identity should fetch once');
});

test('combo cache is isolated when credentials change for the same endpoint', async () => {
  let calls = 0;
  global.fetch = async (_input, init = {}) => {
    calls += 1;
    const authorization = new Headers(init.headers).get('authorization');
    const suffix = authorization === 'Bearer key-a' ? 'a' : 'b';
    return new Response(JSON.stringify({
      combos: [{
        id: `combo-${suffix}`,
        name: `combo-${suffix}`,
        models: [],
        strategy: 'priority',
        config: {},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const first = await fetchComboData(config('https://same.example/v1', 'key-a'));
  const second = await fetchComboData(config('https://same.example/v1', 'key-b'));

  assert.deepEqual([...first.keys()], ['combo-a']);
  assert.deepEqual([...second.keys()], ['combo-b']);
  assert.equal(calls, 2);
});


test('fetchComboData returns null when endpoint or credential is missing', async () => {
  global.fetch = async () => {
    throw new Error('fetch must not be called');
  };

  assert.equal(await fetchComboData(config('', 'key-a')), null);
  assert.equal(await fetchComboData(config('https://a.example/v1', '')), null);
});
