# Changelog

All notable changes to this project are documented in this file.

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
