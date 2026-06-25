import { mkdirSync, writeFileSync, utimesSync } from 'fs';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Isolate logger output for plugin tests so warning assertions can read the log file.
const PLUGIN_TEST_DATA_HOME = join(tmpdir(), `opencode-plugin-tests-${Date.now()}`);
process.env.XDG_DATA_HOME = PLUGIN_TEST_DATA_HOME;
const PLUGIN_LOG_DIR = join(PLUGIN_TEST_DATA_HOME, 'opencode', 'log');
const PLUGIN_LOG_FILE = join(PLUGIN_LOG_DIR, 'omniroute.log');
mkdirSync(PLUGIN_LOG_DIR, { recursive: true });
writeFileSync(PLUGIN_LOG_FILE, '');
// Ensure this file wins mtime races against any previously-created test logs.
utimesSync(PLUGIN_LOG_FILE, Date.now() / 1000, (Date.now() / 1000) + 1000);

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
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
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

test('config hook selects provider package for chat apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
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

  assert.equal(config.provider.omniroute.api, 'chat');
  assert.equal(config.provider.omniroute.npm, '@ai-sdk/openai-compatible');
  assert.equal(config.provider.omniroute.models['gpt-4o'].api.npm, '@ai-sdk/openai-compatible');
});

test('config hook selects provider package for responses apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
  const config = {
    provider: {
      omniroute: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: getDummyBaseUrl(),
          apiMode: 'responses',
        },
      },
    },
  };

  await plugin.config(config);

  assert.equal(config.provider.omniroute.api, 'responses');
  assert.equal(config.provider.omniroute.npm, '@ai-sdk/openai');
  assert.equal(config.provider.omniroute.models['gpt-4o'].api.npm, '@ai-sdk/openai');
});

test('provider hook selects model package for responses apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  const result = await plugin.provider.models(
    {
      id: 'omniroute',
      name: 'OmniRoute',
      source: 'config',
      env: [],
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: getDummyBaseUrl(), apiMode: 'responses' },
      models: {},
    },
    { auth: undefined },
  );

  assert.equal(result['gpt-4o'].api.npm, '@ai-sdk/openai');
});

test('provider hook preserves custom provider package', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  const result = await plugin.provider.models(
    {
      id: 'omniroute',
      name: 'OmniRoute',
      source: 'config',
      env: [],
      npm: 'custom-ai-sdk-provider',
      options: { baseURL: getDummyBaseUrl(), apiMode: 'responses' },
      models: {},
    },
    { auth: undefined },
  );

  assert.equal(result['gpt-4o'].api.npm, 'custom-ai-sdk-provider');
});

test('config hook reconciles explicit model npm when provider package changes', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
  const config = {
    provider: {
      omniroute: {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: getDummyBaseUrl(),
          apiMode: 'responses',
        },
        models: {
          'gpt-4o': {
            id: 'gpt-4o',
            name: 'GPT-4o',
            providerID: 'omniroute',
            api: { id: 'gpt-4o', url: getDummyBaseUrl(), npm: '@ai-sdk/openai-compatible' },
          },
        },
      },
    },
  };

  await plugin.config(config);

  assert.equal(config.provider.omniroute.npm, '@ai-sdk/openai');
  assert.equal(config.provider.omniroute.models['gpt-4o'].api.npm, '@ai-sdk/openai');
});

test('auth loader selects provider package for responses apiMode', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'responses' },
    models: {},
  };

  await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);

  assert.equal(provider.models['gpt-4.1-mini'].api.npm, '@ai-sdk/openai');
});

test('config hook refreshes legacy-generated models with responses npm', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
  const config = {
    provider: {
      omniroute: {
        api: 'responses',
        npm: '@ai-sdk/openai',
        options: {
          baseURL: getDummyBaseUrl(),
          apiMode: 'responses',
        },
        models: {
          'gpt-4o': {
            id: 'gpt-4o',
            name: 'GPT-4o',
            providerID: 'omniroute',
            api: { id: 'gpt-4o', url: getDummyBaseUrl(), npm: '@ai-sdk/openai' },
          },
        },
      },
    },
  };

  await plugin.config(config);

  assert.equal(config.provider.omniroute.models['gpt-4o'].api.npm, '@ai-sdk/openai');
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

test('chat completion excludes cached tokens from JSON prompt tokens', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [],
        usage: {
          prompt_tokens: 39493,
          completion_tokens: 185,
          total_tokens: 39678,
          prompt_tokens_details: { cached_tokens: 36864 },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });
  const body = await response.json();

  assert.equal(body.usage.prompt_tokens, 2629);
  assert.equal(body.usage.completion_tokens, 185);
  assert.equal(body.usage.total_tokens, 2814);
  assert.equal(body.usage.prompt_tokens_details.cached_tokens, 36864);
});

