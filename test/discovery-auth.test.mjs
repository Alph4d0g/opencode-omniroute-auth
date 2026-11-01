import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearModelCache,
  clearComboCache,
  fetchModels,
  fetchComboData,
  getCachedModels,
  isCacheValid,
} from '../dist/runtime.js';

const originalFetch = global.fetch;
const config = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'configured-key',
  apiMode: 'chat',
  modelsDev: { enabled: false },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  clearModelCache();
  global.fetch = originalFetch;
});

test('model discovery forwards gateway credentials without sending them to models.dev', async () => {
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers) });
    if (String(url).endsWith('/models')) {
      return json({ data: [{ id: 'private-model', name: 'Private model' }] });
    }
    return json({ data: [] });
  };

  const models = await fetchModels({
    ...config,
    modelsDev: { enabled: true, url: 'https://metadata.example/catalog.json' },
    headers: { 'CF-Access-Client-Id': 'client-id', 'CF-Access-Client-Secret': 'client-secret' },
  }, 'active-key');

  assert.equal(models[0].id, 'private-model');
  const discovery = requests.find((request) => request.url.endsWith('/models'));
  assert.equal(discovery.headers.get('CF-Access-Client-Id'), 'client-id');
  assert.equal(discovery.headers.get('CF-Access-Client-Secret'), 'client-secret');
  assert.equal(discovery.headers.get('Authorization'), 'Bearer active-key');
  const metadata = requests.find((request) => request.url.startsWith('https://metadata.example'));
  assert.ok(metadata);
  assert.equal(metadata.headers.get('CF-Access-Client-Secret'), null);
});

for (const legacy of [false, true]) {
  test(`combo discovery forwards gateway headers${legacy ? ' on legacy fallback' : ''}`, async () => {
    const requests = [];
    global.fetch = async (url, init) => {
      requests.push({ url: String(url), headers: new Headers(init.headers) });
      if (legacy && String(url).endsWith('/v1/combos')) return json({}, 404);
      return json({ combos: [{ name: 'private-combo', models: ['model'], strategy: 'priority' }] });
    };

    const combos = await fetchComboData({
      ...config,
      headers: { 'CF-Access-Client-Secret': 'client-secret', authorization: 'Custom gateway auth' },
    });

    assert.ok(combos.has('private-combo'));
    assert.equal(requests.length, legacy ? 2 : 1);
    for (const request of requests) {
      assert.equal(request.headers.get('CF-Access-Client-Secret'), 'client-secret');
      assert.equal(request.headers.get('Authorization'), 'Custom gateway auth');
    }
  });
}

test('model caches isolate gateway credentials and normalize header names and order', async () => {
  let calls = 0;
  global.fetch = async (url) => String(url).endsWith('/models')
    ? json({ data: [{ id: `tenant-${++calls}`, name: 'Tenant model' }] })
    : json({ combos: [] });
  const firstConfig = { ...config, headers: { 'X-Tenant': 'first', 'X-Gateway': 'token' } };
  const secondConfig = { ...config, headers: { 'x-tenant': 'second', 'x-gateway': 'token' } };
  const equivalentConfig = { ...config, headers: { 'x-gateway': 'token', 'x-tenant': 'first' } };

  assert.equal((await fetchModels(firstConfig, 'key'))[0].id, 'tenant-1');
  assert.equal(getCachedModels(secondConfig, 'key'), null);
  assert.equal(isCacheValid(secondConfig, 'key'), false);
  assert.equal((await fetchModels(secondConfig, 'key'))[0].id, 'tenant-2');
  assert.equal((await fetchModels(equivalentConfig, 'key'))[0].id, 'tenant-1');
  assert.equal(calls, 2);
  clearModelCache(equivalentConfig, 'key');
  assert.equal(getCachedModels(firstConfig, 'key'), null);
  assert.equal(getCachedModels(secondConfig, 'key')[0].id, 'tenant-2');
});

for (const [identity, changedConfig] of [
  ['endpoint', { baseUrl: 'https://other.example/v1' }],
  ['API key', { apiKey: 'other-key' }],
  ['gateway credentials', { headers: { 'X-Tenant': 'other' } }],
]) {
  test(`combo caches isolate ${identity}`, async () => {
    let calls = 0;
    global.fetch = async () => json({
      combos: [{ name: `combo-${++calls}`, models: ['model'], strategy: 'priority' }],
    });
    const firstConfig = { ...config, headers: { 'X-Tenant': 'first' } };

    assert.ok((await fetchComboData(firstConfig)).has('combo-1'));
    assert.ok((await fetchComboData({ ...firstConfig, ...changedConfig })).has('combo-2'));
    assert.ok((await fetchComboData(firstConfig)).has('combo-1'));
    assert.equal(calls, 2);
  });
}

test('combo caches reuse normalized headers and clear all identities', async () => {
  let calls = 0;
  global.fetch = async () => json({
    combos: [{ name: `combo-${++calls}`, models: ['model'], strategy: 'priority' }],
  });
  const firstConfig = { ...config, headers: { 'X-Tenant': 'first', 'X-Gateway': 'token' } };
  const equivalentConfig = { ...config, headers: { 'x-gateway': 'token', 'x-tenant': 'first' } };
  const secondConfig = { ...config, apiKey: 'other-key' };

  await fetchComboData(firstConfig);
  assert.ok((await fetchComboData(equivalentConfig)).has('combo-1'));
  await fetchComboData(secondConfig);
  clearComboCache();
  assert.ok((await fetchComboData(firstConfig)).has('combo-3'));
  assert.ok((await fetchComboData(secondConfig)).has('combo-4'));
});

test('fetchModels uses the active API key for combo enrichment too', async () => {
  let comboAuth;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return json({ data: [{ id: 'model', name: 'Model' }] });
    comboAuth = new Headers(init.headers).get('Authorization');
    return json({ combos: [] });
  };

  await fetchModels(config, 'active-key');

  assert.equal(comboAuth, 'Bearer active-key');
});

test('model caches separate alias visibility settings', async () => {
  global.fetch = async (url) => String(url).endsWith('/models')
    ? json({ data: [
      { id: 'model', name: 'Model' },
      { id: 'alias', name: 'Alias', parent: 'model' },
    ] })
    : json({ combos: [] });
  assert.equal((await fetchModels(config, 'key')).length, 2);
  assert.equal((await fetchModels({ ...config, hideModelAliases: true }, 'key')).length, 1);
});
