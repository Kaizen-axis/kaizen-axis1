import assert from 'node:assert/strict';
import {
  calcBrokerCommission,
  calcRoleCommission,
  calcSaleCommissionSplit,
  deriveCommissionDisplayStatus,
  isSoldInYearMonth,
  parseCurrency,
  soldAtYearMonth,
  TAX_DEDUCTION,
  BROKER_OWN_RATE,
} from './commission.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('parseCurrency understands Brazilian money', () => {
  assert.equal(parseCurrency('R$ 1.250.000,50'), 1250000.5);
  assert.equal(parseCurrency(100), 100);
  assert.equal(parseCurrency(null), 0);
});

runTest('calcBrokerCommission uses corretor rate and tax deduction', () => {
  const vgv = 1_000_000;
  const expected = Math.round(vgv * BROKER_OWN_RATE * TAX_DEDUCTION * 100) / 100;
  assert.equal(calcBrokerCommission(vgv), expected);
  assert.equal(calcBrokerCommission(vgv), 15480);
});

runTest('calcRoleCommission applies own and team rates', () => {
  const result = calcRoleCommission(100_000, 200_000, 'GERENTE');
  assert.equal(result.ownCommission, 2064);
  assert.equal(result.teamCommission, 688);
  assert.equal(result.totalCommission, 2752);
});

runTest('calcSaleCommissionSplit splits one sale across corretor, coordenador and gerente', () => {
  const split = calcSaleCommissionSplit(1_000_000);
  assert.equal(split.corretor, 15480);
  assert.equal(split.coordenador, 860);
  assert.equal(split.gerente, 3440);
  assert.equal(split.total, 19780);
});

runTest('paid always displays as Pago even with overdue due date', () => {
  assert.equal(
    deriveCommissionDisplayStatus('paid', '2020-01-01', new Date('2026-08-27T12:00:00')),
    'Pago',
  );
});

runTest('pending without due date stays Pendente', () => {
  assert.equal(
    deriveCommissionDisplayStatus('pending', null, new Date('2026-08-27T12:00:00')),
    'Pendente',
  );
});

runTest('pending with past due date is Atrasado', () => {
  assert.equal(
    deriveCommissionDisplayStatus('pending', '2026-08-26', new Date('2026-08-27T12:00:00')),
    'Atrasado',
  );
});

runTest('pending with today or future due date is Pendente', () => {
  assert.equal(
    deriveCommissionDisplayStatus('pending', '2026-08-27', new Date('2026-08-27T12:00:00')),
    'Pendente',
  );
  assert.equal(
    deriveCommissionDisplayStatus('pending', '2026-08-28', new Date('2026-08-27T12:00:00')),
    'Pendente',
  );
});

runTest('isSoldInYearMonth matches sold_at month', () => {
  assert.equal(isSoldInYearMonth('2026-08-15T10:00:00Z', 2026, 8), true);
  assert.equal(isSoldInYearMonth('2026-07-31T10:00:00Z', 2026, 8), false);
  assert.equal(isSoldInYearMonth(null, 2026, 8), false);
});

runTest('soldAtYearMonth extracts year and month', () => {
  assert.deepEqual(soldAtYearMonth('2026-04-02T12:00:00Z'), { year: 2026, month: 4 });
  assert.equal(soldAtYearMonth(null), null);
});

console.log('all tests passed');
