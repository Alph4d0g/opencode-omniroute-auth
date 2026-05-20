import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearModelCache,
  fetchModels,
  getCachedModels,
  isCacheValid,
  refreshModels,
} from '../dist/runtime.js';
import { calculateLowestCommonCapabilities } from '../dist/src/models-dev.js';
import { groupVariantModels } from '../dist/src/models.js';

const ORIGINAL_FETCH = global.fetch;

const CONFIG = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: 'test-key',
  apiMode: 'chat',
  modelCacheTtl: 60000,
};

afterEach(() => {
  clearModelCache();
  global.fetch = ORIGINAL_FETCH;
});

// Helper to create a mock fetch that only counts /v1/models calls
// and returns valid empty responses for other endpoints (combos, models.dev)
function createMockFetch() {
  let modelCalls = 0;

  const mockFetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (url.includes('/v1/models')) {
      modelCalls += 1;
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: `model-${modelCalls}`, name: `Model ${modelCalls}` }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Return empty valid responses for other endpoints (combos, models.dev)
    return new Response(
      JSON.stringify({ data: [] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  return { mockFetch, getCalls: () => modelCalls };
}

test('fetchModels caches successful responses', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  const first = await fetchModels(CONFIG, CONFIG.apiKey, false);
  const second = await fetchModels(CONFIG, CONFIG.apiKey, false);

  assert.equal(getCalls(), 1);
  assert.equal(first[0].id, 'model-1');
  assert.equal(second[0].id, 'model-1');
  assert.ok(getCachedModels(CONFIG, CONFIG.apiKey));
  assert.equal(isCacheValid(CONFIG, CONFIG.apiKey), true);
});

test('refreshModels forces refetch', async () => {
  const { mockFetch, getCalls } = createMockFetch();
  global.fetch = mockFetch;

  await fetchModels(CONFIG, CONFIG.apiKey, false);
  const refreshed = await refreshModels(CONFIG, CONFIG.apiKey);

  assert.equal(getCalls(), 2);
  assert.equal(refreshed[0].id, 'model-2');
});

test('fetchModels falls back to defaults when response shape is invalid', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, true);
  assert.ok(models.length > 0);
  assert.ok(typeof models[0].id === 'string');
});

test('calculateLowestCommonCapabilities ignores missing attachment metadata', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'with-attachment', attachment: true },
    { id: 'without-attachment' },
  ]);

  assert.equal(capabilities.supportsAttachment, true);
});

test('calculateLowestCommonCapabilities respects explicit attachment false', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'with-attachment', attachment: true },
    { id: 'without-attachment', attachment: false },
  ]);

  assert.equal(capabilities.supportsAttachment, false);
});

test('fetchModels uses different cache for different modelsDev configs', async () => {
  let calls = 0;
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      calls++;
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: `model-${calls}`, name: `Model ${calls}` }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const config1 = { ...CONFIG, modelsDev: { enabled: true, providerAliases: { oai: 'openai' } } };
  const config2 = { ...CONFIG, modelsDev: { enabled: true, providerAliases: { oai: 'anthropic' } } };

  await fetchModels(config1, CONFIG.apiKey, false);
  await fetchModels(config2, CONFIG.apiKey, false);

  assert.equal(calls, 2, 'Should fetch twice for different modelsDev configs');
});

// Task 15: Single Model Metadata Tracking
test('calculateLowestCommonCapabilities produces identical output for single model and combo-with-self', () => {
  const single = calculateLowestCommonCapabilities([
    { id: 'test-model', temperature: true, reasoning: true, attachment: true },
  ]);

  const combo = calculateLowestCommonCapabilities([
    { id: 'test-model', temperature: true, reasoning: true, attachment: true },
    { id: 'test-model', temperature: true, reasoning: true, attachment: true },
  ]);

  // Core capability fields should match (supportsStreaming differs because
  // single-model path uses modelsDevToMetadata which doesn't add streaming,
  // while combo path always adds it)
  assert.equal(single.supportsTemperature, combo.supportsTemperature);
  assert.equal(single.supportsReasoning, combo.supportsReasoning);
  assert.equal(single.supportsAttachment, combo.supportsAttachment);
});

// Task 17: Temperature/Reasoning Combo Tests
test('calculateLowestCommonCapabilities handles mixed defined and undefined temperature', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'with-temp', temperature: true },
    { id: 'without-temp' },
  ]);

  assert.equal(capabilities.supportsTemperature, true);
});

test('calculateLowestCommonCapabilities handles explicit temperature false overriding true', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'with-temp', temperature: true },
    { id: 'without-temp', temperature: false },
  ]);

  assert.equal(capabilities.supportsTemperature, false);
});

test('calculateLowestCommonCapabilities handles all three capabilities together', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'full-support', temperature: true, reasoning: true, attachment: true },
    { id: 'partial-support', temperature: true, reasoning: false, attachment: true },
  ]);

  assert.equal(capabilities.supportsTemperature, true);
  assert.equal(capabilities.supportsReasoning, false);
  assert.equal(capabilities.supportsAttachment, true);
});

test('calculateLowestCommonCapabilities handles single model with undefined temperature', () => {
  const capabilities = calculateLowestCommonCapabilities([
    { id: 'no-temp-metadata', reasoning: true },
  ]);

  assert.equal(capabilities.supportsTemperature, undefined);
  assert.equal(capabilities.supportsReasoning, true);
});

