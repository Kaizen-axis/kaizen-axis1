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
