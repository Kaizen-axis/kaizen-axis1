import type { InputHTMLAttributes } from 'react';
import { formatCpf, formatPhone } from '@/lib/masks';
import { cn } from '@/lib/utils';

type MaskedProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
};

export function CpfInput({ value, onChange, className, ...rest }: MaskedProps) {
  return (
    <input
      {...rest}
      inputMode="numeric"
      autoComplete="off"
      placeholder={rest.placeholder ?? '000.000.000-00'}
      value={formatCpf(value || '')}
      onChange={e => onChange(formatCpf(e.target.value))}
      className={cn(className)}
    />
  );
}

export function PhoneInput({ value, onChange, className, ...rest }: MaskedProps) {
  return (
    <input
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={rest.placeholder ?? '(21)97465-7027'}
      value={formatPhone(value || '')}
      onChange={e => onChange(formatPhone(e.target.value))}
      className={cn(className)}
    />
  );
}
