export type DistrictQuery =
  | { kind: 'districts'; cityId: number }
  | { kind: 'districtsByIbge'; ibgeId: number };

export function districtQueryForCity(city: {
  id: number;
  ibgeId?: number;
  source?: 'brasil-aberto' | 'ibge';
}): DistrictQuery[] {
  if (city.source === 'ibge') {
    const ibgeId = city.ibgeId || city.id;
    return Number.isFinite(ibgeId) && ibgeId > 0 ? [{ kind: 'districtsByIbge', ibgeId }] : [];
  }
  const queries: DistrictQuery[] = [];
  if (Number.isFinite(city.id) && city.id > 0) queries.push({ kind: 'districts', cityId: city.id });
  if (city.ibgeId && Number.isFinite(city.ibgeId) && city.ibgeId > 0 && city.ibgeId !== city.id) {
    queries.push({ kind: 'districtsByIbge', ibgeId: city.ibgeId });
  }
  return queries;
}
