import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../src/pages/ClientDetails.tsx', import.meta.url),
  'utf8',
);

test('client details imports masked CPF and phone inputs for extra proponents', () => {
  assert.match(
    source,
    /import \{ CpfInput, PhoneInput \} from '@\/components\/ui\/MaskedInputs'/,
  );
  assert.match(source, /<CpfInput value=\{newProponent\.cpf\}/);
  assert.match(source, /<PhoneInput value=\{newProponent\.phone\}/);
  assert.match(source, /<CpfInput value=\{editingProponent\.cpf\}/);
  assert.match(source, /<PhoneInput value=\{editingProponent\.phone\}/);
});
