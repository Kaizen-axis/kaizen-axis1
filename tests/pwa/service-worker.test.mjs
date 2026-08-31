import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceWorker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const appEntry = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8');

test('service worker bypasses every cross-origin request', () => {
  assert.match(serviceWorker, /url\.origin\s*!==\s*self\.location\.origin/);
});

test('service worker updates bypassing the browser HTTP cache', () => {
  assert.match(appEntry, /updateViaCache:\s*['"]none['"]/);
  assert.match(appEntry, /controllerchange/);
  assert.match(appEntry, /window\.location\.reload\(\)/);
});
