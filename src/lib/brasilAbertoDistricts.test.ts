import assert from 'node:assert/strict';
import { districtQueryForCity } from './brasilAbertoDistricts.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('IBGE city uses districtsByIbge only', () => {
  assert.deepEqual(
    districtQueryForCity({ id: 3304557, ibgeId: 3304557, source: 'ibge' }),
    [{ kind: 'districtsByIbge', ibgeId: 3304557 }],
  );
});

runTest('Brasil Aberto city uses internal id then ibge fallback', () => {
  assert.deepEqual(
    districtQueryForCity({ id: 646, ibgeId: 3304557, source: 'brasil-aberto' }),
    [
      { kind: 'districts', cityId: 646 },
      { kind: 'districtsByIbge', ibgeId: 3304557 },
    ],
  );
});
