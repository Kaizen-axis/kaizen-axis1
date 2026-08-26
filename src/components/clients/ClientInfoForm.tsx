import { Client } from '@/data/clients';
import { RJ_CITIES, getNeighborhoods } from '@/data/cities';
import { BUILDERS } from '@/data/builders';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

const TEXT_FIELDS: Array<{ label: string; key: keyof Client | string }> = [
  { label: 'Nome', key: 'name' },
  { label: 'CPF', key: 'cpf' },
  { label: 'Email', key: 'email' },
  { label: 'Telefone', key: 'phone' },
  { label: 'Endereço', key: 'address' },
  { label: 'Profissão', key: 'profession' },
  { label: 'Renda Bruta', key: 'grossIncome' },
  { label: 'Empreendimento', key: 'development' },
  { label: 'Construtora', key: 'builder' },
  { label: 'Valor', key: 'intendedValue' },
  { label: 'Cidade de Interesse', key: 'regionOfInterest' },
  { label: 'Bairro', key: 'neighborhood' },
];

const INPUT_CLASS = 'w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary';

export function ClientInfoForm({
  value,
  onChange,
}: {
  value: Partial<Client>;
  onChange: (next: Partial<Client>) => void;
}) {
  const patch = (partial: Partial<Client>) => onChange({ ...value, ...partial });

  return (
    <div className="grid grid-cols-1 gap-4">
      {TEXT_FIELDS.map(({ label, key }) => (
        <div key={key}>
          <label className="text-xs text-text-secondary uppercase tracking-wider mb-1 block">{label}</label>
          {key === 'regionOfInterest' ? (
            <SearchableSelect
              value={(value as Record<string, string>)[key] || ''}
              onChange={(v) => patch({ regionOfInterest: v, neighborhood: '' })}
              options={RJ_CITIES}
              placeholder="Selecione a cidade"
              searchPlaceholder="Buscar cidade do RJ..."
            />
          ) : key === 'neighborhood' ? (
            getNeighborhoods(value.regionOfInterest).length > 0 ? (
              <SearchableSelect
                value={value.neighborhood || ''}
                onChange={(v) => patch({ neighborhood: v })}
                options={getNeighborhoods(value.regionOfInterest)}
                placeholder="Selecione o bairro"
                searchPlaceholder={`Buscar bairro em ${value.regionOfInterest}...`}
              />
            ) : (
              <input
                value={value.neighborhood || ''}
                onChange={(e) => patch({ neighborhood: e.target.value })}
                className={INPUT_CLASS}
                placeholder="Digite o bairro (opcional)"
              />
            )
          ) : key === 'builder' ? (
            <SearchableSelect
              value={value.builder || ''}
              onChange={(v) => patch({ builder: v })}
              options={BUILDERS}
              placeholder="Selecione a construtora"
              searchPlaceholder="Buscar construtora..."
            />
          ) : (
            <input
              value={(value as Record<string, string>)[key] || ''}
              onChange={(e) => {
                let val = e.target.value;
                if (key === 'intendedValue') {
                  let v = val.replace(/\D/g, '');
                  if (v) {
                    v = (parseInt(v, 10) / 100).toFixed(2);
                    val = v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                  } else {
                    val = '';
                  }
                }
                patch({ [key]: val } as Partial<Client>);
              }}
              className={INPUT_CLASS}
            />
          )}
        </div>
      ))}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div>
          <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Tipo de Renda</label>
          <select
            value={value.incomeType || ''}
            onChange={(e) => patch({ incomeType: e.target.value as Client['incomeType'] })}
            className={INPUT_CLASS}
          >
            <option value="">Selecione</option>
            <option value="Formal">Formal</option>
            <option value="Informal">Informal</option>
            <option value="Mista">Mista</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Cotista</label>
          <select
            value={value.cotista || ''}
            onChange={(e) => patch({ cotista: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">Selecione</option>
            <option value="Sim">Sim</option>
            <option value="Não">Não</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Fator Social</label>
          <select
            value={value.socialFactor || ''}
            onChange={(e) => patch({ socialFactor: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="">Selecione</option>
            <option value="Sim">Sim</option>
            <option value="Não">Não</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-text-secondary uppercase tracking-wider mb-1 block">Observações</label>
        <textarea
          value={value.observations || ''}
          onChange={(e) => patch({ observations: e.target.value })}
          className={`${INPUT_CLASS} min-h-[80px]`}
        />
      </div>
    </div>
  );
}
