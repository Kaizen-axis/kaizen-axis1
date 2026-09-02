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

runTest('BA city with string ids from API uses districts then districtsByIbge', () => {
  assert.deepEqual(
    districtQueryForCity({ id: '669' as unknown as number, ibgeId: '3303500' as unknown as number }),
    [
      { kind: 'districts', cityId: 669 },
      { kind: 'districtsByIbge', ibgeId: 3303500 },
    ],
  );
});

runTest('BA city with only internal id uses districts', () => {
  assert.deepEqual(
    districtQueryForCity({ id: 646 }),
    [{ kind: 'districts', cityId: 646 }],
  );
});

runTest('BA city uses internal id then ibge code when they differ', () => {
  assert.deepEqual(
    districtQueryForCity({ id: 646, ibgeId: 3304557 }),
    [
      { kind: 'districts', cityId: 646 },
      { kind: 'districtsByIbge', ibgeId: 3304557 },
    ],
  );
});
