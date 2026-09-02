export interface CheckinUnitPolicy {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  max_radius_meters: number;
  max_accuracy_meters: number;
  start_minutes: number;
  end_minutes: number;
  active: boolean;
}

export type CheckinPolicyError = 'gps_impreciso' | 'fora_do_horario' | 'fora_do_raio';

export interface CheckinPolicyResult {
  ok: boolean;
  error?: CheckinPolicyError;
  distance: number;
}

export function formatOutOfRadiusMessage(distanceMeters: number, unitName: string): string {
  return `Você está a ${Math.round(distanceMeters)}m da unidade ${unitName}. Aproxime-se para fazer o check-in.`;
}

export function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const deltaLatitude = toRadians(lat2 - lat1);
  const deltaLongitude = toRadians(lng2 - lng1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(lat1))
    * Math.cos(toRadians(lat2))
    * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

export function evaluateCheckinPolicy(input: {
  unit: CheckinUnitPolicy;
  latitude: number;
  longitude: number;
  accuracy?: number;
  currentMinutes: number;
}): CheckinPolicyResult {
  const distance = haversineMeters(
    input.latitude,
    input.longitude,
    input.unit.latitude,
    input.unit.longitude,
  );

  if (
    typeof input.accuracy === 'number'
    && input.accuracy > input.unit.max_accuracy_meters
  ) {
    return { ok: false, error: 'gps_impreciso', distance };
  }

  if (
    input.currentMinutes < input.unit.start_minutes
    || input.currentMinutes > input.unit.end_minutes
  ) {
    return { ok: false, error: 'fora_do_horario', distance };
  }

  if (distance > input.unit.max_radius_meters) {
    return { ok: false, error: 'fora_do_raio', distance };
  }

  return { ok: true, distance };
}
