import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortBrokersForReport } from './rankBrokers.ts';

describe('sortBrokersForReport', () => {
  it('puts sellers first (sales desc), then non-sellers alphabetically', () => {
    const brokers = [
      { id: '1', name: 'Zeca', vendas: 0 },
      { id: '2', name: 'Bruno', vendas: 3 },
      { id: '3', name: 'Ana', vendas: 0 },
      { id: '4', name: 'Carla', vendas: 5 },
      { id: '5', name: 'Duda', vendas: 3 },
    ];
    const sorted = sortBrokersForReport(brokers);
    assert.deepEqual(sorted.map((b) => b.name), ['Carla', 'Bruno', 'Duda', 'Ana', 'Zeca']);
  });

  it('keeps all brokers and does not mutate the input', () => {
    const brokers = [
      { id: '1', name: 'B', vendas: 1 },
      { id: '2', name: 'A', vendas: 0 },
    ];
    const sorted = sortBrokersForReport(brokers);
    assert.equal(sorted.length, 2);
    assert.equal(brokers[0].name, 'B');
  });

  it('breaks sales ties alphabetically', () => {
    const brokers = [
      { id: '1', name: 'Vitor', vendas: 2 },
      { id: '2', name: 'Bia', vendas: 2 },
    ];
    const sorted = sortBrokersForReport(brokers);
    assert.deepEqual(sorted.map((b) => b.name), ['Bia', 'Vitor']);
  });
});
