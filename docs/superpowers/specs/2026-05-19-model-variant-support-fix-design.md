# Model Variant Support Fix — Design Spec

**Date:** 2026-05-19  
**Author:** opencode-omniroute-auth maintainers  
**Approach:** Pipeline Injection (Approach A)  
**Status:** Approved for implementation

## 1. Problem Statement

When OmniRoute lists variant-suffixed models separately (e.g., `codex/gpt-5.5-xhigh`, `codex/gpt-5.5-high`), the plugin fails to group them under their base model. Instead, each variant appears as an independent top-level entry with incorrect generated variants (`{low, medium, high}`). This causes:

- Duplicate/confusing model entries in OpenCode's model picker
- Missing `xhigh` variant support
- Incorrect `getModelFamily()` output for provider-prefixed versioned models (returns `codex/gpt` instead of `gpt`)
- No synthetic base model creation when only variants are returned

## 2. Scope

This fix is **comprehensive** and includes:

1. **Variant grouping** — Merge variant-suffixed models under their base model ID
2. **xhigh support** — Add `'xhigh'` to the `reasoningEffort` type and generated variants
3. **Synthetic base models** — Create a base model from the first variant when no explicit base exists
4. **`getModelFamily()` fix** — Strip provider prefix before extracting family name
5. **Test isolation** — Clear model/model-dev caches between `plugin.test.mjs` tests

Out of scope:
- The pre-existing `fetchModelsDevData retries retryable HTTP failures` test failure (unrelated)

## 3. Architecture

### 3.1 Component Changes

| Unit | Change | Purpose |
|------|--------|---------|
| `src/models.ts` | Add `groupVariantModels()` + integrate in `fetchModels()` | Core grouping logic |
| `src/plugin.ts` | `toProviderModel()` uses `model.variants` if present; fix `getModelFamily()` | Correct variant generation + family extraction |
| `src/types.ts` | Add `variants?: Record<string, OmniRouteModelVariant>` to `OmniRouteModel`; add `'xhigh'` to `reasoningEffort` | Type support |
| `test/plugin.test.mjs` | Add two new tests + cache isolation in `afterEach` | Regression + behavior tests |

### 3.2 Data Flow (Pipeline)

```
/v1/models response
    ↓
[ {id: 'codex/gpt-5.5', ...},
  {id: 'codex/gpt-5.5-high', ...},
  {id: 'codex/gpt-5.5-xhigh', ...},
  {id: 'openai/gpt-4o', ...} ]
    ↓ normalizeModel()
    ↓ deduplicateModels()
    ↓ groupVariantModels()  ← NEW
[ {id: 'codex/gpt-5.5', variants: {high: {...}, xhigh: {...}}, ...},
  {id: 'openai/gpt-4o', variants: {}, ...} ]
    ↓ enrichModelMetadata()
    ↓ toProviderModels()
```

## 4. Detailed Design

### 4.1 `groupVariantModels()` (`src/models.ts`)

Pure function signature:

```typescript
export function groupVariantModels(models: OmniRouteModel[]): OmniRouteModel[]
```

**Algorithm:**

1. Pass 1 — Categorize: Iterate input models. For each model:
   - Call `stripVariantSuffix(model.id)` to detect if it is a variant (e.g., `gpt-5.5-xhigh` → base=`gpt-5.5`, stripped=true)
   - If not a variant: store in `realBaseModels` Map (key=model.id)
   - If variant: store in `variantMap` Map (key=baseId, value=array of `{suffix, model}`)

2. Pass 2 — Build result:
   - Add all real base models that have **no** variants (unchanged)
   - For each base ID that **has** variants:
     - Use real base model if available; otherwise create synthetic base from first variant (copy all fields, set `id=baseId`, `name=baseId`)
     - Build `variants` Record: for each detected suffix, create `{reasoningEffort: lowerSuffix}` entry
     - Merge metadata from all variants into base: use **max** `contextWindow` and **max** `maxTokens`
     - Set `supportsReasoning = true` if any variant supports it
     - Push merged model into result

**Invariants:**
- No variant-suffixed model ID appears as a top-level entry in the output
- Every base ID with variants gets a `variants` field containing all detected suffixes
- Synthetic bases are never created when a real base exists

### 4.2 Pipeline Integration (`src/models.ts`)

Insert `groupVariantModels()` between `deduplicateModels()` and `enrichModelMetadata()` inside `fetchModels()`:

```typescript
const dedupedModels = deduplicateModels(rawModels);
const groupedModels = groupVariantModels(dedupedModels);  // NEW
const models = await enrichModelMetadata(groupedModels, config);
```

### 4.3 `toProviderModel()` Variants Logic (`src/plugin.ts`)

Replace the unconditional `{low, medium, high}` generation with a priority check:

```typescript
variants: model.variants && Object.keys(model.variants).length > 0
  ? model.variants
  : supportsReasoning
    ? {
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' },
      }
    : {},
```

