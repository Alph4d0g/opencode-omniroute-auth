# Release v1.0.3

## Highlights

- Fixes npm plugin loading in OpenCode by limiting root runtime exports to plugin functions only.
- Adds optional API mode selection (`chat` and `responses`) with safe normalization and compatibility defaults.
- Introduces `opencode-omniroute-auth/runtime` for programmatic helper and constant imports.

## What Changed

### Plugin Compatibility

- Root package export now exposes plugin functions only:
  - `default`
  - `OmniRouteAuthPlugin`
- Added prepublish guard to fail builds if non-function runtime exports are added to package root.

### API Mode Support

- Added `provider.omniroute.options.apiMode` with supported values:
  - `chat` (default)
  - `responses`
- Invalid values are normalized to `chat` with warning output.

### Runtime Subpath

- Added `opencode-omniroute-auth/runtime` export for:
  - model helpers (`fetchModels`, `refreshModels`, `clearModelCache`, `getCachedModels`, `isCacheValid`)
  - constants (`OMNIROUTE_DEFAULT_MODELS`, `MODEL_CACHE_TTL`, `OMNIROUTE_ENDPOINTS`, etc.)

### Documentation

- Updated README examples for `apiMode` and runtime helper imports.
- Added troubleshooting guidance for npm plugin loading.
- Added `CHANGELOG.md` with full history for `1.0.0` through `1.0.3`.

## Verification

- `npm run prepublishOnly` passes (`clean`, `build`, `check:exports`).
- Local packed tarball installs with expected export shape.
- Runtime helper API remains available through `opencode-omniroute-auth/runtime`.

## Upgrade Notes

- If importing helper APIs from package root, update imports to `opencode-omniroute-auth/runtime`.
- Existing plugin configuration remains backward compatible; `apiMode` defaults to `chat`.
