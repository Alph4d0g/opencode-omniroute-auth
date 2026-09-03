import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGatewayInferenceTelemetry,
  attachGatewayTelemetryToPayload,
  parseGatewayInferenceTelemetry,
  tokensPerSecondFromUsage,
} from '../dist/src/telemetry.js';

test('parseGatewayInferenceTelemetry copies tok/s and winning model', () => {
  const headers = new Headers({
    'X-CLIProxyAPI-Tokens-Per-Second': '80.5',
    'X-OmniRoute-Model': 'winner-model',
    'X-OmniRoute-Response-Cost': '0.0123',
  });
  const got = parseGatewayInferenceTelemetry(headers);
  assert.equal(got.tokensPerSecond, 80.5);
  assert.equal(got.model, 'winner-model');
  assert.equal(got.costUsd, 0.0123);
});

test('does not invent tok/s from tokens / latency', () => {
  const headers = new Headers({
    'X-OmniRoute-Tokens-Out': '200',
    'X-OmniRoute-Latency-Ms': '2000',
  });
  const got = parseGatewayInferenceTelemetry(headers);
  assert.equal(got.tokensPerSecond, undefined);
  const payload = attachGatewayTelemetryToPayload(
    { object: 'chat.completion', usage: { completion_tokens: 200 } },
    got,
  );
  assert.equal(payload.usage.tokens_per_second, undefined);
  assert.equal(tokensPerSecondFromUsage({ completion_tokens: 200, latency_ms: 2000 }), undefined);
});

test('applyGatewayInferenceTelemetry JSON attach', async () => {
  const response = new Response(
    JSON.stringify({
      object: 'chat.completion',
      model: 'combo/auto',
      usage: { completion_tokens: 20 },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-CLIProxyAPI-Tokens-Per-Second': '40',
        'X-OmniRoute-Model': 'winner',
      },
    },
  );
  const next = await applyGatewayInferenceTelemetry(response);
  const body = JSON.parse(await next.text());
  assert.equal(body.model, 'winner');
  assert.equal(body.usage.tokens_per_second, 40);
});
