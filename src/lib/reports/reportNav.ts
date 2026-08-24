export type ReportScope = 'global' | 'diretoria' | 'equipe' | 'coordenacao' | 'corretor';

export interface ReportHrefParams {
  scope?: ReportScope;
  id?: string;
  name?: string;
  from?: ReportScope;
  fromId?: string;
  fromName?: string;
  start?: string;
  end?: string;
  period?: string;
}

export interface BackTargetInput {
  currentScope: ReportScope;
  from?: string | null;
  fromId?: string | null;
  fromName?: string | null;
  directorateId?: string | null;
  directorateName?: string | null;
  start?: string;
  end?: string;
  period?: string;
}

const SCOPE_BACK_LABEL: Record<Exclude<ReportScope, 'global' | 'corretor'>, string> = {
  diretoria: 'Ver Relatório da Diretoria',
  equipe: 'Ver Relatório da Equipe',
  coordenacao: 'Ver Relatório da Coordenação',
};

function periodParams(input: { start?: string; end?: string; period?: string }): Pick<ReportHrefParams, 'start' | 'end' | 'period'> {
  return {
    start: input.start,
    end: input.end,
    period: input.period,
  };
}

export function buildReportHref(p: ReportHrefParams): string {
  const params = new URLSearchParams();
  if (p.scope && p.scope !== 'global') params.set('scope', p.scope);
  if (p.id) params.set('id', p.id);
  if (p.name) params.set('name', p.name);
  if (p.from && p.from !== 'global') params.set('from', p.from);
  if (p.fromId) params.set('fromId', p.fromId);
  if (p.fromName) params.set('fromName', p.fromName);
  if (p.start) params.set('start', p.start);
  if (p.end) params.set('end', p.end);
  if (p.period) params.set('period', p.period);
  const qs = params.toString();
  return qs ? `/reports?${qs}` : '/reports';
}

export function buildBackTarget(input: BackTargetInput): { href: string; label: string } {
  const dates = periodParams(input);

  if (input.currentScope === 'diretoria') {
    return { href: buildReportHref({ scope: 'global', ...dates }), label: 'Ver Relatório Global' };
  }

  if (input.currentScope === 'equipe') {
    if (input.directorateId) {
      return {
        href: buildReportHref({
          scope: 'diretoria',
          id: input.directorateId,
          name: input.directorateName || 'Diretoria',
          ...dates,
        }),
        label: 'Ver Relatório da Diretoria',
      };
    }
    return { href: buildReportHref({ scope: 'global', ...dates }), label: 'Ver Relatório Global' };
  }

  const from = (input.from || '') as ReportScope;
  if (from && input.fromId && from !== 'global' && from !== 'corretor') {
    return {
      href: buildReportHref({
        scope: from,
        id: input.fromId,
        name: input.fromName || '',
        ...dates,
      }),
      label: SCOPE_BACK_LABEL[from] ?? 'Ver Relatório Global',
    };
  }

  if (input.currentScope === 'coordenacao' && input.directorateId) {
    return {
      href: buildReportHref({
        scope: 'diretoria',
        id: input.directorateId,
        name: input.directorateName || 'Diretoria',
        ...dates,
      }),
      label: 'Ver Relatório da Diretoria',
    };
  }

  return { href: buildReportHref({ scope: 'global', ...dates }), label: 'Ver Relatório Global' };
}
