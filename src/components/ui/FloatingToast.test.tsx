import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  FLOATING_TOAST_DURATION_MS,
  FloatingToast,
} from './FloatingToast.tsx';

describe('FloatingToast', () => {
  it('renders an accessible fixed success notification', () => {
    const html = renderToStaticMarkup(
      <FloatingToast
        feedback={{ type: 'success', message: 'Horário de Zona Oeste salvo com sucesso.' }}
        onClose={() => undefined}
      />,
    );

    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /fixed top-4 right-4/);
    assert.match(html, /Horário de Zona Oeste salvo com sucesso\./);
    assert.match(html, /border-emerald-500/);
  });

  it('renders errors distinctly and uses a four-second default duration', () => {
    const html = renderToStaticMarkup(
      <FloatingToast
        feedback={{ type: 'error', message: 'Não foi possível salvar.' }}
        onClose={() => undefined}
      />,
    );

    assert.match(html, /border-red-500/);
    assert.equal(FLOATING_TOAST_DURATION_MS, 4_000);
  });
});
