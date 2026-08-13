// Lista oficial de construtoras (campo "Construtora" da ficha do cliente).
// Ordem definida pelo negócio; AVULSO/OUTRO são os coringas no fim.
export const BUILDER_OUTRO = 'OUTRO';

export const BUILDERS: string[] = [
  'TENDA',
  'MRV',
  'NOVOLAR',
  'DIRECIONAL',
  'CURY',
  'EMCCAMP',
  'ACLA',
  'VIVERDE',
  'CELTA',
  'ENGEFIC',
  'CTV',
  'NURRA',
  'SIX',
  'RIVA',
  'VIC',
  'LIVING',
  'DC4',
  'VITALLE',
  'MÉRIDA',
  'VOCÊ',
  'AVULSO',
  BUILDER_OUTRO,
];

/** Valores legados que devem ser tratados como OUTRO na UI. */
const LEGACY_OUTRO = new Set(['OUTROS', 'OUTRO']);

/** Separa valor salvo no banco em seleção da lista + texto livre (OUTRO). */
export function parseBuilderValue(stored: string): { select: string; custom: string } {
  if (!stored) return { select: '', custom: '' };
  if (LEGACY_OUTRO.has(stored)) return { select: BUILDER_OUTRO, custom: '' };
  if (BUILDERS.includes(stored)) return { select: stored, custom: '' };
  return { select: BUILDER_OUTRO, custom: stored };
}
