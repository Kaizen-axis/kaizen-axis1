import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function readSrc(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('session identity wiring', () => {
  it('blocks protected routes while the profile belongs to another user', () => {
    const source = readSrc('src/App.tsx');
    assert.match(source, /hasStaleProfile/);
    assert.match(source, /loading \|\| hasStaleProfile\(profile, session\)/);
  });

  it('reloads profile when TOKEN_REFRESHED changes the user id', () => {
    const source = readSrc('src/context/AppContext.tsx');
    assert.match(source, /authEventRequiresProfileReload/);
    assert.doesNotMatch(source, /if \(event === 'TOKEN_REFRESHED'\) return;/);
    assert.match(source, /clearUserScopedState/);
    assert.match(source, /sessionEpochRef/);
  });

  it('clears React state before signing out', () => {
    const source = readSrc('src/context/AppContext.tsx');
    const signOutIndex = source.indexOf('const signOut = async () => {');
    const authSignOutIndex = source.indexOf('await supabase.auth.signOut()', signOutIndex);
    const clearIndex = source.indexOf('clearUserScopedState()', signOutIndex);
    assert.ok(signOutIndex >= 0);
    assert.ok(clearIndex > signOutIndex);
    assert.ok(clearIndex < authSignOutIndex);
  });

  it('rejects a setSession whose email does not match the form', () => {
    const source = readSrc('src/pages/Login.tsx');
    assert.match(source, /assertSessionEmail\(session, formData\.email\)/);
    assert.match(source, /existingEmail\.trim\(\)\.toLowerCase\(\) !== formData\.email\.trim\(\)\.toLowerCase\(\)/);
  });
});
