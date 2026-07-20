import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeForLog } from '../dist/src/omniroute-combos.js';

test('sanitizeForLog removes every ASCII control character except tab', () => {
  for (let code = 0; code <= 0x1f; code += 1) {
    const value = String.fromCharCode(code);
    assert.equal(
      sanitizeForLog(`before${value}after`),
      code === 0x09 ? `before\tafter` : 'beforeafter',
      `unexpected handling for control byte 0x${code.toString(16).padStart(2, '0')}`,
    );
  }

  assert.equal(sanitizeForLog(`before${String.fromCharCode(0x7f)}after`), 'beforeafter');
});

test('sanitizeForLog prevents CR/LF log-line injection and preserves printable Unicode', () => {
  assert.equal(
    sanitizeForLog('combo\n[ERROR] forged\rrewritten\u2028forged2\u2029rewritten2'),
    'combo[ERROR] forgedrewrittenforged2rewritten2',
  );
  assert.equal(sanitizeForLog('Modell ✓ — 日本語'), 'Modell ✓ — 日本語');
});
