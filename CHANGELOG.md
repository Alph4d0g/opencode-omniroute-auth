# Changelog

All notable changes to this project are documented in this file.

## [1.2.2] - 2026-05-22

### Added

- **Consolidated Agent Guidelines** — Merged `CLAUDE.md` and `AGENTS.md` into a single canonical `AGENTS.md` file. `CLAUDE.md` is now a symlink to `AGENTS.md` so both Claude Code and other agents read from the same source.
- **Release Process Documentation** — Added complete release process steps to `AGENTS.md` (version bump, changelog, tag, GitHub release, npm publish, verification).

### Fixed

- **Model Metadata Overrides for Provider Models** — Fixed model metadata overrides not being applied to provider models returned by the `provider` hook. (`src/plugin.ts`) (@Alph4d0g)

## [1.2.1] - 2026-05-19

### Added

- **models.dev Reliability Pipeline** — Complete rewrite of `fetchModelsDevData()` with production-grade resilience:
  - Bounded retry loop (max 3 attempts) with exponential backoff (250ms, 500ms).
  - Structured failure classification into 6 categories: `timeout`, `network`, `http_retryable`, `http_non_retryable`, `parse`, `invalid_structure`.
  - Stale in-memory cache fallback: if live refresh fails, previously cached enrichment data is returned instead of skipping enrichment entirely.
  - Fail-open cold-start behavior: returns `null` only when no cache exists and all attempts fail, preserving plugin functionality.
  - Per-attempt structured logging: attempt number, failure class, HTTP status (when applicable), and elapsed duration.
  - Success logging: total elapsed duration and provider count for observability.
  - Timeout increase: default per-attempt timeout raised from 1000ms to 5000ms.
- **9 New Test Cases** (`test/models-dev.test.mjs`) covering:
  - Fresh cache hit (no redundant network call)
  - Timeout recovery on retry
  - 503 retryable HTTP failure recovery
  - Stale cache fallback when all refresh attempts fail
  - Null return on cold-start total failure
  - 404 fail-fast behavior (no unnecessary retries)
  - Invalid response structure with stale cache fallback
  - Malformed provider entry rejection before cache update
  - End-to-end integration with `getModelsDevIndex()`
- **Model Variant Support Fix** — Comprehensive fix for variant-suffixed models (e.g., `codex/gpt-5.5-xhigh`, `codex/gpt-5.5-high`):
  - Added `groupVariantModels()` in `src/models.ts` — pure two-pass algorithm that merges variant-suffixed models under their base model ID
  - Added `variants?: Record<string, OmniRouteModelVariant>` to `OmniRouteModel` interface in `src/types.ts`
  - Extended `OmniRouteModelVariant.reasoningEffort` to include `'xhigh'` (was `'low' | 'medium' | 'high'`)
  - Synthetic base model creation: when only variants are returned (no explicit base), creates a synthetic base from the first variant with merged metadata (max `contextWindow`, max `maxTokens`, unioned capability flags)
  - Pipeline integration: `fetchModels()` now flows `normalizeModel` → `deduplicateModels` → `groupVariantModels` → `enrichModelMetadata` → `toProviderModels`
  - `toProviderModel()` in `src/plugin.ts` now prioritizes pre-populated `model.variants` over generated `{low, medium, high}` defaults
- **Test Cache Isolation** (`test/plugin.test.mjs`) — Added `clearModelCache()` and `clearModelsDevCache()` to `afterEach` to prevent cross-test contamination from mutable in-memory caches
- **2 New Regression Tests** (`test/plugin.test.mjs`) covering variant grouping and synthetic base model creation
- **1 New Regression Test** (`test/models.test.mjs`) covering capability union across grouped variants

### Fixed

- **Default Context Limit** — `DEFAULT_CONTEXT_LIMIT` corrected from `4096` to `128000` to match actual OmniRoute API defaults.
- **getModelFamily() for Provider-Prefixed Models** — Fixed incorrect family extraction for versioned models with provider prefixes. Before: `getModelFamily('codex/gpt-5.5-xhigh')` → `'codex/gpt'`. After: → `'gpt'`. Implementation now strips provider prefix before splitting on `-`.

### Changed

- **Internal Helpers** — Extracted `fetchModelsDevOnce()`, `shouldRetryModelsDevFailure()`, and `sleep()` helpers in `src/models-dev.ts` to keep retry logic isolated from lookup/index logic.

### Removed

- **Test Config Artifacts** — Removed `.opencode/config.json` and `.opencode/opencode.json` files that were committed accidentally.

### Fixed (Code Review)

