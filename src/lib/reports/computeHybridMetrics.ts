import { CLIENT_STAGES } from '@/data/clients';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd } from '@/lib/dateRange';

export interface ReportClientLike {
  id: string;
  name?: string;
  stage: string;
  createdAt: string;
  closed_at?: string | null;
  intendedValue?: string;
  owner_id?: string;
  directorate_id?: string | null;
  development?: string;
}

export interface PipelineStageCount {
  stage: string;
  count: number;
}

export interface HybridMetrics {
  snapshotClients: ReportClientLike[];
  createdInPeriod: ReportClientLike[];
  sales: ReportClientLike[];
  totalClientes: number;
  createdInPeriodCount: number;
  vendas: number;
  aprovados: number;
  taxaConversao: number;
  vgv: number;
  pipeline: PipelineStageCount[];
}

export function parseReportValue(v?: string | null): number {
  if (!v) return 0;
  const clean = v.replace(/[R$\s.]/g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

function parseIsoDate(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function isSaleInPeriod(
  client: ReportClientLike,
  start: number | null,
  end: number | null,
): boolean {
  if (client?.stage !== 'Concluído') return false;
  const saleDate = parseIsoDate(client?.closed_at);
  if (saleDate === null) return false;
  if (start !== null && saleDate < start) return false;
  if (end !== null && saleDate > end) return false;
  return true;
}

export function computeHybridMetrics(
  scopedClients: ReportClientLike[],
  startDate?: string,
  endDate?: string,
): HybridMetrics {
  const start = startDate ? parseDateOnlyLocal(startDate).getTime() : null;
  const end = endDate ? parseDateOnlyLocalEnd(endDate).getTime() : null;

  const snapshotClients = scopedClients;
  const createdInPeriod = scopedClients.filter((c) => {
    const created = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    if (start !== null && created < start) return false;
    if (end !== null && created > end) return false;
    return true;
  });
  const sales = scopedClients.filter((c) => isSaleInPeriod(c, start, end));
  const aprovados = createdInPeriod.filter((c) => c.stage === 'Aprovado').length;
  const createdInPeriodCount = createdInPeriod.length;
  const vendas = sales.length;
  const taxaConversao = createdInPeriodCount > 0
    ? Math.round((vendas / createdInPeriodCount) * 100)
    : 0;
  const vgv = sales.reduce((acc, c) => acc + parseReportValue(c.intendedValue), 0);

  const counts = new Map<string, number>();
  for (const c of createdInPeriod) {
    counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
  }
  const known = new Set(CLIENT_STAGES as readonly string[]);
  const pipeline: PipelineStageCount[] = CLIENT_STAGES.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
  }));
  for (const [stage, count] of counts) {
    if (!known.has(stage)) pipeline.push({ stage, count });
  }

  return {
    snapshotClients,
    createdInPeriod,
    sales,
    totalClientes: createdInPeriodCount,
    createdInPeriodCount,
    vendas,
    aprovados,
    taxaConversao,
    vgv,
    pipeline,
  };
}

export const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
