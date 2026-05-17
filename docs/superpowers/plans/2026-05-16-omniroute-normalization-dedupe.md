# OmniRoute Model Normalization & Deduplication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address PR review claims by normalizing OmniRoute native metadata and deduplicating alias/canonical model entries.

**Architecture:** Update `normalizeModel()` to read all OmniRoute field variants (snake_case, camelCase, capabilities object), then add a generic deduplication step that groups by canonical provider+model key and prefers canonical-prefixed IDs. Normalization happens before models.dev enrichment so no metadata is lost.

**Tech Stack:** TypeScript ESM, Node.js native test runner

---

## File Structure

**Modified files:**
- `src/types.ts` — Add `capabilities` and snake_case fields to `OmniRouteModel`
- `src/models.ts` — Update `normalizeModel()`, add `deduplicateModels()`, wire into `fetchModels()`
- `src/constants.ts` — Add provider alias-to-canonical mapping
- `test/models.test.mjs` — Tests for normalization and deduplication

---

## Chunk 1: Extend Types for OmniRoute Native Fields

### Task 1: Add OmniRoute Native Fields to OmniRouteModel

**Files:**
- Modify: `src/types.ts:25-50` (OmniRouteModel interface)

**Issue:** Current `OmniRouteModel` only has camelCase fields, misses OmniRoute's snake_case and `capabilities` object.

- [ ] **Step 1: Update OmniRouteModel interface**

```typescript
export interface OmniRouteModel {
  id: string;
  name: string;
  description?: string;
  
  // OmniRoute native fields (camelCase from API)
  contextWindow?: number;
  maxTokens?: number;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsTemperature?: boolean;
  supportsReasoning?: boolean;
  supportsAttachment?: boolean;
  
  // OmniRoute native fields (snake_case from API)
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  
  // OmniRoute capabilities object
  capabilities?: {
    vision?: boolean;
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    attachment?: boolean;
    temperature?: boolean;
  };
  
  // Enriched fields from models.dev
  temperature?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  tool_call?: boolean;
}
```

- [ ] **Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "types: add OmniRoute native fields (snake_case, capabilities) to OmniRouteModel"
```

---

## Chunk 2: Update normalizeModel to Read All Field Variants

### Task 2: Comprehensive Model Normalization

**Files:**
- Modify: `src/models.ts:123-144` (normalizeModel in fetchModels)

**Issue:** Current normalization only reads camelCase fields, ignores snake_case and capabilities object.

- [ ] **Step 1: Extract normalizeModel as standalone function**

Add before `fetchModels`:

```typescript
function normalizeModel(model: OmniRouteModel): OmniRouteModel {
  const capabilities = model.capabilities && typeof model.capabilities === 'object'
    ? model.capabilities
    : {};

  return {
    ...model,
    id: model.id,
    name: model.name || model.id,
    description: model.description || `OmniRoute model: ${model.id}`,
    
    // Context limits: prefer explicit camelCase, fallback to snake_case
    contextWindow: model.contextWindow ?? model.context_length ?? model.max_input_tokens,
    maxTokens: model.maxTokens ?? model.max_output_tokens,
    
    // Capabilities: prefer explicit camelCase, fallback to capabilities object, fallback to snake_case
    supportsStreaming: model.supportsStreaming,
    supportsVision: model.supportsVision ?? model.vision ?? capabilities.vision ?? capabilities.attachment,
    supportsTools: model.supportsTools ?? model.tool_calling ?? capabilities.tool_calling ?? capabilities.toolcall,
    supportsReasoning: model.supportsReasoning ?? model.reasoning ?? capabilities.reasoning ?? capabilities.thinking,
    supportsAttachment: model.supportsAttachment ?? model.attachment ?? capabilities.attachment,
    supportsTemperature: model.supportsTemperature ?? model.temperature ?? capabilities.temperature,
  };
}
```

- [ ] **Step 2: Update fetchModels to use normalizeModel**

Replace the inline map with:
```typescript
.map(normalizeModel)
```

- [ ] **Step 3: Build and test**

Run: `npm run build`
Expected: No errors

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/models.ts src/types.ts
git commit -m "feat: normalize all OmniRoute field variants (snake_case, capabilities)"
```

---

## Chunk 3: Generic Model Deduplication

### Task 3: Create Provider Alias Map

**Files:**
- Modify: `src/constants.ts`

**Issue:** Need to know which provider prefixes are aliases so we can deduplicate.

- [ ] **Step 1: Add provider alias-to-canonical mapping**

