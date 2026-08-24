import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeHybridMetrics, parseReportValue } from './computeHybridMetrics.ts';

function client(partial: Record<string, unknown>) {
  return {
    id: String(partial.id ?? 'x'),
    name: String(partial.name ?? 'Cliente'),
    stage: String(partial.stage ?? 'Documentação'),
    createdAt: String(partial.createdAt ?? '2026-08-01T12:00:00'),
    closed_at: (partial.closed_at as string | undefined) ?? undefined,
    intendedValue: String(partial.intendedValue ?? 'R$ 0,00'),
    owner_id: (partial.owner_id as string | undefined) ?? 'broker-1',
  };
}

describe('computeHybridMetrics', () => {
  const start = '2026-08-01';
  const end = '2026-08-31';

  it('counts total clientes as snapshot, not created-in-period cohort', () => {
    const clients = [
      client({ id: 'old', createdAt: '2026-01-10T10:00:00', stage: 'Documentação' }),
      client({ id: 'new', createdAt: '2026-08-10T10:00:00', stage: 'Em Análise' }),
    ];
    const result = computeHybridMetrics(clients, start, end);
    assert.equal(result.totalClientes, 2);
    assert.equal(result.createdInPeriodCount, 1);
  });

  it('counts sales by Concluído + closed_at in period, even if created earlier', () => {
    const clients = [
      client({
        id: 'sale',
        createdAt: '2026-01-10T10:00:00',
        stage: 'Concluído',
        closed_at: '2026-08-15T10:00:00',
        intendedValue: 'R$ 195.000,00',
      }),
      client({
        id: 'old-sale',
        createdAt: '2025-01-10T10:00:00',
        stage: 'Concluído',
        closed_at: '2026-07-15T10:00:00',
        intendedValue: 'R$ 100.000,00',
      }),
    ];
    const result = computeHybridMetrics(clients, start, end);
    assert.equal(result.vendas, 1);
    assert.equal(result.vgv, 195000);
  });

  it('counts aprovados as created-in-period with current stage Aprovado', () => {
    const clients = [
      client({ id: 'a', createdAt: '2026-08-10T10:00:00', stage: 'Aprovado' }),
      client({ id: 'b', createdAt: '2026-01-10T10:00:00', stage: 'Aprovado' }),
    ];
    const result = computeHybridMetrics(clients, start, end);
    assert.equal(result.aprovados, 1);
  });

  it('computes conversion as sales-in-period / created-in-period', () => {
    const clients = [
      client({ id: 'new', createdAt: '2026-08-10T10:00:00', stage: 'Documentação' }),
      client({
        id: 'sale',
        createdAt: '2026-08-12T10:00:00',
        stage: 'Concluído',
        closed_at: '2026-08-20T10:00:00',
      }),
    ];
    const result = computeHybridMetrics(clients, start, end);
    assert.equal(result.taxaConversao, 50);
  });

  it('keeps pipeline stages in CLIENT_STAGES order, not by count', () => {
    const clients = [
      client({ id: '1', stage: 'Concluído' }),
      client({ id: '2', stage: 'Concluído' }),
      client({ id: '3', stage: 'Documentação' }),
    ];
    const result = computeHybridMetrics(clients, start, end);
    assert.equal(result.pipeline[0].stage, 'Documentação');
    assert.equal(result.pipeline[0].count, 1);
    const concluido = result.pipeline.find((s) => s.stage === 'Concluído');
    assert.ok(concluido);
    assert.equal(concluido.count, 2);
    assert.ok(result.pipeline.findIndex((s) => s.stage === 'Documentação') < result.pipeline.findIndex((s) => s.stage === 'Concluído'));
  });
});

describe('parseReportValue', () => {
  it('parses Brazilian currency strings', () => {
    assert.equal(parseReportValue('R$ 195.000,00'), 195000);
    assert.equal(parseReportValue(''), 0);
  });
});
