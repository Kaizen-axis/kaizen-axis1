import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../src/pages/Login.tsx', import.meta.url),
  'utf8',
);

test('login stays fail-closed without an indefinite loading gate', () => {
  assert.doesNotMatch(source, /Carregando verificação de segurança/);
  assert.doesNotMatch(
    source,
    /disabled=\{loading \|\| \(Boolean\(TURNSTILE_SITE_KEY\) && !captchaToken\)\}/,
  );
  assert.match(source, /disabled=\{loading\}/);
  assert.match(source, /const getCaptchaTokenIfRequired/);
  assert.match(source, /if \(!captchaToken\)/);
  assert.match(source, /Confirme a verificacao de seguranca antes de continuar/);
  assert.match(source, /action:\s*TURNSTILE_ACTION/);
  assert.match(source, /appearance:\s*['"]always['"]/);
  assert.match(source, /Tentar novamente/);
});

test('break-glass is login-only and defaults fail-closed', () => {
  assert.match(
    source,
    /const LOGIN_CAPTCHA_REQUIRED = import\.meta\.env\.VITE_LOGIN_REQUIRE_CAPTCHA !== ['"]false['"]/,
  );
  assert.match(source, /getCaptchaTokenIfRequired\(LOGIN_CAPTCHA_REQUIRED\)/);
  assert.match(source, /getCaptchaTokenIfRequired\(true\)/);
  assert.match(source, /LOGIN_CAPTCHA_REQUIRED \|\| !isLogin/);
});

test('break-glass closes signup and password-reset UI', () => {
  assert.match(source, /Recuperacao de senha temporariamente indisponivel/);
  assert.match(source, /LOGIN_CAPTCHA_REQUIRED && \(/);
  assert.match(source, /handlePasswordResetRequest/);
});
