export function minutesToHHMM(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function hhmmToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return Number.NaN;

  return hour * 60 + minute;
}

export function getCheckinWindowLabel(startMinutes: number, endMinutes: number): string {
  return `${minutesToHHMM(startMinutes)} – ${minutesToHHMM(endMinutes)}`;
}

export function isCheckinOpen(
  currentMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

export function getAssignedUnit<T extends { code: string }>(
  code: string | null | undefined,
  units: T[],
): T | null {
  if (!code) return null;
  return units.find((unit) => unit.code === code) ?? null;
}
