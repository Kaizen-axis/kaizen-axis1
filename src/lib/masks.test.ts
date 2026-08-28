import assert from 'node:assert/strict';
import { formatCpf, formatPhone } from './masks.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('formatCpf applies 000.000.000-00', () => {
  assert.equal(formatCpf('16023848788'), '160.238.487-88');
  assert.equal(formatCpf('160.238.487-88'), '160.238.487-88');
  assert.equal(formatCpf('160'), '160');
});

runTest('formatPhone has no space after DDD', () => {
  assert.equal(formatPhone('21974657027'), '(21)97465-7027');
  assert.equal(formatPhone('2134567890'), '(21)3456-7890');
  assert.equal(formatPhone('(21) 97465-7027'), '(21)97465-7027');
});
