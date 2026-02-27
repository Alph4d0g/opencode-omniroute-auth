# Agent Guidelines for opencode-omniroute-auth

This file provides guidelines for AI agents operating in this repository.

## Overview

This is an OpenCode authentication plugin for the OmniRoute API. It provides:
- `/connect` command for interactive setup
- API key authentication
- Dynamic model fetching from `/v1/models` endpoint
- Model caching with TTL

## Build Commands

```bash
# Install dependencies
npm install

# Build the project (TypeScript compilation)
npm run build

# Watch mode for development
npm run dev

# Clean build output
npm run clean

# Build before publishing
npm run prepublishOnly
```

### Single File/Module Build

To build or check a specific file, use TypeScript directly:

```bash
# Type-check a single file
npx tsc --noEmit src/plugin.ts

# Build with verbose output
npx tsc --build --verbose
```

### Running Tests

This project currently has no test suite. When adding tests:

```bash
# Run all tests (when implemented)
npm test

# Run a single test file (example with jest)
npx jest src/plugin.test.ts

# Run tests in watch mode
npm run test:watch
```

## Code Style Guidelines

### TypeScript Configuration

- **Strict mode is enabled** - Do not disable strict checks
- **Target**: ES2022
- **Module system**: NodeNext (ESM)
- **Always use `.js` extension** in relative imports (e.g., `import { x } from "./file.js"`)

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Constants | UPPER_SNAKE_CASE | `OMNIROUTE_PROVIDER_ID` |
| Variables | camelCase | `modelCache` |
| Functions | camelCase | `fetchModels()` |
| Classes | PascalCase | `OmniRoutePlugin` |
| Interfaces | PascalCase | `OmniRouteConfig` |
| Types | PascalCase | `OmniRouteModel` |
| Files | kebab-case | `opencode-plugin.d.ts` |

### Imports

- Use explicit `.js` extension for relative imports
- Group imports in this order: external → internal → types
- Use named exports only (no default exports)

```typescript
// ✅ Correct
import type { OmniRouteConfig } from "./types.js";
import { fetchModels } from "./models.js";
import { OMNIROUTE_PROVIDER_ID } from "./constants.js";

// ❌ Wrong
import { x } from './file'  // Missing .js
import foo from './foo'     // Default export
```

### Formatting

- Use 2 spaces for indentation
- Maximum line length: 100 characters
- Always use semicolons
- Use single quotes for strings
- Add trailing commas in multi-line objects/arrays

```typescript
// ✅ Correct
const config: OmniRouteConfig = {
  baseUrl: "http://localhost:20128/v1",
  apiKey: "sk-...",
};

// ❌ Wrong
const config:OmniRouteConfig={baseUrl:"http://localhost:20128/v1",apiKey:"sk-..."}
```

### Type Safety

- **Never use `any`** - Use `unknown` if type is uncertain, then narrow
- **Always type function parameters** and return types
- **Use type assertions sparingly** - Prefer runtime validation

```typescript
// ✅ Correct - runtime validation before casting
const rawData = await response.json();
if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.data)) {
  throw new Error("Invalid response structure");
}
const data = rawData as OmniRouteModelsResponse;

// ❌ Wrong - unsafe assertion
const data = (await response.json()) as OmniRouteModelsResponse;
```

### Error Handling

- Always use try/catch with finally for resource cleanup
- Provide meaningful error messages
- Log errors with context

```typescript
// ✅ Correct
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

try {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return await response.json();
} catch (error) {
  console.error("[OmniRoute] Error fetching models:", error);
  throw error;
} finally {
  clearTimeout(timeoutId);
}

// ❌ Wrong - no cleanup, swallowed error
try {
  const response = await fetch(url);
  return await response.json();
} catch {
  return defaultModels;
}
```

### Headers and Request Objects

Use the `Headers` constructor for proper normalization:

```typescript
// ✅ Correct - handles Headers instance, plain objects, arrays
const headers = new Headers(init?.headers);
headers.set("Authorization", `Bearer ${apiKey}`);
headers.set("Content-Type", "application/json");

// ❌ Wrong - breaks with Headers instance or array
const headers = {
  ...init?.headers,
  Authorization: `Bearer ${apiKey}`,
};
```

### URL Handling

Handle both `Request` objects and string URLs:

```typescript
// ✅ Correct
const url = input instanceof Request ? input.url : input.toString();

// ❌ Wrong - Request.toString() returns "[object Request]"
const url = input.toString();
```

### Async/Await

- Always handle promise rejections with try/catch
- Avoid async functions that don't await
- Use Promise.all for parallel operations

```typescript
// ✅ Correct
async function getData() {
  try {
    const [users, posts] = await Promise.all([
      fetchUsers(),
      fetchPosts(),
    ]);
    return { users, posts };
  } catch (error) {
    console.error("Failed to fetch data:", error);
    throw error;
  }
}

// ❌ Wrong - unhandled rejection possible
async function getData() {
  return Promise.all([fetchUsers(), fetchPosts()]);
}
```

## Project Structure

```
opencode-omniroute-auth/
├── src/
│   ├── plugin.ts      # Main plugin implementation
│   ├── models.ts       # Model fetching & caching
│   ├── constants.ts    # Configuration constants
│   ├── types.ts        # Type definitions
│   └── types/          # Additional type declarations
│       └── opencode-plugin.d.ts
├── index.ts            # Main exports
├── package.json        # Package manifest
├── tsconfig.json      # TypeScript config
└── dist/              # Build output
```

## Common Tasks

### Adding a New Export

1. Add the export in the source file
2. Re-export in `index.ts` with `.js` extension
3. Build: `npm run build`
4. Verify types: `npm run build` (should have no errors)

### Modifying Constants

Constants are in `src/constants.ts`:
- `OMNIROUTE_PROVIDER_ID` - Provider identifier
- `OMNIROUTE_ENDPOINTS` - API endpoints
- `OMNIROUTE_DEFAULT_MODELS` - Fallback models
- `MODEL_CACHE_TTL` - Cache duration (ms)
- `REQUEST_TIMEOUT` - Request timeout (ms)

### Debugging

Enable debug output by checking console logs:
- `[OmniRoute]` prefix for plugin logs
- `[OmniRoute] Using cached models`
- `[OmniRoute] Error fetching models:`

## Dependencies

- **Runtime**: `@opencode-ai/plugin` (peer)
- **Dev**: `typescript` (^5.0.0), `@types/node` (^20.0.0)
- **Node**: >=20.0.0

## Publishing

```bash
# Clean and build
npm run prepublishOnly

# Publish to npm
npm publish

# Publish with tag
npm publish --tag beta
```

## Important Notes

1. **ESM Project**: This is an ESM module. All imports must use `.js` extensions
2. **Strict Mode**: TypeScript strict mode is enabled - write type-safe code
3. **No Tests**: Currently no test suite exists - consider adding one
4. **Peer Dependency**: The plugin requires `@opencode-ai/plugin` as a peer dependency
