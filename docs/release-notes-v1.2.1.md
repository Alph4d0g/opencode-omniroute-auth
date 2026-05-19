# Release v1.2.1

## Highlights

- **Model Variant Support Fix** — Variant-suffixed models (e.g., `codex/gpt-5.5-xhigh`, `codex/gpt-5.5-high`) are now grouped under their base model ID instead of appearing as duplicate top-level entries. Includes synthetic base model creation, `xhigh` variant support, and `getModelFamily()` fix for provider-prefixed versioned models.
- **models.dev enrichment no longer fails on transient network slowness.** The fetch pipeline now retries up to 3 times with exponential backoff and falls back to stale cached data if live refresh fails.
- **Default context limit corrected** from 4096 to 128000 tokens to match OmniRoute API behavior.
- **Structured observability** for enrichment failures with per-attempt diagnostics and fallback decisions.

## What Changed

### Reliability

- `fetchModelsDevData()` now uses a bounded retry loop:
  - Maximum 3 attempts with 250ms / 500ms backoff.
  - Retries on: timeouts (`AbortError`), network errors, HTTP 429, and HTTP 5xx.
  - Fail-fast on: HTTP 4xx (non-429) and structurally invalid responses.
- Stale in-memory cache fallback:
  - If cached data exists but TTL expired, live refresh is attempted first.
  - If all refresh attempts fail, the stale cached data is returned instead of `null`.
  - If no cache exists and all attempts fail, returns `null` (safe fail-open).
- Timeout budget increased from 1000ms to 5000ms per attempt.
- Failure classification: `timeout`, `network`, `http_retryable`, `http_non_retryable`, `parse`, `invalid_structure`.

### Model Variant Support Fix

**Problem:** When OmniRoute lists variant-suffixed models separately (e.g., `codex/gpt-5.5-xhigh`, `codex/gpt-5.5-high`), each variant appeared as an independent top-level entry with incorrect generated variants (`{low, medium, high}`), causing duplicate/confusing model entries in OpenCode's model picker.

**Solution:**
- Added `groupVariantModels()` in `src/models.ts` — a pure two-pass algorithm that:
  1. **Categorizes** models into real bases and variants using `stripVariantSuffix()`
  2. **Builds result**: real bases pass through unchanged; for each base with variants, merges all variants under the base model with a `variants` Record
  3. **Synthetic bases**: when only variants are returned (no explicit base), creates a synthetic base from the first variant, copying all fields and setting `id`/`name` to the stripped base ID
  4. **Metadata merging**: base inherits **max** `contextWindow`, **max** `maxTokens`, and the union of supported capability flags across all variants
- Integrated into `fetchModels()` pipeline: `normalizeModel` → `deduplicateModels` → `groupVariantModels` → `enrichModelMetadata` → `toProviderModels`
- Fixed `toProviderModel()` in `src/plugin.ts` to prioritize pre-populated `model.variants` over generated `{low, medium, high}` defaults
- Added `'xhigh'` to `OmniRouteModelVariant.reasoningEffort` type and generated variants

**Edge Cases Handled:**
| Scenario | Behavior |
|----------|----------|
| Only variants returned, no base model | Creates synthetic base from first variant |
| Base model + variants both returned | Uses real base; merges variant metadata (max limits) |
| Non-reasoning suffix (e.g., `-preview`) | `stripVariantSuffix()` ignores it; no grouping |
| Mixed provider prefixes post-dedup | Grouping operates on canonical IDs |
| Variant without `supportsReasoning=true` | Still grouped; base becomes `true` if any variant has it |

### Fixes

- `DEFAULT_CONTEXT_LIMIT` corrected from `4096` to `128000`.
- **`getModelFamily()` for Provider-Prefixed Models** — Fixed incorrect family extraction for versioned models with provider prefixes. `getModelFamily('codex/gpt-5.5-xhigh')` now correctly returns `'gpt'` (was `'codex/gpt'`).

### Code Review Fixes

- **Cache Isolation** — `modelsDevCache` is now keyed by URL (`Map<string, ModelsDevCache>`) to prevent cross-config data leakage when different configs specify different `modelsDev.url` values.
- **JSDoc Accuracy** — `OmniRouteModelsDevConfig.timeoutMs` JSDoc updated to reflect the new `5000ms` default.
- **Lockfile Sync** — `package-lock.json` version aligned with `package.json` (`1.2.1`).
- **Test Suite Speed** — Eliminated real `setTimeout` sleeps from `test/models-dev.test.mjs` by using `cacheTtl: 0` for stale-cache tests. Reduces test runtime and improves scalability.
- **Latency Documentation** — Explicit JSDoc added on `fetchModelsDevData()` documenting worst-case cold-start latency (~15.75s) as an accepted reliability trade-off.
- **models.dev Structural Validation** — Fetched models.dev payloads now validate provider entries and nested `models` records before accepting data, preventing malformed upstream objects from entering cache/index paths.
- **Variant Capability Union** — Grouped variants now merge `supportsVision`, `supportsTools`, `supportsStreaming`, `supportsTemperature`, and `supportsAttachment` into the base model when any variant advertises those capabilities.

### Testing

- Added 9 focused tests in `test/models-dev.test.mjs` covering all retry, cache, fallback, and malformed-provider validation paths.
- Added 1 unit test in `test/models.test.mjs` covering capability union across grouped variants.
- Added 2 regression tests in `test/plugin.test.mjs` for variant grouping and synthetic base model creation.
- Added cache isolation (`clearModelCache()`, `clearModelsDevCache()`) to `test/plugin.test.mjs` `afterEach` to prevent cross-test contamination.
- Full regression suite: 54/54 tests pass (0 failures).

### Documentation

- Internal `docs/superpowers/` planning/spec artifacts are kept local only and are excluded from the GitHub repository.

## Verification

- `npm run prepublishOnly` passes (`clean`, `build`, `check:exports`).
- `npm test` passes: 54 tests, 0 failures.
- TypeScript strict mode compiles cleanly.

## Upgrade Notes

- No breaking changes. Plugin behavior remains safe when `models.dev` is fully unavailable.
- Existing `modelsDev.timeoutMs` and `modelsDev.cacheTtl` config options continue to work as before.
