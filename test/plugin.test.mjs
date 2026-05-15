import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import OmniRouteAuthPlugin from '../dist/index.js';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_HOME = process.env.HOME;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.HOME = ORIGINAL_HOME;
});

function createModelsResponse() {
  return {
    object: 'list',
    data: [
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
      },
    ],
  };
}

test('config hook applies defaults and normalized apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  const config = {
    provider: {
      omniroute: {
        options: {
          baseURL: 'http://localhost:20128/v1',
          apiMode: 'invalid-mode',
        },
      },
    },
  };

  await plugin.config(config);

  assert.equal(config.provider.omniroute.api, 'chat');
  assert.equal(config.provider.omniroute.options.apiMode, 'chat');
  assert.equal(config.provider.omniroute.options.baseURL, 'http://localhost:20128/v1');
});

test('loader injects auth headers only for OmniRoute URLs', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  const calls = [];

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });

    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: {
      baseURL: 'http://localhost:20128/v1',
      apiMode: 'chat',
    },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch('http://localhost:20128/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });

  await interceptedFetch('https://example.com/not-omniroute', {
    method: 'POST',
    body: JSON.stringify({ value: true }),
  });

  const omnirouteCall = calls.find((call) => call.url.includes('/chat/completions'));
  const externalCall = calls.find((call) => call.url.includes('example.com/not-omniroute'));

  assert.ok(omnirouteCall);
  assert.ok(externalCall);

  const omnirouteHeaders = new Headers(omnirouteCall.init?.headers);
  assert.equal(omnirouteHeaders.get('Authorization'), 'Bearer secret-key');
  assert.equal(omnirouteHeaders.get('Content-Type'), 'application/json');

  const externalHeaders = new Headers(externalCall.init?.headers);
  assert.equal(externalHeaders.get('Authorization'), null);
});

test('gemini tool schema payload is sanitized before forwarding', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  let forwardedBody;

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    forwardedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch('http://localhost:20128/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gemini-2.5-pro',
      messages: [],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: {
              type: 'object',
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              additionalProperties: false,
              properties: {
                query: {
                  type: 'array',
                  items: {
                    $ref: '#/$defs/queryItem',
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  const params = forwardedBody.tools[0].function.parameters;
  assert.equal(params.$schema, undefined);
  assert.equal(params.additionalProperties, undefined);
  assert.equal(params.properties.query.items.$ref, undefined);
});

test('non-gemini payload keeps original tool schema fields', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  let forwardedBody;

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    forwardedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch('http://localhost:20128/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            parameters: {
              type: 'object',
              $schema: 'https://json-schema.org/draft/2020-12/schema',
            },
          },
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(
    forwardedBody.tools[0].function.parameters.$schema,
    'https://json-schema.org/draft/2020-12/schema',
  );
});

test('gemini schema sanitization applies to responses endpoint request objects', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  let forwardedBody;

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const raw = typeof init?.body === 'string' ? init.body : await input.clone().text();
    forwardedBody = JSON.parse(raw);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: { baseURL: 'http://localhost:20128/v1', apiMode: 'responses' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  const request = new Request('http://localhost:20128/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-2.5-pro',
      input: 'test',
      tools: [
        {
          type: 'function',
          name: 'lookup',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
      ],
    }),
  });

  await interceptedFetch(request);

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.tools[0].input_schema.additionalProperties, undefined);
  assert.equal(forwardedBody.tools[0].input_schema.properties.query.items.additionalProperties, undefined);
});

test('provider hook fetches models when auth is available via context', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'live-model', name: 'Live Model' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await plugin.provider.models(
    {
      id: 'omniroute',
      name: 'OmniRoute',
      source: 'config',
      env: [],
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat' },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.ok(result['live-model']);
  assert.equal(result['live-model'].name, 'Live Model');
  assert.equal(result['live-model'].providerID, 'omniroute');
});

test('provider hook ignores stale provider.models and returns defaults when no auth available', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async () => {
    throw new Error('should not fetch');
  };

  const result = await plugin.provider.models(
    {
      id: 'omniroute',
      name: 'OmniRoute',
      source: 'config',
      env: [],
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat' },
      models: {
        'stale-model': {
          id: 'stale-model',
          name: 'Stale',
          providerID: 'wrong-provider',
          api: { id: 'stale-model', url: 'http://wrong-url', npm: 'wrong-npm' },
        },
      },
    },
    {}, // no auth
  );

  // Should return default models (gpt-4o, gpt-4o-mini, etc.), NOT stale provider.models
  assert.ok(result['gpt-4o']);
  assert.equal(result['gpt-4o'].providerID, 'omniroute');
  assert.equal(result['gpt-4o'].api.url, 'http://localhost:20128/v1');
  // Stale model must NOT be present
  assert.equal(result['stale-model'], undefined);
});

test('provider hook returns defaults when fetch fails (fetchModels handles errors)', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async () => {
    throw new Error('API unavailable');
  };

  const result = await plugin.provider.models(
    {
      id: 'omniroute',
      name: 'OmniRoute',
      source: 'config',
      env: [],
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat' },
      models: { 'existing-model': { id: 'existing-model', name: 'Existing', providerID: 'omniroute' } },
    },
    { auth: { type: 'api', key: 'bad-key' } },
  );

  // fetchModels catches errors and returns defaults, so we get default models
  assert.ok(result['gpt-4o']);
  assert.equal(result['gpt-4o'].providerID, 'omniroute');
  // When auth is present but fetch fails, fetchModels catches the error and
  // returns default models. The provider.models fallback is NOT used.
  assert.equal(result['existing-model'], undefined);
});

test('config hook eagerly fetches models when auth is available', async () => {
  const tempHome = join(tmpdir(), `opencode-test-${Date.now()}`);
  try {
    await mkdir(join(tempHome, '.local', 'share', 'opencode'), { recursive: true });
    await writeFile(
      join(tempHome, '.local', 'share', 'opencode', 'auth.json'),
      JSON.stringify({
        omniroute: { type: 'api', key: 'test-key' },
      }),
    );
    process.env.HOME = tempHome;

    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'custom-model', name: 'Custom Model' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const plugin = await OmniRouteAuthPlugin({});
    const config = {
      provider: {
        omniroute: {
          options: {
            baseURL: 'http://localhost:20128/v1',
            apiMode: 'chat',
          },
        },
      },
    };

    await plugin.config(config);

    assert.ok(config.provider.omniroute.models['custom-model']);
    assert.equal(config.provider.omniroute.models['custom-model'].name, 'Custom Model');
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});
