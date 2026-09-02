import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('password reset captcha', () => {
  it('consumes the Turnstile token before invoking reset so it cannot be reused', () => {
    const login = readFileSync(join(root, 'src/pages/Login.tsx'), 'utf8');
    assert.match(login, /consumeCaptchaTokenIfRequired/);
    const resetInvoke = login.indexOf("invoke('send-password-reset'");
    const consumeIndex = login.lastIndexOf('consumeCaptchaTokenIfRequired()', resetInvoke);
    assert.ok(resetInvoke > 0, 'expected send-password-reset invoke');
    assert.ok(consumeIndex > 0 && consumeIndex < resetInvoke, 'reset must consume a fresh captcha token');
    assert.match(login, /disabled=\{loading\}/);
  });

  it('aligns send-password-reset with REQUIRE_CAPTCHA and logs siteverify error codes', () => {
    const source = readFileSync(
      join(root, 'supabase/functions/send-password-reset/index.ts'),
      'utf8',
    );
    assert.match(source, /REQUIRE_CAPTCHA/);
    assert.match(source, /error-codes/);
  });
});
