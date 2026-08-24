import { Profile } from '@/context/AppContext';
import { computeHybridMetrics, ReportClientLike } from './computeHybridMetrics';

export interface SearchableBroker {
  id: string;
  name: string;
  total: number;
  vendas: number;
  aprovados: number;
  vgv: number;
}

export function rankBrokers(
  brokers: Pick<Profile, 'id' | 'name'>[],
  clients: ReportClientLike[],
  startDate?: string,
  endDate?: string,
): SearchableBroker[] {
  return brokers
    .map((p) => {
      const scoped = clients.filter((c) => c.owner_id === p.id);
      const metrics = computeHybridMetrics(scoped, startDate, endDate);
      return {
        id: p.id,
        name: p.name,
        total: metrics.totalClientes,
        vendas: metrics.vendas,
        aprovados: metrics.aprovados,
        vgv: metrics.vgv,
      };
    })
    .sort((a, b) => b.vendas - a.vendas || b.total - a.total);
}

/**
 * Ordem para o ranking nos PDFs: quem vendeu no período primeiro (vendas desc,
 * desempate alfabético), depois quem não vendeu, em ordem alfabética.
 */
export function sortBrokersForReport<T extends { name: string; vendas: number }>(brokers: T[]): T[] {
  const sellers = brokers
    .filter((b) => b.vendas > 0)
    .sort((a, b) => b.vendas - a.vendas || a.name.localeCompare(b.name, 'pt-BR'));
  const others = brokers
    .filter((b) => b.vendas === 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return [...sellers, ...others];
}