// Task 18: Variant+Alias Integration Test
test('variant suffix stripping works with alias resolution end-to-end', async () => {
  const { stripVariantSuffix, resolveModelAlias, normalizeModelKey } = await import('../dist/src/models-dev.js');

  // Test variant suffix stripping
  const { base: base1, stripped: stripped1 } = stripVariantSuffix('gpt-4o-high');
  assert.equal(base1, 'gpt-4o');
  assert.equal(stripped1, true);

  const { base: base2, stripped: stripped2 } = stripVariantSuffix('claude-3-sonnet-low');
  assert.equal(base2, 'claude-3-sonnet');
  assert.equal(stripped2, true);

  const { base: base3, stripped: stripped3 } = stripVariantSuffix('gpt-4o');
  assert.equal(base3, 'gpt-4o');
  assert.equal(stripped3, false);

  // Test alias resolution on base name (variant suffix stripped first)
  const alias1 = resolveModelAlias('kimi-k2.6-thinking');
  assert.equal(alias1, 'kimi-k2-thinking');

  const alias2 = resolveModelAlias('kimi-k2.6-thinking-turbo');
  assert.equal(alias2, 'kimi-k2-thinking-turbo');

  // Test normalization removes preview suffix (variant is stripped separately)
  const normalized = normalizeModelKey('gpt-4o-preview');
  assert.equal(normalized, 'gpt-4o');
});

// Task 19: Subscription Fallback Test
test('subscription provider fallback enriches from public provider', async () => {
  const { getSubscriptionFallback } = await import('../dist/src/models-dev.js');

  // Test known subscription fallbacks
  assert.equal(getSubscriptionFallback('zai-coding-plan'), 'zai');
  assert.equal(getSubscriptionFallback('kimi-for-coding'), 'moonshotai');
  assert.equal(getSubscriptionFallback('github-models'), 'google');

  // Test case insensitivity
  assert.equal(getSubscriptionFallback('ZAI-CODING-PLAN'), 'zai');
  assert.equal(getSubscriptionFallback('GitHub-Models'), 'google');

  // Test unknown provider returns null
  assert.equal(getSubscriptionFallback('unknown-provider'), null);
});

test('groupVariantModels merges capability flags from all variants into synthetic base', () => {
  const [model] = groupVariantModels([
    {
      id: 'codex/gpt-5.5-high',
      name: 'GPT-5.5 High',
      contextWindow: 128000,
      maxTokens: 32000,
      supportsReasoning: true,
    },
    {
      id: 'codex/gpt-5.5-xhigh',
      name: 'GPT-5.5 XHigh',
      contextWindow: 256000,
      maxTokens: 64000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsAttachment: true,
    },
  ]);

  assert.equal(model.id, 'codex/gpt-5.5');
  assert.equal(model.contextWindow, 256000);
  assert.equal(model.maxTokens, 64000);
  assert.equal(model.supportsReasoning, true);
  assert.equal(model.supportsVision, true);
  assert.equal(model.supportsTools, true);
  assert.equal(model.supportsStreaming, true);
  assert.equal(model.supportsTemperature, true);
  assert.equal(model.supportsAttachment, true);
});

// Task 21: Normalization of snake_case and capabilities fields
test('normalizeModel reads snake_case fields', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'test/model-1',
              name: 'Test Model',
              context_length: 128000,
              max_output_tokens: 4096,
              capabilities: {
                vision: true,
                tool_calling: true,
                reasoning: true,
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, false);
  const model = models.find(m => m.id === 'test/model-1');

  assert.ok(model, 'Model should be found');
  assert.equal(model.contextWindow, 128000, 'Should read context_length');
  assert.equal(model.maxTokens, 4096, 'Should read max_output_tokens');
  assert.equal(model.supportsVision, true, 'Should read capabilities.vision');
  assert.equal(model.supportsTools, true, 'Should read capabilities.tool_calling');
  assert.equal(model.supportsReasoning, true, 'Should read capabilities.reasoning');
});

test('normalizeModel prefers camelCase over snake_case', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'test/model-2',
              contextWindow: 64000,
              context_length: 32000,
              capabilities: {
                vision: false,
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, false);
  const model = models.find(m => m.id === 'test/model-2');

  assert.ok(model, 'Model should be found');
  assert.equal(model.contextWindow, 64000, 'Should prefer camelCase over snake_case');
});

// Task 22: Deduplication of alias/canonical model entries
test('deduplication removes alias when canonical exists', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'ollamacloud/deepseek-v4',
              name: 'DeepSeek V4 (alias)',
              context_length: 64000,
            },
            {
              id: 'ollama-cloud/deepseek-v4',
              name: 'DeepSeek V4 (canonical)',
              context_length: 128000,
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, false);

  assert.equal(models.length, 1, 'Should deduplicate to single model');
  assert.equal(models[0].id, 'ollama-cloud/deepseek-v4', 'Should prefer canonical ID');
  assert.equal(models[0].contextWindow, 128000, 'Should use canonical metadata');
});

test('deduplication keeps alias when canonical is missing', async () => {
  global.fetch = async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              id: 'ollamacloud/deepseek-v4',
              name: 'DeepSeek V4',
              context_length: 64000,
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  const models = await fetchModels(CONFIG, CONFIG.apiKey, false);

  assert.equal(models.length, 1, 'Should keep single model');
  assert.equal(models[0].id, 'ollama-cloud/deepseek-v4', 'Should normalize to canonical ID');
});
