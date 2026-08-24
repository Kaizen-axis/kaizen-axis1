import { parseDateOnlyLocal, parseDateOnlyLocalEnd } from '@/lib/dateRange';
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

const DAY_MS = 86400000;
const ddMm = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

function buildPeriodBuckets(start: Date, end: Date): Bucket[] {
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const buckets: Bucket[] = [];

  if (spanDays <= 31) {
    for (let i = 0; i < spanDays; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      buckets.push({ label: ddMm(d), start: d.getTime(), end: endOfDay(d.getFullYear(), d.getMonth(), d.getDate()) });
    }
    return buckets;
  }

  if (spanDays <= 92) {
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cursor.getTime() <= end.getTime()) {
      const bEnd = new Date(Math.min(cursor.getTime() + 6 * DAY_MS, end.getTime()));
      buckets.push({
        label: ddMm(cursor),
        start: cursor.getTime(),
        end: endOfDay(bEnd.getFullYear(), bEnd.getMonth(), bEnd.getDate()),
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    }
    return buckets;
  }

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    buckets.push({ label: monthShort(y, m), start: cursor.getTime(), end: endOfDay(y, m + 1, 0) });
    cursor = new Date(y, m + 1, 1);
  }
  return buckets;
}

export function buildPeriodSeries(
  clients: ReportClientLike[],
  startDate: string,
  endDate: string,
): EvolutionPoint[] {
  const start = parseDateOnlyLocal(startDate);
  const end = parseDateOnlyLocalEnd(endDate);
  return buildPeriodBuckets(start, end).map((bucket) => {
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
