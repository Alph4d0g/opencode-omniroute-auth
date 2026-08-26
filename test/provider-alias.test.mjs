import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveProviderAlias } from '../dist/src/models-dev.js';

test('resolveProviderAlias maps gh/github to github-copilot, not google', () => {
  assert.equal(resolveProviderAlias('gh'), 'github-copilot');
  assert.equal(resolveProviderAlias('github'), 'github-copilot');
  assert.equal(resolveProviderAlias('GH'), 'github-copilot');
  assert.equal(resolveProviderAlias('GitHub'), 'github-copilot');
});

test('resolveProviderAlias still maps gemini/google to google', () => {
  assert.equal(resolveProviderAlias('gemini'), 'google');
  assert.equal(resolveProviderAlias('google'), 'google');
});

test('resolveProviderAlias allows user config to override defaults', () => {
  assert.equal(
    resolveProviderAlias('gh', { modelsDev: { providerAliases: { gh: 'custom-provider' } } }),
    'custom-provider',
  );
});

test('resolveProviderAlias falls back to the lowercased key when unknown', () => {
  assert.equal(resolveProviderAlias('SomeUnknownProvider'), 'someunknownprovider');
});

test('resolveProviderAlias returns null for null input', () => {
  assert.equal(resolveProviderAlias(null), null);
});
