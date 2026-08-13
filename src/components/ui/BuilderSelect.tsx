import { useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { BUILDERS, BUILDER_OUTRO, parseBuilderValue } from '@/data/builders';
import { cn } from '@/lib/utils';

interface BuilderSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  inputClassName?: string;
}

export function BuilderSelect({
  value,
  onChange,
  placeholder = 'Selecione a construtora',
  searchPlaceholder = 'Buscar construtora...',
  className,
  inputClassName,
}: BuilderSelectProps) {
  const parsed = parseBuilderValue(value);
  const [outroMode, setOutroMode] = useState(parsed.select === BUILDER_OUTRO);

  useEffect(() => {
    setOutroMode(parseBuilderValue(value).select === BUILDER_OUTRO);
  }, [value]);

  const selectValue = outroMode || parsed.select === BUILDER_OUTRO ? BUILDER_OUTRO : parsed.select;
  const showCustomInput = selectValue === BUILDER_OUTRO;
  const customValue = parsed.select === BUILDER_OUTRO ? parsed.custom : '';

  return (
    <div className={cn('space-y-2', className)}>
      <SearchableSelect
        value={selectValue}
        onChange={(v) => {
          if (v === BUILDER_OUTRO) {
            setOutroMode(true);
            onChange('');
            return;
          }
          setOutroMode(false);
          onChange(v);
        }}
        options={BUILDERS}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
      />
      {showCustomInput && (
        <input
          value={customValue}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-sm text-text-primary',
            inputClassName,
          )}
          placeholder="Digite o nome da construtora"
        />
      )}
    </div>
  );
}