If `model.variants` was pre-populated by `groupVariantModels()`, use it directly. Otherwise fall back to the existing default for reasoning models.

### 4.4 `getModelFamily()` Fix (`src/plugin.ts`)

Current broken behavior: `getModelFamily('codex/gpt-5.5-xhigh')` → `'codex/gpt'`

Fix: Strip provider prefix before splitting:

```typescript
function getModelFamily(modelId: string): string {
  const withoutProvider = modelId.includes('/') ? modelId.split('/').pop()! : modelId;
  const [family] = withoutProvider.split('-');
  return family || withoutProvider;
}
```

Fixed behavior: `getModelFamily('codex/gpt-5.5-xhigh')` → `'gpt'`

### 4.5 Type Changes (`src/types.ts`)

Add to `OmniRouteModel`:

```typescript
variants?: Record<string, OmniRouteModelVariant>;
```

Update `OmniRouteModelVariant`:

```typescript
export interface OmniRouteModelVariant {
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  [key: string]: unknown;
}
```

## 5. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Only variants returned, no base model | Create synthetic base from first variant; base ID = stripped suffix |
| Base model + variants both returned | Use real base; merge variant metadata (max limits) |
| Non-reasoning suffix (e.g., `-preview`) | `stripVariantSuffix()` ignores it; no grouping triggered |
| Empty variants map | Falls through to existing `supportsReasoning` logic |
| Mixed provider prefixes post-dedup | Dedup resolves aliases to canonical first; grouping operates on canonical IDs |
| Multiple variants with different limits | Base model inherits **highest** `contextWindow` and `maxTokens` |
| Variant without `supportsReasoning=true` | Still grouped; `supportsReasoning` on base becomes `true` if **any** variant has it |

## 6. Testing

### 6.1 New Tests (`test/plugin.test.mjs`)

**Test 1: `provider hook groups variant models under base model`**

- Mock `/v1/models` returning:
  - `codex/gpt-5.5` (supportsReasoning: true)
  - `codex/gpt-5.5-high` (supportsReasoning: true)
  - `codex/gpt-5.5-xhigh` (supportsReasoning: true, contextWindow: 256000)
  - `openai/gpt-4o` (supportsReasoning: false)

- Assertions:
  - `result['codex/gpt-5.5']` exists
  - `result['codex/gpt-5.5'].variants.high` exists
  - `result['codex/gpt-5.5'].variants.xhigh` exists
  - `result['codex/gpt-5.5-high']` is `undefined`
  - `result['codex/gpt-5.5-xhigh']` is `undefined`
  - `result['openai/gpt-4o']` exists with empty variants object

**Test 2: `provider hook creates synthetic base model when only variants are returned`**

- Mock `/v1/models` returning:
  - `codex/gpt-5.5-high` (contextWindow: 128000)
  - `codex/gpt-5.5-xhigh` (contextWindow: 256000)

- Assertions:
  - `result['codex/gpt-5.5']` exists as synthetic base
  - `result['codex/gpt-5.5'].variants.high` and `.xhigh` exist
  - `result['codex/gpt-5.5'].limit.context === 256000` (highest from variants)
  - No separate `codex/gpt-5.5-high` or `codex/gpt-5.5-xhigh` entries

### 6.2 Test Infrastructure Fix

Add to `plugin.test.mjs` imports:

```javascript
import { clearModelCache } from '../dist/runtime.js';
import { clearModelsDevCache } from '../dist/src/models-dev.js';
```

Update `afterEach`:

```javascript
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.HOME = ORIGINAL_HOME;
  clearModelCache();        // NEW
  clearModelsDevCache();    // NEW
});
```

This prevents cross-test contamination from mutable in-memory caches.

## 7. Files Changed

| File | Lines (approx) | Purpose |
|------|---------------|---------|
| `src/models.ts` | ~100 new | `groupVariantModels()` + pipeline integration |
| `src/plugin.ts` | ~10 modified | Variant generation priority + `getModelFamily()` fix |
| `src/types.ts` | ~5 modified | `variants` field + `'xhigh'` type |
| `test/plugin.test.mjs` | ~60 new | Two new tests + cache isolation |

Note: `test/models-dev.test.mjs` already exists on the branch and has proper cache isolation via `clearModelsDevCache()` in its own `afterEach`.

## 8. Verification

After implementation, the full test suite should show:

- 50+ existing tests pass (the suite includes `test/logger.test.mjs`, `test/models.test.mjs`, `test/models-dev.test.mjs`, and `test/plugin.test.mjs`)
- 2 new tests pass (variant grouping + synthetic base)
- `npm run build` succeeds with zero TypeScript errors
- `npm run check:exports` succeeds

## 9. Future Work (Out of Scope)

- Support additional variant suffixes beyond reasoning effort (e.g., `-fast`, `-latest`)
- Cache key versioning for grouped model caches
- Retry logic for `fetchModelsDevData` (address the pre-existing test failure separately)
