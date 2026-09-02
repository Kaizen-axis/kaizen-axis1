import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCheckinToken,
  QR_SCAN_TIMEOUT_MS,
  shouldFallbackToJsQR,
} from './qrScanner.ts';

describe('extractCheckinToken', () => {
  it('reads the token query param from a check-in URL', () => {
    assert.equal(
      extractCheckinToken('https://kaizen-axis.space/checkin?token=abc-123'),
      'abc-123',
    );
  });

  it('accepts a raw token and rejects empty or tokenless URLs', () => {
    assert.equal(extractCheckinToken('raw-token-value'), 'raw-token-value');
    assert.equal(extractCheckinToken('https://kaizen-axis.space/checkin'), null);
    assert.equal(extractCheckinToken('   '), null);
  });
});

describe('QR scanner fallback and timeout', () => {
  it('falls back to jsQR when BarcodeDetector returns nothing', () => {
    assert.equal(shouldFallbackToJsQR(true, 0), true);
    assert.equal(shouldFallbackToJsQR(true, 1), false);
    assert.equal(shouldFallbackToJsQR(false, 0), true);
  });

  it('times out after 10 seconds without a successful read', () => {
    assert.equal(QR_SCAN_TIMEOUT_MS, 10_000);
  });
});
