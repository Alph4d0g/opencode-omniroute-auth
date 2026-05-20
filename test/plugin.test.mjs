import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import OmniRouteAuthPlugin from '../dist/index.js';
import { clearModelCache } from '../dist/runtime.js';
import { clearModelsDevCache } from '../dist/src/models-dev.js';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  restoreEnv('HOME', ORIGINAL_HOME);
  restoreEnv('XDG_DATA_HOME', ORIGINAL_XDG_DATA_HOME);
  clearModelCache();
  clearModelsDevCache();
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function getDummyBaseUrl(port = 20128) {
  return `http://localhost:${port}/v1`;
}

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

async function createTempAuthHome(auth = { omniroute: { type: 'api', key: 'test-key' } }) {
  const tempHome = join(tmpdir(), `opencode-test-${Date.now()}-${Math.random()}`);
  const dataHome = join(tempHome, '.local', 'share');
  await mkdir(join(dataHome, 'opencode'), { recursive: true });
  await writeFile(join(dataHome, 'opencode', 'auth.json'), JSON.stringify(auth));
  process.env.HOME = tempHome;
  process.env.XDG_DATA_HOME = dataHome;
  return tempHome;
}

test('config hook applies defaults and normalized apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  const config = {
    provider: {
      omniroute: {
        options: {
          baseURL: getDummyBaseUrl(),
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
      baseURL: getDummyBaseUrl(),
      apiMode: 'chat',
    },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch(`${getDummyBaseUrl()}/chat/completions`, {
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

test('auth loader applies user modelMetadata override to provider models', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: 1050000 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: {
      baseURL: getDummyBaseUrl(20133),
      apiMode: 'chat',
      modelMetadata: {
        'codex/gpt-5.5': {
          contextWindow: 512000,
        },
      },
    },
    models: {},
  };

  await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);

  assert.equal(provider.models['codex/gpt-5.5'].limit.context, 512000);
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch(`${getDummyBaseUrl()}/chat/completions`, {
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch(`${getDummyBaseUrl()}/chat/completions`, {
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'responses' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  const request = new Request(`${getDummyBaseUrl()}/responses`, {
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
      options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.ok(result['live-model']);
  assert.equal(result['live-model'].name, 'Live Model');
  assert.equal(result['live-model'].providerID, 'omniroute');
});

test('provider hook applies modelMetadata overrides before converting models', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: 1050000 }],
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
      options: {
        baseURL: getDummyBaseUrl(20132),
        apiMode: 'chat',
        modelMetadata: {
          'codex/gpt-5.5': {
            contextWindow: 512000,
          },
        },
      },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.equal(result['codex/gpt-5.5'].limit.context, 512000);
});

test('provider hook applies array literal alias block to canonical fetched model', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: 1050000 }],
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
      options: {
        baseURL: getDummyBaseUrl(20137),
        apiMode: 'chat',
        modelMetadata: [{ match: 'cx/gpt-5.5', contextWindow: 512000 }],
      },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.equal(result['codex/gpt-5.5'].limit.context, 512000);
});

test('provider hook treats string metadata match as a literal model id', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 8192 },
            { id: 'gpt-4x1-mini', name: 'GPT-4x1 Mini', contextWindow: 4096 },
          ],
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
      options: {
        baseURL: getDummyBaseUrl(20142),
        apiMode: 'chat',
        modelMetadata: [{ match: 'gpt-4.1-mini', contextWindow: 12345 }],
      },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.equal(result['gpt-4.1-mini'].limit.context, 12345);
  assert.equal(result['gpt-4x1-mini'].limit.context, 4096);
});

