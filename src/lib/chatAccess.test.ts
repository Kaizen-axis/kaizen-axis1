import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAT_FEATURE_LOCKED, isChatPath } from './chatAccess.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('chat feature lock', () => {
  it('treats chat routes as locked', () => {
    assert.equal(CHAT_FEATURE_LOCKED, true);
    assert.equal(isChatPath('/chat'), true);
    assert.equal(isChatPath('/chat/abc'), true);
    assert.equal(isChatPath('/schedule'), false);
  });

  it('locks desktop and mobile navigation and blocks deep links', () => {
    const desktop = readFileSync(join(root, 'src/components/layout/DesktopLayout.tsx'), 'utf8');
    const mobile = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
    const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
    const auth = readFileSync(join(root, 'src/hooks/useAuthorization.ts'), 'utf8');
    const bell = readFileSync(join(root, 'src/components/ui/NotificationBell.tsx'), 'utf8');

    assert.match(desktop, /label:\s*'Chat'[\s\S]*locked:\s*true/);
    assert.match(mobile, /locked:\s*true/);
    assert.match(app, /path="\/chat" element=\{<Navigate to="\/" replace \/>\}/);
    assert.match(app, /path="\/chat\/:id" element=\{<Navigate to="\/" replace \/>\}/);
    assert.match(auth, /CHAT_FEATURE_LOCKED/);
    assert.match(bell, /isChatPath/);
  });
});