- **Cache Isolation** — `modelsDevCache` is now keyed by URL (`Map<string, ModelsDevCache>`) instead of a single global variable. Prevents cross-config data leakage when different configs specify different `modelsDev.url` values. (`src/models-dev.ts`)
- **JSDoc Accuracy** — Updated `OmniRouteModelsDevConfig.timeoutMs` JSDoc comment from `(default: 1000ms)` to `(default: 5000ms)` to match the actual constant. (`src/types.ts`)
- **Lockfile Version Sync** — Updated `package-lock.json` version from `1.2.0` to `1.2.1` to match `package.json`. (`package-lock.json`)
- **Test Suite Speed** — Eliminated real `setTimeout` sleeps from `test/models-dev.test.mjs` by using `cacheTtl: 0` to mark cache immediately stale instead of waiting for TTL expiry. Reduces test runtime and improves scalability.
- **Latency Documentation** — Added explicit JSDoc on `fetchModelsDevData()` documenting worst-case cold-start latency (~15.75s) as an accepted reliability trade-off per design spec. (`src/models-dev.ts`)
- **models.dev Structural Validation** — Added runtime validation for provider entries and nested `models` records before accepting fetched models.dev data. Prevents malformed upstream objects from being cached or indexed. (`src/models-dev.ts`)
- **Variant Capability Union** — Grouped variant models now merge `supportsVision`, `supportsTools`, `supportsStreaming`, `supportsTemperature`, and `supportsAttachment` into the base model when any variant supports them. (`src/models.ts`)

## [1.2.0] - 2026-05-17

### Added

- **Comprehensive Model Metadata Normalization** — `normalizeModel()` now reads all OmniRoute field variants with proper precedence:
  - camelCase fields (e.g., `contextWindow`, `supportsVision`)
  - snake_case fields (e.g., `context_length`, `max_output_tokens`)
  - capabilities object (e.g., `capabilities.vision`, `capabilities.tool_calling`)
  - Precedence: camelCase > snake_case > capabilities object
- **Provider Alias Deduplication** — Generic deduplication system that groups alias and canonical model entries:
  - Added `PROVIDER_ALIAS_TO_CANONICAL` mapping for known aliases (`cx` → `codex`, `ollamacloud` → `ollama-cloud`, etc.)
  - Added `deduplicateModels()` function that prefers canonical IDs and merges alias metadata
  - Added `resolveProviderAliasForMetadata()` and `isProviderAlias()` helpers
  - Only deduplicates known aliases; unknown provider prefixes are preserved as-is
- **Model Capability Enrichment** — Extended `OmniRouteModel` interface with native OmniRoute fields:
  - snake_case context limits: `context_length`, `max_input_tokens`, `max_output_tokens`
  - Top-level capability flags: `vision`, `tool_calling`
  - capabilities object: `vision`, `tool_calling`, `reasoning`, `thinking`, `attachment`, `temperature`
- **Array-based Metadata Validation** — User-provided `modelMetadata` array blocks are now validated with warning logs for invalid entries
- **4 New Test Cases** covering normalization precedence, snake_case field reading, and deduplication behavior

### Changed

- **Array Metadata Merge Precedence** — In array-based `modelMetadata`, user config now comes before generated blocks to ensure user overrides take precedence in first-match-wins systems
- **Metadata Key Canonicalization** — User metadata with alias keys (e.g., `cx/gpt-5.5`) is merged into canonical keys (e.g., `codex/gpt-5.5`) to match deduplicated model IDs
- **Unknown Prefix Handling** — Unknown provider prefixes now merge metadata instead of overwriting, preserving all available metadata

### Fixed

- **Dead Code Removal** — Eliminated unreachable `isAlias` check in deduplication logic
- **Alias Metadata Loss** — Alias metadata is now merged into canonical entries instead of being dropped
- **Review Feedback** — Addressed all gemini-code-assist review comments from PR #20:
  - Fixed array-based metadata merge precedence (userConfig first)
  - Added validation for array-based user metadata blocks
  - Fixed metadata merging for unknown provider prefixes
  - Simplified deduplication logic and merged alias metadata into canonical

## [1.1.4] - 2026-05-15

### Added

- Added `provider` hook for OpenCode >=1.14.49 model listing API (`ProviderHook`), enabling dynamic model fetching when authentication is available. (@kkMihai)
- Added `ProviderHook`, `ProviderHookContext`, `ProviderV2`, and `ModelV2` type definitions matching the `@opencode-ai/plugin` v1.14.50 API. (@kkMihai)
- Added 3 regression tests covering provider hook behavior: live model fetch with auth, fallback without auth, and error recovery. (@kkMihai)
- Added `createMockFetch()` test helper to isolate `/v1/models` call counting from enrichment endpoint mocks. (@kkMihai)

### Fixed

- Fixed model picker only showing 4 hardcoded fallback models on OpenCode >=1.14.49 by supplying models through the new `provider` hook `models` callback. (@kkMihai)
- Fixed stale `provider.models` fallback in no-auth branch of provider hook to always return plugin-native defaults with correct `api.url` and `providerID` metadata. (@Alph4d0g)
- Fixed misleading comment in fetch-failure recovery test to accurately describe the code path. (@Alph4d0g)

### Changed

- Improved test coverage for unauthenticated state to explicitly verify that stale host-provided models are ignored. (@Alph4d0g)
- Improved formatting consistency in type definitions. (@Alph4d0g)

## [1.1.3] - 2026-05-15

### Added

- Added proper logger module (`src/logger.ts`) that writes to OpenCode's log file instead of the console.
  - `warn()` always writes; `debug()` only writes when `OMNIROUTE_DEBUG=1`.
  - Finds the most recent `.log` file in `~/.local/share/opencode/log/` by `mtime`.
  - Re-scans for new log files when the cached file is deleted (log rotation support).
  - Silently fails on all I/O errors — never crashes the plugin.
