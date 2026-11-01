import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../dist/src/plugin-v2.js';
import { clearModelCache } from '../dist/runtime.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const originalFetch = global.fetch;
const originalInterval = global.setInterval;
const originalClearInterval = global.clearInterval;
const originalKey = process.env.OMNIROUTE_API_KEY;
const originalDataHome = process.env.XDG_DATA_HOME;
const cleanups = [];
const directories = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  global.fetch = originalFetch;
  global.setInterval = originalInterval;
  global.clearInterval = originalClearInterval;
  if (originalKey === undefined) delete process.env.OMNIROUTE_API_KEY;
  else process.env.OMNIROUTE_API_KEY = originalKey;
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
  for (const directory of directories.splice(0)) {
    assert.ok(directory.startsWith(join(tmpdir(), 'omniroute-v2-safety-')));
    await rm(directory, { recursive: true, force: true });
  }
  clearModelCache();
});

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for plugin activity');
}

async function host(
  options = {},
  fetchModels = async () => [{ id: 'first', name: 'First' }],
  initiallyConnected = true,
) {
  const dataHome = await mkdtemp(join(tmpdir(), 'omniroute-v2-safety-'));
  directories.push(dataHome);
  process.env.XDG_DATA_HOME = dataHome;
  const state = {
    key: 'active-key', reloads: 0, timer: undefined, transform: undefined,
    connection: { type: 'credential', id: 'first-account', method: 'key', label: 'First' },
  };
  const hooks = {};
  if (!initiallyConnected) state.connection = undefined;
  const methods = [];
  const queue = [];
  let wake;
  global.setInterval = (callback) => { state.timer = callback; return { unref() {} }; };
  global.clearInterval = () => {};
  global.fetch = async (input, init) => {
    if (String(input).endsWith('/models')) {
      return Response.json({ data: await fetchModels(init) });
    }
    return Response.json({ combos: [] });
  };
  const ctx = {
    options: { baseURL: 'https://omni.example/v1', modelsDev: { enabled: false }, ...options },
    integration: {
      connection: {
        active: async () => state.connection,
        resolve: async () => state.key ? { type: 'key', key: state.key } : undefined,
      },
      transform: async (callback) => {
        callback({ method: { update: (input) => methods.push(input) },
          get: () => ({ name: 'OmniRoute' }), update: () => {} });
      },
    },
    provider: {
      transform: async (callback) => { state.transform = callback; },
      reload: async () => { state.reloads++; },
    },
    session: {
      hook: async (name, callback) => {
        hooks[name] = callback;
        return { dispose: async () => {} };
      },
    },
    event: {
      subscribe: async function* ({ signal }) {
        while (!signal.aborted) {
          if (!queue.length) await new Promise((resolve) => {
            wake = resolve;
            signal.addEventListener('abort', resolve, { once: true });
          });
          if (queue.length) yield queue.shift();
        }
      },
    },
  };
  const cleanup = await setup(ctx);
  cleanups.push(cleanup);
  return {
    state, hooks, methods, cleanup,
    inventory() {
      let value;
      state.transform({ get: () => undefined, add: (input) => { value = input; } });
      return value;
    },
    switchEvent() {
      queue.push({ type: 'credential.switched', data: { integrationID: 'omniroute' } });
      wake?.();
    },
    integrationEvent() {
      queue.push({ type: 'integration.updated', data: {} });
      wake?.();
    },
  };
}

test('V2 does not add credentials to URLs outside the configured origin and path', async () => {
  const instance = await host();
  await until(() => instance.state.reloads > 0);
  for (const url of [
    'https://unrelated.example/v1/chat/completions',
    'https://omni.example.evil/v1/chat/completions',
    'https://omni.example/v10/chat/completions',
  ]) {
    const event = { request: new Request(url, { method: 'POST', body: '{}' }) };
    const original = event.request;
    await instance.hooks['http.request'](event);
    assert.equal(event.request.headers.get('authorization'), null, url);
    assert.equal(event.request, original);
  }
});

test('V2 sends configured proxy headers on generation requests', async () => {
  const instance = await host({ headers: { 'CF-Access-Client-Id': 'gateway-id' } });
  const event = { request: new Request('https://omni.example/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }) };
  await instance.hooks['http.request'](event);
  assert.equal(event.request.headers.get('CF-Access-Client-Id'), 'gateway-id');
  assert.equal(instance.inventory().info.headers['cf-access-client-id'], 'gateway-id');
});

test('V2 clears a revoked native credential and inventory even if an env key exists', async () => {
  process.env.OMNIROUTE_API_KEY = 'fallback-env-key';
  const instance = await host();
  await until(() => instance.state.reloads > 0);
  instance.state.connection = undefined;
  instance.state.key = undefined;
  const previous = instance.state.reloads;
  instance.state.timer();
  await until(() => instance.state.reloads > previous);
  const inventory = instance.inventory();
  assert.ok(inventory.info.settings.apiKey === undefined, 'revoked credentials must be removed');
  assert.equal(inventory.info.activation, 'auto');
  assert.ok(inventory.models.some((model) => model.id === 'gpt-4o'));
  const event = { request: new Request('https://omni.example/v1/chat/completions') };
  await instance.hooks['http.request'](event);
  assert.equal(event.request.headers.get('authorization'), null);
});

test('V2 refreshes immediately after a credential switch and binds discovered inventory', async () => {
  const instance = await host();
  await until(() => instance.state.reloads > 0);
  instance.state.key = 'next-key';
  instance.state.connection = { ...instance.state.connection, id: 'next-account' };
  const previous = instance.state.reloads;
  instance.switchEvent();
  await until(() => instance.state.reloads > previous);
  assert.equal(instance.inventory().sourceConnection.id, 'next-account');
  assert.equal(instance.inventory().info.settings.apiKey, 'next-key');
});

test('V2 does not reload or publish a pending discovery after cleanup', async () => {
  let release;
  let started = false;
  const instance = await host({}, async () => {
    started = true;
    await new Promise((resolve) => { release = resolve; });
    return [{ id: 'late-model' }];
  });
  await until(() => started);
  await instance.cleanup();
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(instance.state.reloads, 0);
});

test('V2 serializes refreshes and drops an old account response', async () => {
  let release;
  const keys = [];
  const instance = await host({}, async (init) => {
    const key = new Headers(init.headers).get('authorization');
    keys.push(key);
    if (keys.length === 1) await new Promise((resolve) => { release = resolve; });
    return [{ id: key === 'Bearer active-key' ? 'old-account' : 'new-account' }];
  });
  await until(() => keys.length === 1);
  instance.state.key = 'next-key';
  instance.state.connection = { ...instance.state.connection, id: 'next-account' };
  instance.state.timer();
  instance.state.timer();
  assert.equal(keys.length, 1);
  release();
  await until(() => instance.state.reloads > 0);
  assert.equal(instance.state.reloads, 1);
  assert.deepEqual(keys, ['Bearer active-key', 'Bearer next-key']);
  assert.equal(instance.inventory().models[0].id, 'new-account');
});

test('V2 discovers stored credentials when boot-batched integrations become visible', async () => {
  delete process.env.OMNIROUTE_API_KEY;
  const instance = await host({}, async () => [{ id: 'native-stored-model' }], false);
  instance.state.connection = {
    type: 'credential', id: 'native-stored-account', method: 'key', label: 'Stored account',
  };
  instance.integrationEvent();
  await until(() => instance.state.reloads > 0);
  assert.equal(instance.inventory().models[0].id, 'native-stored-model');
  assert.equal(instance.inventory().sourceConnection.id, 'native-stored-account');
});
