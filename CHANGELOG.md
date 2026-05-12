# Changelog

All notable changes to this project are documented in this file.

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
