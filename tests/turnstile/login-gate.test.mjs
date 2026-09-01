import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../src/pages/Login.tsx', import.meta.url),
  'utf8',
);

test('login gate exposes Turnstile errors and a recovery path', () => {
  assert.match(source, /setCaptchaErrorCode/);
  assert.match(source, /['"]retry['"]:\s*['"]auto['"]/);
  assert.match(source, /Tentar novamente/);
  assert.match(
    source,
    /disabled=\{loading \|\| \(Boolean\(TURNSTILE_SITE_KEY\) && !captchaToken\)\}/,
  );
  assert.match(source, /appearance:\s*['"]always['"]/);
  assert.match(source, /size:\s*['"]flexible['"]/);
});
