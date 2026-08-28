import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAssignedUnit,
  getCheckinWindowLabel,
  hhmmToMinutes,
  isCheckinOpen,
  minutesToHHMM,
} from './checkinUi.ts';

describe('check-in UI helpers', () => {
  it('formats and parses schedule values', () => {
    assert.equal(minutesToHHMM(480), '08:00');
    assert.equal(minutesToHHMM(810), '13:30');
    assert.equal(hhmmToMinutes('13:30'), 810);
    assert.equal(getCheckinWindowLabel(480, 810), '08:00 – 13:30');
  });

  it('applies inclusive schedule boundaries', () => {
    assert.equal(isCheckinOpen(479, 480, 810), false);
    assert.equal(isCheckinOpen(480, 480, 810), true);
    assert.equal(isCheckinOpen(810, 480, 810), true);
    assert.equal(isCheckinOpen(811, 480, 810), false);
  });

  it('resolves only the assigned unit', () => {
    const units = [
      { code: 'zona_oeste', name: 'Zona Oeste' },
      { code: 'zona_norte', name: 'Zona Norte' },
    ];

    assert.equal(getAssignedUnit('zona_norte', units)?.name, 'Zona Norte');
    assert.equal(getAssignedUnit('outra', units), null);
    assert.equal(getAssignedUnit(null, units), null);
  });
});
