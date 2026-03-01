# Changelog

All notable changes to this project are documented in this file.

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
