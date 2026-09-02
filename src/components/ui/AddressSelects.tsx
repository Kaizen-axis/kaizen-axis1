import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { fetchCities, fetchDistricts, fetchStates, type BrasilAbertoCity } from '@/lib/brasilAberto';

export interface AddressValue {
  state: string;
  city: string;
  neighborhood: string;
}

export function AddressSelects({
  value,
  onChange,
}: {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
}) {
  const [states, setStates] = useState<{ shortName: string; name: string }[]>([]);
  const [cities, setCities] = useState<BrasilAbertoCity[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [loadingStates, setLoadingStates] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingStates(true);
    fetchStates()
      .then(list => {
        if (cancelled) return;
        setStates(list);
        setError(list.length === 0 ? 'Não foi possível carregar estados.' : null);
      })
      .catch(() => {
        if (cancelled) return;
        setStates([]);
        setError('Não foi possível carregar estados.');
      })
      .finally(() => { if (!cancelled) setLoadingStates(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const uf = value.state.trim().toUpperCase();
    if (!uf) {
      setCities([]);
      setDistricts([]);
      return;
    }
    let cancelled = false;
    setLoadingCities(true);
    fetchCities(uf)
      .then(list => {
        if (cancelled) return;
        setCities(list);
        if (list.length === 0) setError('Não foi possível carregar cidades.');
        else setError(prev => (prev === 'Não foi possível carregar cidades.' ? null : prev));
      })
      .catch(() => {
        if (cancelled) return;
        setCities([]);
        setError('Não foi possível carregar cidades.');
      })
      .finally(() => { if (!cancelled) setLoadingCities(false); });
    return () => { cancelled = true; };
  }, [value.state]);

  const selectedCity = useMemo(
    () => cities.find(c => c.name.toLocaleLowerCase('pt-BR') === value.city.trim().toLocaleLowerCase('pt-BR')),
    [cities, value.city],
  );

  useEffect(() => {
    if (!selectedCity) {
      setDistricts([]);
      setLoadingDistricts(false);
      return;
    }
    let cancelled = false;
    setLoadingDistricts(true);
    fetchDistricts(selectedCity)
      .then(list => {
        if (cancelled) return;
        setDistricts(list.map(d => d.name));
        if (list.length === 0) setError('Não foi possível carregar bairros.');
        else setError(prev => (prev === 'Não foi possível carregar bairros.' ? null : prev));
      })
      .catch(() => {
        if (cancelled) return;
        setDistricts([]);
        setError('Não foi possível carregar bairros.');
      })
      .finally(() => { if (!cancelled) setLoadingDistricts(false); });
    return () => { cancelled = true; };
  }, [selectedCity?.id, selectedCity?.ibgeId]);

  const stateOptions = states.map(s => `${s.shortName} — ${s.name}`);
  const stateDisplay = states.find(s => s.shortName === value.state.trim().toUpperCase());
  const stateSelectValue = stateDisplay ? `${stateDisplay.shortName} — ${stateDisplay.name}` : value.state;

  const cityOptions = cities.map(c => c.name);
  const districtOptions = districts.length > 0
    ? districts
    : (value.neighborhood ? [value.neighborhood] : []);

  const neighborhoodPlaceholder = !value.city
    ? 'Selecione a cidade'
    : (loadingDistricts
      ? 'Carregando bairros...'
      : (districts.length > 0 ? 'Selecione o bairro' : 'Digite o bairro'));

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Estado</label>
          <SearchableSelect
            value={stateSelectValue}
            onChange={(next) => {
              const uf = next.split('—')[0].trim().toUpperCase();
              onChange({ state: uf, city: '', neighborhood: '' });
            }}
            options={loadingStates && stateOptions.length === 0 ? (value.state ? [value.state] : []) : stateOptions}
            placeholder={loadingStates ? 'Carregando estados...' : 'Selecione o estado'}
            searchPlaceholder="Buscar estado..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Cidade</label>
          <SearchableSelect
            value={value.city}
            onChange={(city) => onChange({ ...value, city, neighborhood: '' })}
            options={cityOptions.length > 0 ? cityOptions : (value.city ? [value.city] : [])}
            placeholder={!value.state ? 'Selecione o estado' : (loadingCities ? 'Carregando cidades...' : 'Selecione a cidade')}
            searchPlaceholder="Buscar cidade..."
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Bairro</label>
          <SearchableSelect
            value={value.neighborhood}
            onChange={(neighborhood) => onChange({ ...value, neighborhood })}
            options={districtOptions}
            placeholder={neighborhoodPlaceholder}
            searchPlaceholder="Buscar bairro..."
            allowCustom
          />
        </div>
      </div>
    </div>
  );
}