test('chat completion excludes cached tokens from streaming prompt tokens', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  const contentChunk = 'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}';
  const usageChunk = [
    'data: {"choices":[],"usage":{',
    '"prompt_tokens":39493,',
    '"completion_tokens":185,',
    '"total_tokens":39678,',
    '"prompt_tokens_details":{"cached_tokens":36864}}}',
  ].join('');

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`${contentChunk}\n\n${usageChunk}\n\ndata: [DONE]`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [], stream: true }),
  });
  const text = await response.text();
  const normalizedLine = text
    .split('\n')
    .find((line) => line.includes('"prompt_tokens"'));

  assert.ok(text.includes(contentChunk));
  assert.ok(text.endsWith('\n'));
  assert.ok(normalizedLine);
  const normalized = JSON.parse(normalizedLine.slice('data: '.length));
  assert.equal(normalized.usage.prompt_tokens, 2629);
  assert.equal(normalized.usage.completion_tokens, 185);
  assert.equal(normalized.usage.total_tokens, 2814);
  assert.equal(normalized.usage.prompt_tokens_details.cached_tokens, 36864);
});

test('chat completion leaves JSON prompt tokens unchanged when cached_tokens is zero', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });
  const body = await response.json();

  assert.equal(body.usage.prompt_tokens, 100);
  assert.equal(body.usage.total_tokens, 110);
});

test('chat completion passes through non-OK responses unchanged', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'bad request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'bad request');
});

test('chat completion passes through malformed JSON unchanged', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not valid json', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [] }),
  });
  const text = await response.text();

  assert.equal(text, 'not valid json');
});

test('chat completion streaming passes through content-only chunks unchanged', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  const contentChunk = 'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}';

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(`${contentChunk}\n\ndata: [DONE]`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const provider = {
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const response = await options.fetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [], stream: true }),
  });
  const text = await response.text();

  assert.ok(text.includes(contentChunk));
  assert.ok(text.includes('data: [DONE]'));
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

test('claude title requests strip reasoning_effort before forwarding', async () => {
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
      model: 'claude/claude-haiku-4-5-20251001',
      temperature: 0.5,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. You output ONLY a thread title. Nothing else.',
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, undefined);
  assert.equal(forwardedBody.temperature, 0.5);
});

test('claude non-title requests keep reasoning_effort before forwarding', async () => {
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
      model: 'claude/claude-sonnet-4-6',
      temperature: 1,
      reasoning_effort: 'low',
      messages: [
        {
          role: 'user',
          content: 'Explain this bug.',
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, 'low');
  assert.equal(forwardedBody.temperature, 1);
});

test('claude title requests strip reasoning_effort from instructions field', async () => {
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
      model: 'claude/claude-haiku-4-5-20251001',
      temperature: 0.5,
      reasoning_effort: 'low',
      instructions: 'You are a title generator. You output ONLY a thread title.',
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, undefined);
  assert.equal(forwardedBody.temperature, 0.5);
});

test('claude title requests strip reasoning_effort from input array', async () => {
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'responses' },
    models: {},
  };

  const options = await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);
  const interceptedFetch = options.fetch;

  await interceptedFetch(`${getDummyBaseUrl()}/responses`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'claude/claude-haiku-4-5-20251001',
      reasoning_effort: 'low',
      input: [
        {
          role: 'system',
          content: 'You are a title generator. You output ONLY a thread title.',
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, undefined);
});

test('claude title requests strip reasoning_effort from top-level system field', async () => {
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
      model: 'claude/claude-haiku-4-5-20251001',
      reasoning_effort: 'low',
      system: 'You are a title generator. You output ONLY a thread title.',
      messages: [{ role: 'user', content: 'Hi' }],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, undefined);
});

test('claude title requests detect title markers case-insensitively', async () => {
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
      model: 'claude/claude-haiku-4-5-20251001',
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'you are a title generator' },
            { type: 'text', text: 'output a thread title' },
          ],
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, undefined);
});

test('claude title requests strip camelCase reasoningEffort', async () => {
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
      model: 'anthropic/claude-haiku-4-5-20251001',
      reasoningEffort: 'low',
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. You output ONLY a thread title.',
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoningEffort, undefined);
});

test('non-claude title requests keep reasoning_effort before forwarding', async () => {
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
      model: 'openai/gpt-4.1-mini',
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. You output ONLY a thread title.',
        },
      ],
    }),
  });

  assert.ok(forwardedBody);
  assert.equal(forwardedBody.reasoning_effort, 'low');
});

