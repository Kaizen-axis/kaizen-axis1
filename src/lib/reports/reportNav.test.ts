import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackTarget, buildReportHref } from './reportNav.ts';

describe('buildReportHref', () => {
  it('builds global reports path', () => {
    assert.equal(buildReportHref({}), '/reports');
  });

  it('preserves period and parent when opening a broker from a team', () => {
    const href = buildReportHref({
      scope: 'corretor',
      id: 'broker-1',
      name: 'Ana',
      from: 'equipe',
      fromId: 'team-1',
      fromName: 'Águia',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    assert.ok(href.startsWith('/reports?'));
    assert.ok(href.includes('scope=corretor'));
    assert.ok(href.includes('id=broker-1'));
    assert.ok(href.includes('from=equipe'));
    assert.ok(href.includes('fromId=team-1'));
    assert.ok(href.includes('start=2026-08-01'));
  });
});

describe('buildBackTarget', () => {
  it('sends diretoria back to global', () => {
    const back = buildBackTarget({
      currentScope: 'diretoria',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    assert.equal(back.label, 'Ver Relatório Global');
    assert.equal(back.href, '/reports?start=2026-08-01&end=2026-08-31');
  });

  it('sends equipe back to its directorate when available', () => {
    const back = buildBackTarget({
      currentScope: 'equipe',
      directorateId: 'dir-1',
      directorateName: 'Diretoria Pablo',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    assert.equal(back.label, 'Ver Relatório da Diretoria');
    assert.ok(back.href.includes('scope=diretoria'));
    assert.ok(back.href.includes('id=dir-1'));
  });

  it('sends corretor back to the from-scope used by search', () => {
    const back = buildBackTarget({
      currentScope: 'corretor',
      from: 'diretoria',
      fromId: 'dir-1',
      fromName: 'Diretoria Pablo',
      start: '2026-08-01',
      end: '2026-08-31',
    });
    assert.equal(back.label, 'Ver Relatório da Diretoria');
    assert.ok(back.href.includes('scope=diretoria'));
    assert.ok(back.href.includes('id=dir-1'));
  });
});
