# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`opencode-omniroute-auth` is an OpenCode authentication plugin for the OmniRoute API. It provides a `/connect omniroute` command, API-key auth, dynamic model fetching from `/v1/models`, and combo model capability enrichment.

## Common Commands

```bash
# Build (required before running tests)
npm run build

# Watch mode during development
npm run dev

# Run tests (builds first, then runs Node built-in test runner)
npm test

# Run a single test file
npm run build && node --test test/plugin.test.mjs

# Type-check a single file without emitting
npx tsc --noEmit src/plugin.ts

# Clean build output
npm run clean

# Validate dist exports satisfy plugin loader constraints
npm run check:exports

# Full publish prep
npm run prepublishOnly
```

## Architecture

### Dual Entry Points

- **`index.ts`** — Main plugin export (`OmniRouteAuthPlugin`). Required by OpenCode's plugin loader. All root exports must be functions.
- **`runtime.ts`** — Runtime utilities (`fetchModels`, `clearModelCache`, combo helpers, etc.) exported for programmatic use.

### Core Modules

| File | Responsibility |
|------|----------------|
| `src/plugin.ts` | Plugin implementation: `config` hook (registers `omniroute` provider), `auth` hook (`/connect` command), `loadProviderOptions` (fetches models and returns a `fetch` interceptor). |
| `src/models.ts` | `fetchModels()` fetches `/v1/models`, manages an in-memory cache keyed by `baseUrl:apiKey`, falls back to defaults on failure. Orchestrates metadata enrichment via `models-dev.ts` and combo enrichment via `omniroute-combos.ts`. |
| `src/models-dev.ts` | Fetches `https://models.dev/api.json`, builds indexed lookup maps (exact/normalized, provider-specific and global), and maps OmniRoute provider keys to models.dev providers via aliases. |
| `src/omniroute-combos.ts` | Fetches combo definitions from `/api/combos`. Resolves underlying models and calculates lowest-common-denominator capabilities (min context/maxTokens, vision/tools only if ALL underlying models support them). |
| `src/constants.ts` | Endpoints, default models, TTLs, timeouts. |
| `src/types.ts` | Shared TypeScript interfaces. |

### Fetch Interceptor (`createFetchInterceptor` in `src/plugin.ts`)

The loader returns a `fetch` function that:
1. Adds `Authorization: Bearer <apiKey>` and `Content-Type: application/json` headers.
2. Only intercepts requests to the configured OmniRoute base URL (with safe prefix matching).
3. Sanitizes Gemini tool schemas by stripping `$schema`, `$ref`, `ref`, and `additionalProperties` keywords when the model name includes "gemini".

### Caching Strategy

Three independent in-memory caches:
- **Model cache** (`src/models.ts`) — keyed by `baseUrl:apiKey`, TTL defaults to 5 minutes.
- **models.dev cache** (`src/models-dev.ts`) — global singleton, TTL defaults to 24 hours.
- **Combo cache** (`src/omniroute-combos.ts`) — global singleton, TTL defaults to 5 minutes.

`clearModelCache()` also clears the combo cache.

## Code Conventions

- **ESM only** with `NodeNext` module resolution. Every relative import must use an explicit `.js` extension (e.g., `import { x } from './file.js'`).
- **Import grouping**: external → internal → types.
- **Strict TypeScript** — never use `any`. Prefer `unknown` with runtime narrowing.
- **Runtime validation** before type assertions for external API responses (e.g., validate `typeof rawData === 'object' && Array.isArray(rawData.data)` before casting to `OmniRouteModelsResponse`).
- **Security/logging** — never log API keys or full response bodies. Use the `[OmniRoute]` log prefix.
- **Resource cleanup** — always wrap `fetch` + `AbortController` timeouts in `try/finally` with `clearTimeout`.
- **Naming**: `PascalCase` for types/interfaces, `camelCase` for functions/variables, `UPPER_SNAKE_CASE` for constants, `kebab-case` for files.
- **Formatting**: 2 spaces, max 100 chars/line, semicolons required, single quotes for strings, trailing commas in multi-line objects/arrays.
- **Headers/URLs**: Use the `Headers` constructor for normalization. Handle both `Request` objects and string URLs (`input instanceof Request ? input.url : input.toString()`). When intercepting requests, ensure `baseUrl` ends with `/` for safe prefix matching to prevent domain spoofing.

## Testing

Tests use Node.js's built-in test runner (`node:test`, `node:assert/strict`) and import from `dist/`. They mock `global.fetch`.

- Tests live in `test/*.test.mjs`.
- `npm test` always rebuilds first; if you edit source and rerun a single test file manually, run `npm run build` first.

## Important Configuration

- `tsconfig.json` compiles from the root (`rootDir: "."`) and outputs to `./dist`.
- `package.json` `exports` maps `"."` to `dist/index.js` and `"./runtime"` to `dist/runtime.js`.

## Common Tasks

- **Adding exports**: Add the export in the source file, re-export it from `index.ts` or `runtime.ts` (with `.js` extension), then run `npm run build`.
- **Debugging**: Look for the `[OmniRoute]` prefix in console logs.

## Release Process

### 1. Prepare the version bump

1. Update `package.json` version.
2. Update `CHANGELOG.md` with a new section for the release. Include the date and credit contributors by GitHub username (e.g., `@username`) when applicable.
3. If there are missing changelog sections for prior releases (e.g., `1.1.0` was released but never documented), add them retroactively so the changelog is complete.
4. Commit the changes:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to X.Y.Z"
   ```

### 2. Merge to `main`

Ensure the release PR is merged into `main`:
```bash
git checkout main
git pull origin main
```

### 3. Tag the release

Create and push an annotated tag matching the version:
```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

### 4. Create the GitHub Release

Create a release from the tag using `gh`:
```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(sed -n '/## \[X.Y.Z\]/,/^## /p' CHANGELOG.md | sed '$d')"
```

Or use a prepared notes file if one exists in `docs/`:
```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file docs/release-notes-vX.Y.Z.md
```

### 5. Publish to npm

1. Verify you are logged in:
   ```bash
   npm whoami
   ```
2. Run the publish prep (clean, build, and export validation):
   ```bash
   npm run prepublishOnly
   ```
3. Publish:
   ```bash
   npm publish
   ```

If npm requires an MFA/2FA OTP, publish with:
```bash
npm publish --otp <CODE>
```

### 6. Post-release verification

- Confirm the package version on npm:
  ```bash
  npm view opencode-omniroute-auth version
  ```
- Confirm the GitHub release exists:
  ```bash
  gh release view vX.Y.Z
  ```