test('non-claude payloads are not re-stringified unnecessarily', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  let rawBody;

  global.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify(createModelsResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    rawBody = typeof init?.body === 'string' ? init.body : null;
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

  const originalBody = JSON.stringify({
    model: 'openai/gpt-4.1-mini',
    temperature: 1,
    reasoning_effort: 'low',
    messages: [{ role: 'user', content: 'Explain this bug.' }],
  });

  await interceptedFetch(`${getDummyBaseUrl()}/chat/completions`, {
    method: 'POST',
    body: originalBody,
  });

  assert.equal(rawBody, originalBody);
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

test('provider hook uses model id as display name when modelNameDisplay is "id"', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gh/gpt-5.5', name: 'GPT-5.5' },
            { id: 'cx/gpt-5.5', name: 'GPT-5.5' },
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
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat', modelNameDisplay: 'id' },
      models: {},
    },
    { auth: { type: 'api', key: 'test-key' } },
  );

  // Plugin remaps aliases to canonical keys (gh→github, cx→codex)
  // With modelNameDisplay:'id' the name field reflects the canonical id
  assert.ok(result['github/gpt-5.5'] || result['gh/gpt-5.5'], 'expected github/gpt-5.5 entry');
  assert.ok(result['codex/gpt-5.5'] || result['cx/gpt-5.5'], 'expected codex/gpt-5.5 entry');
  const ghEntry = result['github/gpt-5.5'] ?? result['gh/gpt-5.5'];
  const cxEntry = result['codex/gpt-5.5'] ?? result['cx/gpt-5.5'];
  // name should equal the model's id (not the human-readable display name)
  assert.equal(ghEntry.name, ghEntry.id);
  assert.equal(cxEntry.name, cxEntry.id);
});

test('provider hook uses model name as display name by default', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'gh/gpt-5.5', name: 'GPT-5.5' },
            { id: 'cx/gpt-5.5', name: 'GPT-5.5' },
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

  // Default: display name is the name field from /v1/models (not the id)
  const ghEntry = result['github/gpt-5.5'] ?? result['gh/gpt-5.5'];
  assert.ok(ghEntry, 'expected github/gpt-5.5 entry');
  assert.equal(ghEntry.name, 'GPT-5.5');
  assert.notEqual(ghEntry.name, ghEntry.id);
});

test('provider hook warns and falls back for invalid modelNameDisplay', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'gh/gpt-5.5', name: 'GPT-5.5' }],
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
      // invalid value — should fall back to 'name' mode
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat', modelNameDisplay: 'invalid' },
      models: {},
    },
    { auth: { type: 'api', key: 'test-key' } },
  );

  // Falls back to 'name' mode on invalid value
  const ghEntry = result['github/gpt-5.5'] ?? result['gh/gpt-5.5'];
  assert.ok(ghEntry, 'expected github/gpt-5.5 entry');
  assert.equal(ghEntry.name, 'GPT-5.5');
});

test('config hook uses model id as display name when modelNameDisplay is "id"', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
  const config = {
    provider: {
      omniroute: {
        options: {
          baseURL: 'http://localhost:20128/v1',
          apiMode: 'chat',
          modelNameDisplay: 'id',
        },
      },
    },
  };

  await plugin.config(config);

  const entry = config.provider.omniroute.models['gpt-4o'] ?? config.provider.omniroute.models['gpt-4.1-mini'];
  assert.ok(entry, 'expected default model entry');
  assert.equal(entry.name, entry.id);
});

test('config hook uses model name as display name by default', async () => {
  const plugin = await OmniRouteAuthPlugin({});
  process.env.XDG_DATA_HOME = join(tmpdir(), `opencode-test-no-auth-${Date.now()}`);
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

  const entry = config.provider.omniroute.models['gpt-4o'] ?? config.provider.omniroute.models['gpt-4.1-mini'];
  assert.ok(entry, 'expected default model entry');
  assert.notEqual(entry.name, entry.id);
  assert.equal(entry.name, 'GPT-4o');
});

test('auth loader uses model id as display name when modelNameDisplay is "id"', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'gh/gpt-5.5', name: 'GPT-5.5' }],
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
    options: { baseURL: getDummyBaseUrl(), apiMode: 'chat', modelNameDisplay: 'id' },
    models: {},
  };

  await plugin.auth.loader(async () => ({ type: 'api', key: 'secret-key' }), provider);

  const entry = provider.models['github/gpt-5.5'] ?? provider.models['gh/gpt-5.5'];
  assert.ok(entry, 'expected github/gpt-5.5 entry');
  assert.equal(entry.name, entry.id);
});

test('modelNameDisplay falls back to id when name is empty', async () => {
  const plugin = await OmniRouteAuthPlugin({});

  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: 'gh/gpt-5.5', name: '' }],
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
      options: { baseURL: 'http://localhost:20128/v1', apiMode: 'chat', modelNameDisplay: 'invalid' },
      models: {},
    },
    { auth: { type: 'api', key: 'test-key' } },
  );

  const ghEntry = result['github/gpt-5.5'] ?? result['gh/gpt-5.5'];
  assert.ok(ghEntry, 'expected github/gpt-5.5 entry');
  assert.equal(ghEntry.name, 'gh/gpt-5.5');
});