test('provider hook addIfMissing array block creates canonical missing model', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'other-model', name: 'Other Model', contextWindow: 4096 }],
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
      options: {
        baseURL: getDummyBaseUrl(20138),
        apiMode: 'chat',
        modelMetadata: [
          {
            match: 'cx/gpt-5.5',
            addIfMissing: true,
            name: 'GPT-5.5 Virtual',
            contextWindow: 512000,
          },
        ],
      },
      models: {},
    },
    { auth: { type: 'api', key: 'live-key' } },
  );

  assert.equal(result['codex/gpt-5.5'].name, 'GPT-5.5 Virtual');
  assert.equal(result['codex/gpt-5.5'].limit.context, 512000);
  assert.equal(result['cx/gpt-5.5'], undefined);
});

test('provider hook ignores generated modelMetadata from config hook', async () => {
  const tempHome = await createTempAuthHome();
  try {

    let modelContextWindow = 1050000;
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: modelContextWindow }],
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
            baseURL: getDummyBaseUrl(20134),
            apiMode: 'chat',
          },
        },
      },
    };

    await plugin.config(config);
    assert.equal(
      config.provider.omniroute.options.modelMetadata['codex/gpt-5.5'].contextWindow,
      1050000,
    );

    modelContextWindow = 512000;
    const clonedOptions = JSON.parse(JSON.stringify(config.provider.omniroute.options));
    const result = await plugin.provider.models(
      {
        id: 'omniroute',
        name: 'OmniRoute',
        source: 'config',
        env: [],
        options: clonedOptions,
        models: config.provider.omniroute.models,
      },
      { auth: { type: 'api', key: 'live-key' } },
    );

    assert.equal(result['codex/gpt-5.5'].limit.context, 512000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('provider hook uses raw user modelMetadata after config hook generated metadata', async () => {
  const tempHome = await createTempAuthHome();
  try {

    let modelContextWindow = 1050000;
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: modelContextWindow }],
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
            baseURL: getDummyBaseUrl(20135),
            apiMode: 'chat',
            modelMetadata: {
              'codex/gpt-5.5': {
                contextWindow: 258000,
              },
            },
          },
        },
      },
    };

    await plugin.config(config);
    assert.equal(
      config.provider.omniroute.options.modelMetadata['codex/gpt-5.5'].contextWindow,
      258000,
    );

    config.provider.omniroute.options.modelMetadata['codex/gpt-5.5'].contextWindow = 999000;
    modelContextWindow = 512000;

    const clonedOptions = JSON.parse(JSON.stringify(config.provider.omniroute.options));
    const result = await plugin.provider.models(
      {
        id: 'omniroute',
        name: 'OmniRoute',
        source: 'config',
        env: [],
        options: clonedOptions,
        models: config.provider.omniroute.models,
      },
      { auth: { type: 'api', key: 'live-key' } },
    );

    assert.equal(result['codex/gpt-5.5'].limit.context, 258000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('provider hook uses RegExp raw modelMetadata after config hook JSON clone', async () => {
  const tempHome = await createTempAuthHome();
  try {

    let modelContextWindow = 1050000;
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: modelContextWindow }],
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
            baseURL: getDummyBaseUrl(20139),
            apiMode: 'chat',
            modelMetadata: [{ match: /gpt-5\.5$/, contextWindow: 258000 }],
          },
        },
      },
    };

    await plugin.config(config);
    modelContextWindow = 512000;

    const result = await plugin.provider.models(
      {
        id: 'omniroute',
        name: 'OmniRoute',
        source: 'config',
        env: [],
        options: JSON.parse(JSON.stringify(config.provider.omniroute.options)),
        models: config.provider.omniroute.models,
      },
      { auth: { type: 'api', key: 'live-key' } },
    );

    assert.equal(result['codex/gpt-5.5'].limit.context, 258000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('auth loader uses raw user modelMetadata after config hook generated metadata', async () => {
  const tempHome = await createTempAuthHome();
  try {

    let modelContextWindow = 1050000;
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: modelContextWindow }],
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
            baseURL: getDummyBaseUrl(20136),
            apiMode: 'chat',
            modelMetadata: {
              'codex/gpt-5.5': {
                contextWindow: 258000,
              },
            },
          },
        },
      },
    };

    await plugin.config(config);
    assert.equal(config.provider.omniroute.models['codex/gpt-5.5'].limit.context, 258000);

    config.provider.omniroute.options.modelMetadata['codex/gpt-5.5'].contextWindow = 999000;
    modelContextWindow = 512000;

    config.provider.omniroute.options = JSON.parse(JSON.stringify(config.provider.omniroute.options));

    await plugin.auth.loader(
      async () => ({ type: 'api', key: 'live-key' }),
      config.provider.omniroute,
    );

    assert.equal(config.provider.omniroute.models['codex/gpt-5.5'].limit.context, 258000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
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
      options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
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
      options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
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
  const tempHome = await createTempAuthHome();
  try {

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
            baseURL: getDummyBaseUrl(),
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

test('config hook refreshes plugin-generated models on second run', async () => {
  const tempHome = await createTempAuthHome();
  try {

    let modelContextWindow = 1050000;
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: modelContextWindow }],
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
            baseURL: getDummyBaseUrl(20140),
            apiMode: 'chat',
            modelCacheTtl: 1,
          },
        },
      },
    };

    await plugin.config(config);
    assert.equal(config.provider.omniroute.models['codex/gpt-5.5'].limit.context, 1050000);

    modelContextWindow = 512000;
    await new Promise((resolve) => setTimeout(resolve, 5));
    config.provider.omniroute.options = JSON.parse(JSON.stringify(config.provider.omniroute.options));
    await plugin.config(config);

    assert.equal(config.provider.omniroute.models['codex/gpt-5.5'].limit.context, 512000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook refreshes legacy generated provider models without marker', async () => {
  const tempHome = await createTempAuthHome();
  try {
    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'fresh-model', name: 'Fresh Model', contextWindow: 512000 }],
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
          api: 'chat',
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: getDummyBaseUrl(20143),
            apiMode: 'chat',
          },
          models: {
            'stale-model': {
              id: 'stale-model',
              name: 'Stale Model',
              providerID: 'omniroute',
              api: {
                id: 'stale-model',
                url: getDummyBaseUrl(20143),
                npm: '@ai-sdk/openai-compatible',
              },
            },
          },
        },
      },
    };

    await plugin.config(config);

    assert.equal(config.provider.omniroute.models['stale-model'], undefined);
    assert.ok(config.provider.omniroute.models['fresh-model']);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook preserves explicit user provider models', async () => {
  const tempHome = await createTempAuthHome();
  try {

    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'fetched-model', name: 'Fetched Model', contextWindow: 512000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const explicitModel = {
      id: 'explicit-model',
      name: 'Explicit Model',
      providerID: 'omniroute',
    };
    const plugin = await OmniRouteAuthPlugin({});
    const config = {
      provider: {
        omniroute: {
          options: {
            baseURL: getDummyBaseUrl(20141),
            apiMode: 'chat',
          },
          models: {
            'explicit-model': explicitModel,
          },
        },
      },
    };

    await plugin.config(config);

    assert.equal(config.provider.omniroute.models['explicit-model'], explicitModel);
    assert.equal(config.provider.omniroute.models['fetched-model'], undefined);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook preserves user modelMetadata object overrides', async () => {
  const tempHome = await createTempAuthHome();
  try {

    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              {
                id: 'cx/gpt-5.5',
                name: 'GPT-5.5',
                contextWindow: 1050000,
                supportsReasoning: true,
              },
            ],
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
            baseURL: getDummyBaseUrl(20129),
            modelMetadata: {
              'cx/gpt-5.5': {
                contextWindow: 258000,
              },
            },
          },
        },
      },
    };

    await plugin.config(config);

    // User metadata is merged into canonical key after deduplication
    const metadata = config.provider.omniroute.options.modelMetadata['codex/gpt-5.5'];
    assert.equal(metadata.contextWindow, 258000);
    assert.equal(metadata.supportsReasoning, true);
    const model = config.provider.omniroute.models['codex/gpt-5.5'];
    assert.equal(model.limit.context, 258000);
    assert.equal(model.reasoning, true);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook preserves user modelMetadata match blocks', async () => {
  const tempHome = await createTempAuthHome();
  try {

    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'cx/gpt-5.5', name: 'GPT-5.5', contextWindow: 1050000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const userBlock = {
      match: /^(codex|cx)\/.*gpt-5/,
      contextWindow: 258000,
    };
    const plugin = await OmniRouteAuthPlugin({});
    const config = {
      provider: {
        omniroute: {
          options: {
            baseURL: getDummyBaseUrl(20130),
            modelMetadata: [userBlock],
          },
        },
      },
    };

    await plugin.config(config);

    const metadata = config.provider.omniroute.options.modelMetadata;
    assert.ok(Array.isArray(metadata));
    // User config comes first in first-match-wins systems
    assert.equal(metadata[0].match, userBlock.match);
    assert.equal(metadata[0].contextWindow, 258000);
    // Generated metadata follows user config
    assert.equal(metadata[1].match, 'codex/gpt-5.5');
    assert.equal(metadata[1].contextWindow, 1050000);
    assert.equal(config.provider.omniroute.models['codex/gpt-5.5'].limit.context, 258000);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('config hook respects explicit attachment false for vision models', async () => {
  const tempHome = await createTempAuthHome();
  try {

    global.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/v1/models')) {
        return new Response(
          JSON.stringify({
            object: 'list',
            data: [
              {
                id: 'vision-no-attachment',
                name: 'Vision No Attachment',
                supportsVision: true,
                supportsAttachment: false,
              },
            ],
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
            baseURL: getDummyBaseUrl(20131),
          },
        },
      },
    };

    await plugin.config(config);

    const model = config.provider.omniroute.models['vision-no-attachment'];
    assert.equal(model.attachment, false);
    assert.equal(model.capabilities.attachment, false);
    assert.deepEqual(model.modalities.input, ['text', 'image']);
  } finally {
    await rm(tempHome, { recursive: true, force: true });
  }
});

