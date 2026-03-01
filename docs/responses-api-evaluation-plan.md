# Responses API Capability Evaluation and Rollout Plan

## Goal

Determine whether the current Chat Completions-based integration is sufficient for full coding-agent behavior, identify what the Responses API adds on top, and define a low-risk rollout plan for this plugin.

## Current State in This Repo

- Provider defaults to chat mode (`api: 'chat'`) in `src/plugin.ts:33`.
- Provider runtime uses `@ai-sdk/openai-compatible` in `src/plugin.ts:34`.
- Base URL defaults to OmniRoute `/v1` (`http://localhost:20128/v1`) in `src/constants.ts:11`.
- Models are loaded from `/v1/models` with cache + fallback behavior in `src/models.ts`.
- Request auth is injected via fetch interceptor in `src/plugin.ts:256`.

## Capability Assessment

### What Chat Completions Can Already Cover

Chat Completions can support the core coding-agent loop:

- multi-turn assistant text generation,
- function/tool call suggestions,
- streaming output,
- model routing through OpenAI-compatible endpoints.

This is enough for many coding CLI workflows if orchestration is managed in the client/plugin layer.

### What Responses API Adds for Coding Agents

Responses API adds stronger agent primitives that reduce custom orchestration burden:

- richer event-based streaming model for better live UX,
- stronger native support patterns for structured outputs/schema-driven responses,
- improved multi-turn state controls (`store`, `previous_response_id` patterns),
- background/asynchronous execution support for long-running tasks,
- built-in tool ecosystem alignment for more advanced agent orchestration.

### Practical Conclusion

- Chat endpoint is sufficient for baseline to mid-complexity coding-agent behavior.
- Responses API is a better long-term fit for advanced agent capabilities and operational robustness.
- Best implementation path is dual-mode support, not immediate hard migration.

## Decision Framework

Use this to choose runtime mode per deployment:

- Choose `chat` when compatibility and simplicity are the primary goals.
- Choose `responses` when richer streaming semantics, longer-running tasks, and stronger structured workflows matter.

## Implementation Plan (Feature Branch Scope)

### Phase 1: Configuration Contract

1. Add provider option `apiMode` with values `'chat' | 'responses'`.
2. Keep default as `'chat'` for backward compatibility.
3. Validate/normalize invalid values to `'chat'` with warning logs.

### Phase 2: Provider Wiring

1. Map `apiMode` into provider configuration and runtime options.
2. Keep model loading endpoint behavior unchanged (`/v1/models`).
3. Ensure fetch interceptor remains endpoint-agnostic (auth/header injection for both modes).

### Phase 3: Behavior and Compatibility

1. Verify tool-calling behavior in both modes.
2. Verify streaming behavior in both modes.
3. Verify fallback behavior when responses-specific features are unavailable.
4. Confirm that non-OmniRoute requests remain pass-through.

### Phase 4: Documentation

1. Update `README.md` configuration examples to include `apiMode`.
2. Add migration notes:
   - chat-only users (no change required),
   - opt-in responses users,
   - rollback path (`apiMode: 'chat'`).
3. Document feature expectations for each mode.

## Validation Matrix

Run and capture results for both `apiMode=chat` and `apiMode=responses`:

1. Connect/auth flow (`/connect omniroute`).
2. Model hydration (`/v1/models`) with cache and refresh behavior.
3. Standard prompt generation.
4. Tool call execution paths.
5. Streaming behavior and CLI rendering.
6. Error handling and fallback models.

## Risks and Mitigations

- Risk: endpoint compatibility differences across OpenAI-compatible backends.
  - Mitigation: default to chat, responses opt-in.
- Risk: stream/event format assumptions in upstream consumers.
  - Mitigation: mode-specific validation and explicit docs.
- Risk: regression in existing users.
  - Mitigation: preserve current defaults and provide immediate rollback.

## Exit Criteria

The rollout is ready when:

1. Existing chat users see no behavior regressions.
2. Responses mode can be enabled by config only.
3. Both modes pass the validation matrix.
4. README clearly documents selection, expectations, and rollback.
