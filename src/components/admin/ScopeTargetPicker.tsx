import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isActiveProfile } from '@/lib/reports/teamMembers';
import {
  SCOPE_LABELS,
  type NamedEntity,
  type ScopeTargetValue,
  type ScopeType,
  type ScopedProfile,
} from '@/lib/admin/scopeTarget';

interface ScopeTargetPickerProps {
  scopes: ScopeType[];
  value: ScopeTargetValue;
  onChange: (value: ScopeTargetValue) => void;
  directorates?: NamedEntity[];
  teams?: NamedEntity[];
  coordinators?: NamedEntity[];
  profiles?: ScopedProfile[];
  className?: string;
}

const norm = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function ScopeTargetPicker({
  scopes,
  value,
  onChange,
  directorates = [],
  teams = [],
  coordinators = [],
  profiles = [],
  className,
}: ScopeTargetPickerProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
  }, [value.type]);

  const options = useMemo(() => {
    const asOptions = (items: NamedEntity[], fallback: string) =>
      items.map((item) => ({ id: item.id, label: item.name || fallback, hint: undefined as string | undefined }));

    if (value.type === 'Directorate') return asOptions(directorates, 'Diretoria');
    if (value.type === 'Team') return asOptions(teams, 'Equipe');
    if (value.type === 'Coordinator') return asOptions(coordinators, 'Coordenador');
    if (value.type === 'User') {
      return profiles
        .filter((profile) => isActiveProfile(profile as { status?: string | null }))
        .map((profile) => ({
          id: profile.id,
          label: profile.name || 'Usuário',
          hint: profile.role || undefined,
        }));
    }
    return [] as Array<{ id: string; label: string; hint?: string }>;
  }, [value.type, directorates, teams, coordinators, profiles]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return options;
    return options.filter((opt) => norm(opt.label).includes(q) || norm(opt.hint).includes(q));
  }, [options, query]);

  const selectScope = (type: ScopeType) => {
    setQuery('');
    onChange(type === 'All' ? { type: 'All' } : { type, id: undefined });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <label className="block text-sm font-medium text-text-secondary">Destinar para</label>
      <div className="flex flex-wrap gap-1.5">
        {scopes.map((scope) => {
          const selected = value.type === scope;
          return (
            <button
              key={scope}
              type="button"
              onClick={() => selectScope(scope)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                selected
                  ? 'bg-gold-500 text-white shadow-sm'
                  : 'bg-surface-50 text-text-secondary hover:text-text-primary hover:bg-surface-100',
              )}
            >
              {SCOPE_LABELS[scope]}
            </button>
          );
        })}
      </div>

      {value.type !== 'All' && (
        <div className="rounded-xl border border-surface-200 bg-card-bg overflow-hidden">
          <div className="relative border-b border-surface-100">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar ${SCOPE_LABELS[value.type].toLowerCase()}...`}
              className="w-full pl-8 pr-3 py-2.5 bg-transparent text-sm text-text-primary border-none focus:ring-0 placeholder:text-text-secondary"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-text-secondary text-center">Nenhum resultado.</p>
            ) : (
              filtered.map((opt) => {
                const selected = value.id === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange({ type: value.type, id: opt.id })}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-100',
                      selected ? 'text-gold-500 font-semibold bg-accent-subtle' : 'text-text-primary',
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.hint && <span className="text-[10px] text-text-secondary flex-shrink-0">{opt.hint}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
