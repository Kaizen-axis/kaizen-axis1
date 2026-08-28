import { supabase } from '@/lib/supabase';
import { districtQueryForCity } from '@/lib/brasilAbertoDistricts';

export type BrasilAbertoState = { name: string; shortName: string };
export type BrasilAbertoCity = { id: number; ibgeId?: number; name: string; source?: 'brasil-aberto' | 'ibge' };
export type BrasilAbertoDistrict = { id: number; name: string };

function functionErrorMessage(error: unknown): string {
  const err = error as { name?: string; message?: string; context?: { json?: () => Promise<unknown> } };
  return err?.message || 'Falha ao consultar endereço';
}

async function invokeBrasilAberto<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke('brasil-aberto', {
    body,
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) {
    const errName = (error as { name?: string }).name;
    if (errName === 'FunctionsHttpError') {
      const bodyJson = await (error as { context?: { json?: () => Promise<{ error?: string; message?: string }> } })
        .context?.json?.()
        .catch(() => ({} as { error?: string; message?: string }));
      const reason = bodyJson?.error || bodyJson?.message || error.message;
      console.error('brasil-aberto', reason);
      throw new Error(String(reason));
    }
    console.error('brasil-aberto', error);
    throw new Error(functionErrorMessage(error));
  }
  if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
    throw new Error(String((data as { error?: string }).error));
  }
  return data as T;
}

async function fetchIbgeStates(): Promise<BrasilAbertoState[]> {
  const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
  if (!res.ok) throw new Error('ibge_states_failed');
  const rows = await res.json() as { sigla?: string; nome?: string }[];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row.sigla && row.nome)
    .map(row => ({ shortName: String(row.sigla).toUpperCase(), name: String(row.nome) }));
}

async function fetchIbgeCities(state: string): Promise<BrasilAbertoCity[]> {
  const uf = state.trim().toUpperCase();
  const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`);
  if (!res.ok) throw new Error('ibge_cities_failed');
  const rows = await res.json() as { id?: number; nome?: string }[];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row.nome)
    .map(row => ({
      id: Number(row.id) || 0,
      ibgeId: Number(row.id) || undefined,
      name: String(row.nome),
      source: 'ibge' as const,
    }));
}

export async function fetchStates(): Promise<BrasilAbertoState[]> {
  try {
    const data = await invokeBrasilAberto<{ result?: BrasilAbertoState[] }>({ kind: 'states' });
    const list = Array.isArray(data?.result) ? data.result : [];
    if (list.length > 0) return list;
  } catch (error) {
    console.error('brasil-aberto states, using IBGE', error);
  }
  const fallback = await fetchIbgeStates();
  if (fallback.length === 0) throw new Error('Não foi possível carregar estados.');
  return fallback;
}

export async function fetchCities(state: string): Promise<BrasilAbertoCity[]> {
  try {
    const data = await invokeBrasilAberto<{ result?: BrasilAbertoCity[] }>({ kind: 'cities', state });
    const list = Array.isArray(data?.result)
      ? data.result.map(city => ({ ...city, source: 'brasil-aberto' as const }))
      : [];
    if (list.length > 0) return list;
  } catch (error) {
    console.error('brasil-aberto cities, using IBGE', error);
  }
  const fallback = await fetchIbgeCities(state);
  if (fallback.length === 0) throw new Error('Não foi possível carregar cidades.');
  return fallback;
}

export async function fetchDistricts(city: {
  id: number;
  ibgeId?: number;
  source?: 'brasil-aberto' | 'ibge';
}): Promise<BrasilAbertoDistrict[]> {
  const queries = districtQueryForCity(city);
  let lastError: unknown;
  for (const query of queries) {
    try {
      const data = await invokeBrasilAberto<{ result?: BrasilAbertoDistrict[] }>(query);
      const list = Array.isArray(data?.result) ? data.result : [];
      if (list.length > 0) return list;
    } catch (error) {
      lastError = error;
      console.error('brasil-aberto districts', query.kind, error);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('Não foi possível carregar bairros.');
}
