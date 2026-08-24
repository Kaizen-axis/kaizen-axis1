import { useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
    STAGE_WEIGHTS,
    GlobalMetrics,
    WeightedPipelineEntry,
    ClientHealthScore,
} from '@/types/reports';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd } from '@/lib/dateRange';

const parseCurrency = (v: string | undefined | null): number => {
    if (!v) return 0;
    return parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
};

interface UseReportsDataOptions {
    startDate?: string;
    endDate?: string;
}

interface UseReportsDataResult {
    globalMetrics: GlobalMetrics;
    weightedPipeline: WeightedPipelineEntry[];
    forecastTotal: number;
    healthScores: ClientHealthScore[];
    filteredClientsCount: number;
    filteredLeadsCount: number;
}

export function useReportsData({ startDate, endDate }: UseReportsDataOptions = {}): UseReportsDataResult {
    const { clients, leads } = useApp();

    const rangeStart = startDate ? parseDateOnlyLocal(startDate) : null;
    const rangeEnd = endDate ? parseDateOnlyLocalEnd(endDate) : null;

    const filteredClients = useMemo(() => {
        return clients.filter(c => {
            const created = new Date(c.createdAt);
            if (rangeStart && created < rangeStart) return false;
            if (rangeEnd && created > rangeEnd) return false;
            return true;
        });
    }, [clients, rangeStart, rangeEnd]);

    const filteredLeads = useMemo(() => {
        return leads.filter((l: any) => {
            const createdRaw = (l as any).created_at || (l as any).timestamp;
            if (!createdRaw) return false;
            const created = new Date(createdRaw);
            if (rangeStart && created < rangeStart) return false;
            if (rangeEnd && created > rangeEnd) return false;
            return true;
        });
    }, [leads, rangeStart, rangeEnd]);

    const globalMetrics = useMemo((): GlobalMetrics => {
        const total = filteredClients.length;
        const vendas = clients.filter(c => {
            if (c.stage !== 'Concluído') return false;
            const closedRaw = c.closed_at;
            if (!closedRaw) return false;
            const closedDate = new Date(closedRaw);
            if (rangeStart && closedDate < rangeStart) return false;
            if (rangeEnd && closedDate > rangeEnd) return false;
            return true;
        });
        const totalVendas = vendas.length;
        const taxaConversao = total > 0 ? (totalVendas / total) * 100 : 0;
        const ciclosComDados = vendas.filter(c => c.closed_at);
        const cicloMedioDias =
            ciclosComDados.length > 0
                ? ciclosComDados.reduce((acc, c) => {
                    const closedDate = c.closed_at!;
                    const days =
                        (new Date(closedDate).getTime() - new Date(c.createdAt).getTime()) /
                        (1000 * 60 * 60 * 24);
                    return acc + Math.max(0, days);
                }, 0) / ciclosComDados.length
                : 0;

        return {
            totalVendas,
            novosLeads: filteredLeads.length,
            taxaConversao: parseFloat(taxaConversao.toFixed(1)),
            cicloMedioDias: parseFloat(cicloMedioDias.toFixed(1)),
        };
    }, [clients, filteredClients, filteredLeads, rangeStart, rangeEnd]);

    const { weightedPipeline, forecastTotal } = useMemo(() => {
        const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        let totalWeightedBRL = 0;
        const pipeline: WeightedPipelineEntry[] = months.map((m, i) => {
            const monthClients = clients.filter(c => new Date(c.createdAt).getMonth() === i);
            const weighted = monthClients.reduce((acc, c) => {
                const val = parseCurrency(c.intendedValue);
                const weight = STAGE_WEIGHTS[c.stage] ?? 0;
                return acc + val * weight;
            }, 0);
            const confirmed = clients
                .filter(c => {
                    if (c.stage !== 'Concluído') return false;
                    const closedRaw = c.closed_at;
                    if (!closedRaw) return false;
                    return new Date(closedRaw).getMonth() === i;
                })
                .reduce((acc, c) => acc + parseCurrency(c.intendedValue), 0);
            totalWeightedBRL += weighted;
            return { month: m, weighted: weighted / 1000, confirmed: confirmed / 1000 };
        });
        return { weightedPipeline: pipeline, forecastTotal: totalWeightedBRL };
    }, [clients]);

    return {
        globalMetrics,
        weightedPipeline,
        forecastTotal,
        healthScores: [],
        filteredClientsCount: filteredClients.length,
        filteredLeadsCount: filteredLeads.length,
    };
}
