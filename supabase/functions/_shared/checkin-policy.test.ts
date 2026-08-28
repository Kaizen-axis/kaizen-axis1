import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCheckinPolicy,
  formatMinutes,
  haversineMeters,
} from './checkin-policy.ts';

const zonaNorte = {
  code: 'zona_norte',
  name: 'Zona Norte',
  latitude: -22.88719,
  longitude: -43.28214,
  max_radius_meters: 1000,
  max_accuracy_meters: 120,
  start_minutes: 480,
  end_minutes: 810,
  active: true,
};

describe('evaluateCheckinPolicy', () => {
  it('accepts GPS inside the assigned unit', () => {
    const result = evaluateCheckinPolicy({
      unit: zonaNorte,
      latitude: -22.88719,
      longitude: -43.28214,
      accuracy: 20,
      currentMinutes: 600,
    });

    assert.equal(result.ok, true);
    assert.equal(result.distance, 0);
  });

  it('rejects coordinates from another unit even when the client suggests that unit', () => {
    const clientBody = {
      latitude: -22.903084,
      longitude: -43.561,
      accuracy: 20,
      unitCode: 'zona_oeste',
    };

    const result = evaluateCheckinPolicy({
      unit: zonaNorte,
      latitude: clientBody.latitude,
      longitude: clientBody.longitude,
      accuracy: clientBody.accuracy,
      currentMinutes: 600,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'fora_do_raio');
    assert.ok(result.distance > zonaNorte.max_radius_meters);
  });

  it('rejects imprecise GPS', () => {
    const result = evaluateCheckinPolicy({
      unit: zonaNorte,
      latitude: -22.88719,
      longitude: -43.28214,
      accuracy: 121,
      currentMinutes: 600,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'gps_impreciso');
  });

  it('rejects requests outside the configured window', () => {
    const result = evaluateCheckinPolicy({
      unit: zonaNorte,
      latitude: -22.88719,
      longitude: -43.28214,
      accuracy: 20,
      currentMinutes: 811,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'fora_do_horario');
  });

  it('uses the schedule of the assigned unit', () => {
    const west = {
      ...zonaNorte,
      code: 'zona_oeste',
      name: 'Zona Oeste',
      start_minutes: 480,
      end_minutes: 540,
    };
    const north = {
      ...zonaNorte,
      start_minutes: 560,
      end_minutes: 720,
    };
    const sharedInput = {
      latitude: zonaNorte.latitude,
      longitude: zonaNorte.longitude,
      accuracy: 20,
      currentMinutes: 570,
      startMinutes: 0,
      endMinutes: 1439,
    };

    const westResult = evaluateCheckinPolicy({ ...sharedInput, unit: west });
    const northResult = evaluateCheckinPolicy({ ...sharedInput, unit: north });

    assert.equal(westResult.error, 'fora_do_horario');
    assert.equal(northResult.ok, true);
  });
});

describe('check-in policy helpers', () => {
  it('formats minutes as HH:MM', () => {
    assert.equal(formatMinutes(480), '08:00');
    assert.equal(formatMinutes(810), '13:30');
  });

  it('calculates the two offices as farther apart than either allowed radius', () => {
    const distance = haversineMeters(-22.88719, -43.28214, -22.903084, -43.561);
    assert.ok(distance > 1000);
  });
});
