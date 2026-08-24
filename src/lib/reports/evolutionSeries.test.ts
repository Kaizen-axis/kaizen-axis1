import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvolutionSeries } from './evolutionSeries.ts';
import type { ReportClientLike } from './computeHybridMetrics.ts';

const ref = new Date(2026, 7, 24, 12, 0, 0); // 24 ago 2026

function client(partial: Partial<ReportClientLike>): ReportClientLike {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    name: partial.name ?? 'Cliente',
    stage: partial.stage ?? 'Concluído',
    createdAt: partial.createdAt ?? '2026-08-01T10:00:00',
    closed_at: partial.closed_at ?? null,
    intendedValue: partial.intendedValue ?? 'R$ 100.000,00',
    owner_id: partial.owner_id,
  };
}

describe('buildEvolutionSeries', () => {
  it('monthly returns 12 buckets ending at reference month, zeros included', () => {
    const series = buildEvolutionSeries([], 'mensal', ref);
    assert.equal(series.length, 12);
    assert.equal(series[11].label, 'Ago/26');
    assert.equal(series[0].label, 'Set/25');
    assert.ok(series.every((p) => p.vendas === 0 && p.vgv === 0));
  });

  it('counts sales by closed_at inside the bucket and sums VGV', () => {
    const clients = [
      client({ closed_at: '2026-08-10T10:00:00', intendedValue: 'R$ 200.000,00' }),
      client({ closed_at: '2026-08-20T10:00:00', intendedValue: 'R$ 300.000,00' }),
      client({ closed_at: '2026-07-05T10:00:00', intendedValue: 'R$ 150.000,00' }),
      client({ stage: 'Em Análise', closed_at: null }), // não é venda
      client({ closed_at: '2024-01-10T10:00:00' }), // fora da janela mensal
    ];
    const series = buildEvolutionSeries(clients, 'mensal', ref);
    const ago = series.find((p) => p.label === 'Ago/26')!;
    const jul = series.find((p) => p.label === 'Jul/26')!;
    assert.equal(ago.vendas, 2);
    assert.equal(ago.vgv, 500000);
    assert.equal(jul.vendas, 1);
    assert.equal(jul.vgv, 150000);
  });

  it('quarterly returns 8 buckets with quarter labels', () => {
    const clients = [client({ closed_at: '2026-05-15T10:00:00' })]; // T2/26
    const series = buildEvolutionSeries(clients, 'trimestral', ref);
    assert.equal(series.length, 8);
    assert.equal(series[7].label, 'T3/26');
    assert.equal(series[6].label, 'T2/26');
    assert.equal(series[6].vendas, 1);
    assert.equal(series[7].vendas, 0);
  });

  it('semiannual returns 6 buckets and annual returns 5', () => {
    const clients = [client({ closed_at: '2025-03-10T10:00:00' })]; // S1/25, ano 2025
    const sem = buildEvolutionSeries(clients, 'semestral', ref);
    const anual = buildEvolutionSeries(clients, 'anual', ref);
    assert.equal(sem.length, 6);
    assert.equal(sem[5].label, 'S2/26');
    assert.equal(sem.find((p) => p.label === 'S1/25')!.vendas, 1);
    assert.equal(anual.length, 5);
    assert.equal(anual[4].label, '2026');
    assert.equal(anual.find((p) => p.label === '2025')!.vendas, 1);
  });
});
