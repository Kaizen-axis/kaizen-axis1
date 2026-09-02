export type DistrictQuery =
  | { kind: 'districts'; cityId: number }
  | { kind: 'districtsByIbge'; ibgeId: number };

export function toPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function districtQueryForCity(city: {
  id: number | string;
  ibgeId?: number | string;
}): DistrictQuery[] {
  const queries: DistrictQuery[] = [];
  const cityId = toPositiveInt(city.id);
  const ibgeId = toPositiveInt(city.ibgeId);
  if (cityId) queries.push({ kind: 'districts', cityId });
  if (ibgeId && ibgeId !== cityId) queries.push({ kind: 'districtsByIbge', ibgeId });
  return queries;
}
