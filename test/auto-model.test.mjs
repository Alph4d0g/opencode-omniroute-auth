import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enrichAutoModel, isAutoModel } from '../dist/src/omniroute-combos.js';

test('isAutoModel matches bare "auto" and prefixed ids', () => {
  assert.equal(isAutoModel({ id: 'auto' }), true);
  assert.equal(isAutoModel({ id: 'omniroute/auto' }), true);
  assert.equal(isAutoModel({ id: 'auto-pilot' }), false);
  assert.equal(isAutoModel({ id: 'gpt-4o' }), false);
});

test('enrichAutoModel computes lowest-common capabilities from other models', () => {
  const models = [
    { id: 'auto', name: 'Auto' },
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxTokens: 16384,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsReasoning: false,
      supportsAttachment: true,
    },
    {
      id: 'anthropic/claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      supportsTemperature: true,
      supportsReasoning: true,
      supportsAttachment: true,
    },
  ];

  const result = enrichAutoModel(models);
  const auto = result.find((m) => m.id === 'auto');

  assert.equal(auto.contextWindow, 128000, 'context window should be the minimum across models');
  assert.equal(auto.maxTokens, 8192, 'max tokens should be the minimum across models');
  assert.equal(auto.supportsVision, true);
  assert.equal(auto.supportsTools, true);
  assert.equal(auto.supportsReasoning, true, 'reasoning should be true if any model supports it');
});

test('enrichAutoModel is a no-op when no auto model is present', () => {
  const models = [
    { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
  ];
  const result = enrichAutoModel(models);
  assert.deepEqual(result, models);
});

test('enrichAutoModel does not override explicit capabilities already provided', () => {
  const models = [
    { id: 'auto', name: 'Auto', contextWindow: 999999, maxTokens: 999 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384 },
  ];
  const result = enrichAutoModel(models);
  const auto = result.find((m) => m.id === 'auto');
  assert.equal(auto.contextWindow, 999999);
  assert.equal(auto.maxTokens, 999);
});

test('enrichAutoModel recalculates when only one capability field is missing', () => {
  const models = [
    { id: 'auto', name: 'Auto', maxTokens: 4096 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384 },
    { id: 'anthropic/claude-3-5-sonnet', name: 'Claude', contextWindow: 64000, maxTokens: 8192 },
  ];
  const result = enrichAutoModel(models);
  const auto = result.find((m) => m.id === 'auto');
  assert.equal(auto.contextWindow, 64000, 'should fill in missing context window from minimum');
  assert.equal(auto.maxTokens, 4096, 'should keep pre-existing maxTokens untouched');
});
