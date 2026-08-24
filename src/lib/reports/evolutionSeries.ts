import { parseReportValue, ReportClientLike } from './computeHybridMetrics';

export type EvolutionGranularity = 'mensal' | 'trimestral' | 'semestral' | 'anual';

export interface EvolutionPoint {
  label: string;
  vendas: number;
  vgv: number;
}

interface Bucket {
  label: string;
  start: number;
  end: number;
}

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const monthShort = (year: number, month: number) =>
  `${MONTH_NAMES[month]}/${String(year).slice(2)}`;

function endOfDay(year: number, month: number, day: number): number {
  return new Date(year, month, day, 23, 59, 59, 999).getTime();
}

function buildBuckets(granularity: EvolutionGranularity, ref: Date): Bucket[] {
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const buckets: Bucket[] = [];

  if (granularity === 'mensal') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      buckets.push({
        label: monthShort(y, m),
        start: d.getTime(),
        end: endOfDay(y, m + 1, 0),
      });
    }
    return buckets;
  }

  if (granularity === 'trimestral') {
    const currentQuarter = Math.floor(month / 3);
    for (let i = 7; i >= 0; i--) {
      const qIndex = currentQuarter - i;
      const y = year + Math.floor(qIndex / 4);
      const q = ((qIndex % 4) + 4) % 4;
      const startMonth = q * 3;
      buckets.push({
        label: `T${q + 1}/${String(y).slice(2)}`,
        start: new Date(y, startMonth, 1).getTime(),
        end: endOfDay(y, startMonth + 3, 0),
      });
    }
    return buckets;
  }

  if (granularity === 'semestral') {
    const currentSem = Math.floor(month / 6);
    for (let i = 5; i >= 0; i--) {
      const sIndex = currentSem - i;
      const y = year + Math.floor(sIndex / 2);
      const s = ((sIndex % 2) + 2) % 2;
      const startMonth = s * 6;
      buckets.push({
        label: `S${s + 1}/${String(y).slice(2)}`,
        start: new Date(y, startMonth, 1).getTime(),
        end: endOfDay(y, startMonth + 6, 0),
      });
    }
    return buckets;
  }

  for (let i = 4; i >= 0; i--) {
    const y = year - i;
    buckets.push({
      label: String(y),
      start: new Date(y, 0, 1).getTime(),
      end: endOfDay(y + 1, 0, 0),
    });
  }
  return buckets;
}

export function buildEvolutionSeries(
  clients: ReportClientLike[],
  granularity: EvolutionGranularity,
  referenceDate: Date = new Date(),
): EvolutionPoint[] {
  return buildBuckets(granularity, referenceDate).map((bucket) => {
    const sales = clients.filter((c) => {
      if (c.stage !== 'Concluído' || !c.closed_at) return false;
      const closed = new Date(c.closed_at).getTime();
      return closed >= bucket.start && closed <= bucket.end;
    });
    return {
      label: bucket.label,
      vendas: sales.length,
      vgv: sales.reduce((acc, c) => acc + parseReportValue(c.intendedValue), 0),
    };
  });
}
