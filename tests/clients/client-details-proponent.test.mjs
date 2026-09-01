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

test('client details blocks duplicate save while adding a proponent', () => {
  assert.match(source, /const addingProponentRef = useRef\(false\)/);
  assert.match(source, /if \(addingProponentRef\.current\) return/);
  assert.match(
    source,
    /<RoundedButton size="sm" onClick=\{handleAddProponent\} disabled=\{addingProponent\}>/,
  );
  assert.match(source, /\{addingProponent \? 'Salvando\.\.\.' : 'Salvar Proponente'\}/);
  assert.match(
    source,
    /onClick=\{\(\) => setShowAddProponentForm\(false\)\} disabled=\{addingProponent\}/,
  );

  const addFn = source.slice(
    source.indexOf('const handleAddProponent'),
    source.indexOf('const startEditProponent'),
  );
  const setBusy = addFn.indexOf('setAddingProponent(true)');
  const insert = addFn.indexOf('addClientProponent');
  assert.ok(setBusy >= 0, 'setAddingProponent(true) missing in handleAddProponent');
  assert.ok(insert >= 0, 'addClientProponent missing in handleAddProponent');
  assert.ok(setBusy < insert, 'setAddingProponent(true) must run before addClientProponent');
});

test('client details blocks duplicate save while editing a proponent', () => {
  assert.match(source, /const savingEditProponentRef = useRef\(false\)/);
  assert.match(source, /if \(savingEditProponentRef\.current\) return/);
  assert.match(source, /onClick=\{saveEditProponent\}[\s\S]{0,120}disabled=\{savingEditProponent\}/);

  const editFn = source.slice(
    source.indexOf('const saveEditProponent'),
    source.indexOf('const handleDeleteProponent'),
  );
  const setBusy = editFn.indexOf('setSavingEditProponent(true)');
  const update = editFn.indexOf('updateClientProponent');
  assert.ok(setBusy >= 0, 'setSavingEditProponent(true) missing in saveEditProponent');
  assert.ok(update >= 0, 'updateClientProponent missing in saveEditProponent');
  assert.ok(setBusy < update, 'setSavingEditProponent(true) must run before updateClientProponent');
});
