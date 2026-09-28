import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import pluginEntry, { OmniRouteAuthPlugin, v2Definition } from '../dist/index.js';
import { setup, toV2Model, toV2Models } from '../dist/src/plugin-v2.js';
import { normalizeChatUsageResponse, sanitizeChatPayload } from '../dist/src/http-sanitize.js';

const DEAD_BASE_URL = 'http://127.0.0.1:1/v1';

function makeDataHome() {
  const dataHome = join(tmpdir(), `omniroute-v2-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(dataHome, 'opencode'), { recursive: true });
  return dataHome;
}

function withAuthEnv({ dataHome, envKey } = {}) {
  const prev = {
    xdg: process.env.XDG_DATA_HOME,
    envKey: process.env.OMNIROUTE_API_KEY,
  };
  if (dataHome) {
    process.env.XDG_DATA_HOME = dataHome;
  } else {
    delete process.env.XDG_DATA_HOME;
  }
  if (envKey === null) {
    delete process.env.OMNIROUTE_API_KEY;
  } else {
    process.env.OMNIROUTE_API_KEY = envKey;
  }
  return () => {
    if (prev.xdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prev.xdg;
    if (prev.envKey === undefined) delete process.env.OMNIROUTE_API_KEY;
    else process.env.OMNIROUTE_API_KEY = prev.envKey;
  };
}

function makeCtx({
  options = {},
  existingProvider = null,
  existingIntegration = null,
  connection = null,
  credential = null,
} = {}) {
  const calls = {
    integrationTransform: 0,
    methodUpdate: undefined,
    providerTransform: 0,
    added: undefined,
    updated: undefined,
    modelsSet: undefined,
    providerReload: 0,
    hooks: [],
    disposedHooks: [],
  };

  const ctx = {
    options,
    integration: {
      connection: {
        active: async () => connection,
        resolve: async () => credential,
      },
      transform: async (cb) => {
        calls.integrationTransform += 1;
        cb({
          method: {
            update: (arg) => {
              calls.methodUpdate = arg;
            },
          },
          get: () => existingIntegration,
          update: (id, mut) => {
            calls.integrationUpdate = { id, mut };
          },
        });
      },
    },
    provider: {
      transform: async (cb) => {
        calls.providerTransform += 1;
        cb({
          get: () => existingProvider,
          add: (arg) => {
            calls.added = arg;
          },
          update: (id, mut) => {
            const target = existingProvider ? structuredClone(existingProvider) : { id };
            mut(target);
            calls.updated = { id, provider: target };
          },
          models: {
            set: (id, models) => {
              calls.modelsSet = { id, models };
            },
          },
        });
      },
      reload: async () => {
        calls.providerReload += 1;
      },
    },
    session: {
      hook: async (name, cb, opts) => {
        calls.hooks.push({ name, cb, opts });
        return {
          dispose: async () => {
            calls.disposedHooks.push(name);
          },
        };
      },
    },
  };

  return { ctx, calls };
}

test('V2 entry: default export is a definition object with id/setup plus V1 server', () => {
  assert.equal(typeof pluginEntry, 'object');
  assert.equal(pluginEntry.id, 'opencode-omniroute-auth');
  assert.equal(typeof pluginEntry.setup, 'function');
  assert.equal(typeof pluginEntry.server, 'function');
  assert.equal(pluginEntry.setup, v2Definition.setup);
  assert.equal(pluginEntry.server, OmniRouteAuthPlugin);
});

test('toV2Model maps an OmniRoute model to the V2 Model.Info shape', () => {
  const config = { baseUrl: DEAD_BASE_URL, apiKey: 'k', apiMode: 'chat' };
  const model = {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    contextWindow: 200000,
    maxTokens: 8192,
    pricing: { input: 3, output: 15 },
  };

  const mapped = toV2Model(model, config);
  assert.equal(mapped.id, 'claude-sonnet-4-5');
  assert.equal(mapped.modelID, 'claude-sonnet-4-5');
  assert.equal(mapped.providerID, 'omniroute');
  assert.equal(mapped.name, 'Claude Sonnet 4.5');
  assert.equal(mapped.family, 'claude');
  assert.deepEqual(mapped.capabilities, {
    tools: true,
    input: ['text', 'image'],
    output: ['text'],
  });
  assert.deepEqual(mapped.variants, [
    { id: 'low', settings: { reasoningEffort: 'low' } },
    { id: 'medium', settings: { reasoningEffort: 'medium' } },
    { id: 'high', settings: { reasoningEffort: 'high' } },
  ]);
  assert.deepEqual(mapped.time, { released: 0 });
  assert.deepEqual(mapped.cost, [{ input: 3, output: 15, cache: { read: 0, write: 0 } }]);
  assert.equal(mapped.status, 'active');
  assert.equal(mapped.enabled, true);
  assert.deepEqual(mapped.limit, { context: 200000, output: 8192 });
});

test('toV2Model applies capability and variant edge cases', () => {
  const config = { baseUrl: DEAD_BASE_URL, apiKey: 'k', apiMode: 'chat' };

  // No vision, tools explicitly disabled, no reasoning -> no variants.
  const plain = toV2Model(
    { id: 'gpt-5-nano', name: 'GPT-5 nano', supportsTools: false },
    config,
  );
  assert.equal(plain.capabilities.tools, false);
  assert.deepEqual(plain.capabilities.input, ['text']);
  assert.deepEqual(plain.variants, []);
  assert.deepEqual(plain.limit, { context: 128000, output: 4096 });
  assert.deepEqual(plain.cost, [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]);

  // Explicit variant records win over the reasoning defaults.
  const custom = toV2Model(
    {
      id: 'or-model',
      name: 'OR',
      supportsReasoning: true,
      variants: { turbo: { reasoningEffort: 'high' } },
    },
    config,
  );
  assert.deepEqual(custom.variants, [{ id: 'turbo', settings: { reasoningEffort: 'high' } }]);

  // displayName 'id' overrides the name.
  const byId = toV2Model(
    { id: 'claude/sonnet', name: 'Sonnet' },
    { ...config, modelNameDisplay: 'id' },
  );
  assert.equal(byId.name, 'claude/sonnet');

  assert.equal(toV2Models([{ id: 'a' }, { id: 'b' }], config).length, 2);
});

test('setup registers integration, provider, and scoped http hooks', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: null });
  writeFileSync(
    join(dataHome, 'opencode', 'auth.json'),
    JSON.stringify({ omniroute: { type: 'api', key: 'sk-from-store' } }),
  );

  try {
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, modelCacheTtl: 3600000 },
    });
    const cleanup = await setup(ctx);
    assert.equal(typeof cleanup, 'function');

    // Integration: key method registered so /connect offers an API key form.
    assert.equal(calls.integrationTransform, 1);
    assert.deepEqual(calls.methodUpdate, {
      integrationID: 'omniroute',
      method: { type: 'key', label: 'API Key' },
    });

    // Provider: absent in the registry, so it must be added with the chat
    // driver package, resolved settings, and default models.
    assert.equal(calls.providerTransform, 1);
    assert.ok(calls.added, 'expected provider editor add()');
    assert.equal(calls.added.info.id, 'omniroute');
    assert.equal(calls.added.info.name, 'OmniRoute');
    assert.equal(calls.added.info.activation, 'enabled');
    assert.equal(calls.added.info.package, '@opencode/ai/providers/openai-compatible');
    assert.equal(calls.added.info.integrationID, 'omniroute');
    assert.equal(calls.added.info.settings.baseURL, DEAD_BASE_URL);
    assert.equal(calls.added.info.settings.apiKey, 'sk-from-store');
    assert.ok(Array.isArray(calls.added.models) && calls.added.models.length > 0);
    assert.ok(calls.added.models.every((m) => m.providerID === 'omniroute'));

    // Session hooks are registered and scoped to the omniroute provider.
    assert.deepEqual(
      calls.hooks.map((h) => h.name).sort(),
      ['http.request', 'http.response'],
    );
    assert.ok(calls.hooks.every((h) => h.opts && h.opts.providerID === 'omniroute'));

    await cleanup();
    assert.deepEqual(calls.disposedHooks.sort(), ['http.request', 'http.response']);
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('setup updates an existing config-defined provider row', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-from-env' });

  try {
    const existing = {
      id: 'omniroute',
      name: 'OmniRoute',
      activation: 'auto',
      package: '',
      settings: {
        baseURL: DEAD_BASE_URL,
        apiMode: 'chat',
        refreshOnList: true,
        modelCacheTtl: 300000,
      },
    };
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, modelCacheTtl: 3600000 },
      existingProvider: existing,
    });
    const cleanup = await setup(ctx);

    assert.equal(calls.providerTransform, 1);
    assert.equal(calls.added, undefined, 'expected update, not add');
    assert.equal(calls.updated.id, 'omniroute');
    const provider = calls.updated.provider;
    assert.equal(provider.name, 'OmniRoute');
    assert.equal(provider.activation, 'enabled');
    assert.equal(provider.package, '@opencode/ai/providers/openai-compatible');
    assert.equal(provider.integrationID, 'omniroute');
    assert.deepEqual(provider.settings, {
      baseURL: DEAD_BASE_URL,
      apiKey: 'sk-from-env',
    });
    assert.equal(calls.modelsSet.id, 'omniroute');
    assert.ok(calls.modelsSet.models.length > 0);

    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('setup prefers the active integration credential over store and env', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-from-env' });
  writeFileSync(
    join(dataHome, 'opencode', 'auth.json'),
    JSON.stringify({ omniroute: { type: 'api', key: 'sk-from-store' } }),
  );

  try {
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, modelCacheTtl: 3600000 },
      connection: { id: 'conn-1' },
      credential: { type: 'key', key: 'sk-from-connection' },
    });
    const cleanup = await setup(ctx);

    assert.equal(calls.added.info.settings.apiKey, 'sk-from-connection');
    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('setup selects the openai driver package for responses apiMode', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-from-env' });

  try {
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, apiMode: 'responses', modelCacheTtl: 3600000 },
    });
    const cleanup = await setup(ctx);

    assert.equal(calls.added.info.package, '@opencode/ai/providers/openai');
    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('refresh passes the resolved API key to combo enrichment', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-refresh-key' });

  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, auth: init?.headers?.Authorization ?? null });
    if (url.includes('/models')) {
      return new Response(
        JSON.stringify({ data: [{ id: 'auto/best-coding', name: 'Best Coding', owned_by: 'combo' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/combos')) {
      return new Response(
        JSON.stringify({
          combos: [{ name: 'auto/best-coding', models: ['openai/gpt-5'], strategy: 'priority' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const { ctx } = makeCtx({
      options: { baseURL: 'https://omni.example/v1', modelCacheTtl: 3600000, refreshOnList: true },
    });
    const cleanup = await setup(ctx);

    // Give the initial (void) refresh time to run to completion.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const combo = requests.find((r) => r.url.includes('/combos'));
    assert.ok(combo, 'expected a combo enrichment fetch');
    assert.equal(combo.auth, 'Bearer sk-refresh-key');

    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
});

test('http.request hook adds bearer auth and sanitizes the payload', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-hook-key' });

  try {
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, modelCacheTtl: 3600000 },
    });
    const cleanup = await setup(ctx);
    const reqHook = calls.hooks.find((h) => h.name === 'http.request');
    assert.ok(reqHook);

    // 1) Gemini payload with unsupported schema keywords -> sanitized clone.
    const geminiBody = JSON.stringify({
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'fn',
            parameters: {
              type: 'object',
              $schema: 'http://json-schema.org/draft-07/schema#',
              properties: { x: { type: 'string' } },
              additionalProperties: false,
            },
          },
        },
      ],
    });
    const event = {
      request: new Request(`https://omni.example/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: geminiBody,
      }),
    };
    await reqHook.cb(event);

    assert.equal(event.request.headers.get('authorization'), 'Bearer sk-hook-key');
    assert.notEqual(event.request, undefined);
    const sent = JSON.parse(await event.request.text());
    assert.equal(sent.tools[0].function.parameters.$schema, undefined);
    assert.equal(sent.tools[0].function.parameters.additionalProperties, undefined);
    assert.equal(sent.tools[0].function.parameters.type, 'object');
    assert.equal(sent.model, 'gemini-2.5-pro');

    // 2) Claude title prompt with reasoning effort -> stripped.
    const claudeBody = JSON.stringify({
      model: 'claude/sonnet-4-5',
      reasoning_effort: 'high',
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. Create a thread title.',
        },
        { role: 'user', content: 'hello' },
      ],
    });
    const claudeEvent = {
      request: new Request(`https://omni.example/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer already-set',
        },
        body: claudeBody,
      }),
    };
    await reqHook.cb(claudeEvent);

    assert.equal(claudeEvent.request.headers.get('authorization'), 'Bearer already-set');
    const claudeSent = JSON.parse(await claudeEvent.request.text());
    assert.equal(claudeSent.reasoning_effort, undefined);
    assert.deepEqual(claudeSent.messages, JSON.parse(claudeBody).messages);

    // 3) Plain payload that needs no change is forwarded as-is.
    const plainEvent = {
      request: new Request(`https://omni.example/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: JSON.stringify({ model: 'gpt-5', messages: [] }),
      }),
    };
    const before = plainEvent.request;
    await reqHook.cb(plainEvent);
    assert.equal(plainEvent.request, before);

    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('http.response hook normalizes cached usage on /chat/completions', async () => {
  const dataHome = makeDataHome();
  const restore = withAuthEnv({ dataHome, envKey: 'sk-hook-key' });

  try {
    const { ctx, calls } = makeCtx({
      options: { baseURL: DEAD_BASE_URL, modelCacheTtl: 3600000 },
    });
    const cleanup = await setup(ctx);
    const resHook = calls.hooks.find((h) => h.name === 'http.response');
    assert.ok(resHook);

    const payload = {
      id: 'cmpl-1',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        total_tokens: 110,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    };
    const original = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const event = {
      request: new Request('https://omni.example/v1/chat/completions'),
      response: original,
    };
    await resHook.cb(event);

    assert.notEqual(event.response, original);
    const normalized = await event.response.json();
    assert.equal(normalized.usage.prompt_tokens, 60);
    assert.equal(normalized.usage.total_tokens, 70);
    assert.equal(normalized.usage.completion_tokens, 10);
    assert.equal(normalized.usage.prompt_tokens_details.cached_tokens, 40);

    await cleanup();
  } finally {
    restore();
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test('sanitizeChatPayload leaves non-target models untouched', () => {
  const url = 'https://omni.example/v1/chat/completions';
  const body = JSON.stringify({
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(sanitizeChatPayload(body, url), undefined);
  assert.equal(sanitizeChatPayload(undefined, url), undefined);
  assert.equal(sanitizeChatPayload(body, 'https://omni.example/v1/models'), undefined);
});

test('normalizeChatUsageResponse passes through non-chat responses', async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const result = await normalizeChatUsageResponse('https://omni.example/v1/models', response);
  assert.equal(result, response);

  const sse = new Response(
    [
      'data: {"usage":{"prompt_tokens":10,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":5}}}',
      'data: [DONE]',
      '',
    ].join('\n'),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
  const normalized = await normalizeChatUsageResponse('https://omni.example/v1/chat/completions', sse);
  const text = await normalized.text();
  const firstLine = text.split('\n')[0];
  const usage = JSON.parse(firstLine.slice('data: '.length)).usage;
  assert.equal(usage.prompt_tokens, 5);
  assert.equal(usage.total_tokens, 7);
});
