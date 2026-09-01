import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('diagnostic reports test and production widget outcomes', () => {
  const html = readFileSync(
    new URL('../../public/turnstile-diagnostic.html', import.meta.url),
    'utf8',
  );

  assert.match(html, /1x00000000000000000000AA/);
  assert.match(html, /0x4AAAAAADOmmf-tlgTOstXw/);
  assert.doesNotMatch(html, /0x4AAAAAAEjcC8jM74vJaB7u/);
  assert.doesNotMatch(html, /0x4AAAAAAEij91K9KZKNmIxo/);
  assert.match(html, /action:\s*['"]axis_auth['"]/);
  assert.match(html, /appearance:\s*['"]always['"]/);
  assert.match(html, /error-callback/);
  assert.match(html, /expired-callback/);
  assert.match(html, /token recebido/);
});
