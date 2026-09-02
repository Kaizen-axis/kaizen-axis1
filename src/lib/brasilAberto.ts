import { supabase } from '@/lib/supabase';
import { districtQueryForCity, toPositiveInt } from '@/lib/brasilAbertoDistricts';

export type BrasilAbertoState = { name: string; shortName: string };
export type BrasilAbertoCity = { id: number; ibgeId?: number; name: string };
export type BrasilAbertoDistrict = { id: number; name: string };

function functionErrorMessage(error: unknown): string {
  const err = error as { name?: string; message?: string; context?: { json?: () => Promise<unknown> } };
  return err?.message || 'Falha ao consultar endereço';
}

async function invokeBrasilAberto<T>(body: Record<string, unknown>): Promise<T> {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
  }
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

function mapCity(city: { id?: unknown; ibgeId?: unknown; name?: unknown }): BrasilAbertoCity | null {
  const id = toPositiveInt(city.id);
  const name = String(city.name || '').trim();
  if (!id || !name) return null;
  const ibgeId = toPositiveInt(city.ibgeId);
  return ibgeId ? { id, ibgeId, name } : { id, name };
}

export async function fetchStates(): Promise<BrasilAbertoState[]> {
  const data = await invokeBrasilAberto<{ result?: BrasilAbertoState[] }>({ kind: 'states' });
  const list = Array.isArray(data?.result) ? data.result : [];
  if (list.length === 0) throw new Error('Não foi possível carregar estados.');
  return list;
}

export async function fetchCities(state: string): Promise<BrasilAbertoCity[]> {
  const data = await invokeBrasilAberto<{ result?: { id?: unknown; ibgeId?: unknown; name?: unknown }[] }>({
    kind: 'cities',
    state,
  });
  const list = Array.isArray(data?.result)
    ? data.result.map(mapCity).filter((city): city is BrasilAbertoCity => city !== null)
    : [];
  if (list.length === 0) throw new Error('Não foi possível carregar cidades.');
  return list;
}

export async function fetchDistricts(city: {
  id: number;
  ibgeId?: number;
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