test('provider hook groups variant models under base model', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'codex/gpt-5.5',
              name: 'GPT-5.5',
              supportsReasoning: true,
            },
            {
              id: 'codex/gpt-5.5-high',
              name: 'GPT-5.5 High',
              supportsReasoning: true,
            },
            {
              id: 'codex/gpt-5.5-xhigh',
              name: 'GPT-5.5 XHigh',
              supportsReasoning: true,
              contextWindow: 256000,
            },
            {
              id: 'openai/gpt-4o',
              name: 'GPT-4o',
              supportsReasoning: false,
            },
          ],
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
    { auth: { type: 'api', key: 'test-key' } },
  );

  assert.ok(result['codex/gpt-5.5']);
  assert.ok(result['codex/gpt-5.5'].variants.high);
  assert.ok(result['codex/gpt-5.5'].variants.xhigh);
  assert.equal(result['codex/gpt-5.5-high'], undefined);
  assert.equal(result['codex/gpt-5.5-xhigh'], undefined);
  assert.ok(result['openai/gpt-4o']);
  assert.equal(Object.keys(result['openai/gpt-4o'].variants).length, 0);
});

test('provider hook creates synthetic base model when only variants are returned', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'codex/gpt-5.5-high',
              name: 'GPT-5.5 High',
              contextWindow: 128000,
              supportsReasoning: true,
            },
            {
              id: 'codex/gpt-5.5-xhigh',
              name: 'GPT-5.5 XHigh',
              contextWindow: 256000,
              supportsReasoning: true,
            },
          ],
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
    { auth: { type: 'api', key: 'test-key' } },
  );

  assert.ok(result['codex/gpt-5.5']);
  assert.ok(result['codex/gpt-5.5'].variants.high);
  assert.ok(result['codex/gpt-5.5'].variants.xhigh);
  assert.equal(result['codex/gpt-5.5'].limit.context, 256000);
  assert.equal(result['codex/gpt-5.5-high'], undefined);
  assert.equal(result['codex/gpt-5.5-xhigh'], undefined);
});