```typescript
export const PROVIDER_ALIAS_TO_CANONICAL: Record<string, string> = {
  'ollamacloud': 'ollama-cloud',
  'cc': 'claude',
  'gh': 'github',
  'cx': 'codex',
  'kr': 'kiro',
  'if': 'qoder',
};
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add provider alias-to-canonical mapping for deduplication"
```

---

### Task 4: Implement Generic Deduplication

**Files:**
- Modify: `src/models.ts` — Add `deduplicateModels()` function

**Issue:** Alias-prefixed models appear alongside canonical-prefixed ones.

- [ ] **Step 1: Add deduplicateModels function**

Add after `normalizeModel`:

```typescript
function deduplicateModels(models: OmniRouteModel[]): OmniRouteModel[] {
  const seen = new Map<string, OmniRouteModel>();
  
  for (const model of models) {
    const parts = model.id.split('/');
    if (parts.length !== 2) {
      // Not a provider/model ID, keep as-is
      seen.set(model.id, model);
      continue;
    }
    
    const [providerPrefix, modelKey] = parts;
    const canonicalPrefix = PROVIDER_ALIAS_TO_CANONICAL[providerPrefix] || providerPrefix;
    const canonicalId = `${canonicalPrefix}/${modelKey}`;
    
    const existing = seen.get(canonicalId);
    if (!existing) {
      // First time seeing this model - store with canonical ID
      seen.set(canonicalId, {
        ...model,
        id: canonicalId,
      });
    } else {
      // Already have canonical version - merge metadata, prefer non-alias
      const isAlias = providerPrefix !== canonicalPrefix;
      if (!isAlias) {
        // This is the canonical version, overwrite alias
        seen.set(canonicalId, {
          ...model,
          id: canonicalId,
        });
      }
      // If alias and we already have canonical, drop it
    }
  }
  
  return [...seen.values()];
}
```

- [ ] **Step 2: Wire deduplication into fetchModels**

After normalization, before enrichment:
```typescript
const rawModels = data.data
  .filter(...)
  .map(normalizeModel);

const dedupedModels = deduplicateModels(rawModels);

// Enrich with models.dev and combo capabilities
const models = await enrichModelMetadata(dedupedModels, config);
```

- [ ] **Step 3: Build and test**

Run: `npm run build`
Expected: No errors

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/models.ts src/constants.ts
git commit -m "feat: deduplicate alias/canonical model entries, prefer canonical form"
```

---

## Chunk 4: Test Coverage

### Task 5: Test Normalization of All Field Variants

**Files:**
- Modify: `test/models.test.mjs`

- [ ] **Step 1: Add test for snake_case field normalization**

```javascript
test('normalizeModel reads snake_case fields', () => {
  // We can't test normalizeModel directly (it's private), so test via fetchModels
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
```

- [ ] **Step 2: Add test for camelCase fallback**

```javascript
test('normalizeModel prefers camelCase over snake_case', () => {
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
```

- [ ] **Step 3: Commit**

```bash
git add test/models.test.mjs
git commit -m "test: verify normalization of snake_case and capabilities fields"
```

---

### Task 6: Test Deduplication

**Files:**
- Modify: `test/models.test.mjs`

- [ ] **Step 1: Add test for alias deduplication**

```javascript
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
```

- [ ] **Step 2: Add test for dedupe with only alias present**

```javascript
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
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add test/models.test.mjs
git commit -m "test: verify deduplication of alias/canonical model entries"
```

---

## Chunk 5: Final Verification

### Task 7: Full Build and Test

- [ ] **Step 1: Clean build**

Run: `npm run clean && npm run build`
Expected: Success

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (target: 42+ tests)

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Verify no regressions**

Check that existing tests still pass and no functionality was broken.

- [ ] **Step 5: Final commit summary**

```bash
git log --oneline -25
```

---

## Summary

**Total tasks:** 7 (5 code + 2 test + 1 verification)
**Estimated commits:** 7
**Estimated time:** 1-2 hours

### Changes Summary:
1. **Types** — Added snake_case fields and capabilities object to OmniRouteModel
2. **Normalization** — normalizeModel now reads all field variants with proper precedence
3. **Constants** — Added PROVIDER_ALIAS_TO_CANONICAL mapping
4. **Deduplication** — Generic dedupe algorithm that prefers canonical IDs
5. **Tests** — Coverage for normalization and deduplication edge cases

### Key Decisions:
- camelCase fields take precedence over snake_case (consistent with existing code)
- capabilities object takes precedence over top-level snake_case fields
- Deduplication normalizes alias IDs to canonical form even when canonical is missing
- Merge strategy: prefer canonical metadata over alias metadata
