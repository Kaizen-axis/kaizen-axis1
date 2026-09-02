import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('signup confirmation wiring', () => {
  it('does not call native supabase.auth.signUp from the login form', () => {
    const login = readFileSync(join(root, 'src/pages/Login.tsx'), 'utf8');
    assert.doesNotMatch(login, /supabase\.auth\.signUp/);
    assert.match(login, /send-signup-confirmation/);
  });

  it('sends confirmation through generateLink and Resend', () => {
    const source = readFileSync(
      join(root, 'supabase/functions/send-signup-confirmation/index.ts'),
      'utf8',
    );
    assert.match(source, /type:\s*'signup'/);
    assert.match(source, /generateLink/);
    assert.match(source, /api\.resend\.com\/emails/);
    assert.match(source, /REQUIRE_CAPTCHA/);
    assert.match(source, /increment_request_counter/);
  });
});
