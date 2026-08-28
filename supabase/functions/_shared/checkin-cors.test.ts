import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedCheckinOrigin } from './checkin-cors.ts';

describe('isAllowedCheckinOrigin', () => {
  it('allows production domains', () => {
    assert.equal(isAllowedCheckinOrigin('https://kaizen-axis.space'), true);
    assert.equal(isAllowedCheckinOrigin('https://www.kaizen-axis.space'), true);
    assert.equal(isAllowedCheckinOrigin('https://kaizen-axis1.vercel.app'), true);
  });

  it('allows only this project previews on Vercel', () => {
    assert.equal(
      isAllowedCheckinOrigin('https://kaizen-axis1-git-preview-checkin-multiunidade-hokma-tech.vercel.app'),
      true,
    );
    assert.equal(
      isAllowedCheckinOrigin('https://kaizen-axis1-aflts9z10-hokma-tech.vercel.app'),
      true,
    );
  });

  it('allows configured origins and rejects arbitrary websites', () => {
    assert.equal(isAllowedCheckinOrigin('https://preview.example.com', 'https://preview.example.com'), true);
    assert.equal(isAllowedCheckinOrigin('https://attacker.example'), false);
  });

  it('allows requests without an Origin header for native/server clients', () => {
    assert.equal(isAllowedCheckinOrigin(null), true);
  });
});
