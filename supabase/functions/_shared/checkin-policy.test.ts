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
      startMinutes: 480,
      endMinutes: 810,
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
      startMinutes: 480,
      endMinutes: 810,
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
      startMinutes: 480,
      endMinutes: 810,
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
      startMinutes: 480,
      endMinutes: 810,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'fora_do_horario');
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