- Added 13 unit tests for the logger module (`test/logger.test.mjs`).

### Changed

- Replaced all 46 `console.log`/`console.warn`/`console.error` calls across 4 source files with the new logger:
  - `src/plugin.ts` (13 calls)
  - `src/models.ts` (11 calls)
  - `src/models-dev.ts` (7 calls)
  - `src/omniroute-combos.ts` (15 calls)
- Log format now matches OpenCode's native format: `WARN  2026-05-14T12:34:56.789Z +0ms service=omniroute <message>`.

### Fixed

- Fixed 2 pre-existing failing model cache tests that were incorrectly counting all `fetch` calls instead of only `/v1/models` calls.

## [1.1.2] - 2026-05-13

### Fixed

- Fixed model picker only showing fallback models on OpenCode >=1.14.47 by eagerly fetching live models in the `config` hook before OpenCode reads `provider.models`. (@jms830)
- Refactored `createRuntimeConfig` to accept `options` directly for reuse across both `config` and `loader` hooks.

### Added

- Added `readAuthFromStore()` helper to read the stored OmniRoute API key from `~/.local/share/opencode/auth.json` during the `config` hook.
- Added regression test for eager model fetching in the config hook.

## [1.1.1] - 2026-05-12

### Fixed

- Fixed combo model processing when the API returns model entries as objects instead of strings in the `models` array. (@hjasgr)
- Hardened `resolveUnderlyingModels` against null/undefined entries and missing properties with runtime type narrowing.

### Changed

- Updated `OmniRouteCombo.models` type to accept objects from the API.

## [1.1.0] - 2026-03-10

### Added

- Added models.dev capability enrichment for OmniRoute models via `provider.omniroute.options.modelsDev`.
- Added combo model support with automatic lowest-common-denominator capability calculation from `/api/combos`.
- Added `modelMetadata` configuration option for custom/virtual model overrides via `provider.omniroute.options.modelMetadata`.
- Added new runtime exports: `clearModelsDevCache`, `clearComboCache`, `fetchComboData`, `resolveUnderlyingModels`, `calculateModelCapabilities`.
- Added provider alias mapping (e.g., `cx` → `openai`, `gemini` → `google`) for models.dev lookups.

### Changed

- Updated `fetchModels` to orchestrate enrichment pipeline (models.dev → combo capabilities).
- Updated `clearModelCache` to also clear the combo cache.
- Updated README with combo model documentation and new runtime API references.

## [1.0.3] - 2026-03-01

### Added

- Added dual provider API mode support (`chat` and `responses`) through `provider.omniroute.options.apiMode`.
- Added `OmniRouteApiMode` type and re-exported it for consumers.
- Added `OMNIROUTE_ENDPOINTS.RESPONSES` constant.
- Added `runtime` subpath export (`opencode-omniroute-auth/runtime`) for helper APIs and runtime constants.
- Added export validation script (`check:exports`) to enforce plugin-loader-safe root exports before publish.
- Added release planning and handover documentation (`docs/responses-api-evaluation-plan.md`, `docs/session-handover.md`).

### Changed

- Changed provider bootstrap logic to normalize and validate `apiMode` values, defaulting invalid values to `chat` with warnings.
- Changed package root runtime export shape to plugin-only exports (`default` + `OmniRouteAuthPlugin`) for OpenCode loader compatibility.
- Changed programmatic helper import path from package root to `opencode-omniroute-auth/runtime`.
- Updated README configuration and troubleshooting documentation to cover `apiMode`, npm plugin loading behavior, and runtime helper import path.
- Updated TypeScript build config to include `runtime.ts`.

### Fixed

- Fixed npm plugin loading failure outside the repository caused by non-function root exports being treated as plugin functions by OpenCode loader.

### Verification

- Verified `npm run prepublishOnly` passes (`clean`, `build`, and `check:exports`).
- Verified built root module exports only callable plugin functions.
- Verified runtime helpers/constants remain available through `opencode-omniroute-auth/runtime`.
- Verified packed local tarball (`1.0.3`) installs and exposes the expected export shape.

## [1.0.2] - 2026-03-01

### Added

- Added initial export-shape validation check before publishing.

### Changed

- Introduced default plugin export intended to improve compatibility with plugin loaders expecting default exports.
- Updated README troubleshooting notes for npm plugin loading.

### Notes

- This version improved compatibility but did not fully resolve OpenCode loader behavior when non-function runtime exports were present at package root.

## [1.0.1] - 2026-03-01

### Changed

- Version bump and package republish metadata update after initial release.

## [1.0.0] - 2026-03-01

### Added

- Initial OpenCode OmniRoute authentication plugin release.
- `/connect` authentication flow for storing and validating OmniRoute API keys.
- Dynamic model discovery from `/v1/models`.
- TTL-based model caching with fallback model behavior.
- Request interception for Authorization header injection and safe base URL handling.
- OpenAI-compatible provider wiring for OmniRoute usage in OpenCode.
