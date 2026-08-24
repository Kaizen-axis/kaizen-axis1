import { useCallback, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { CLIENT_STAGES } from '@/data/clients';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd, toDateOnlyLocal } from '@/lib/dateRange';
import {
  aggregateClientsBy,
  getTeamMemberIds,
  isSaleInPeriod,
  normalizeText,
  parseCurrency,
  profileMatchesTeam,
} from '@/lib/reportUtils';
import type {
  CategorySlice,
  OpsGroupReportRow,
  OpsRankingRow,
  PipelineStageRow,
  TrendPoint,
} from '@/types/reports';

// ─── Operations Report aggregations ───────────────────────────────────────────
// Period-filtered operational metrics/charts previously computed inline inside
// AdminPanel's 'reports' tab. Now the single source for the /reports hub.

interface UseOperationsReportOptions {
  startDate?: string; // 'YYYY-MM-DD'
  endDate?: string;   // 'YYYY-MM-DD'
}

const FAR_PAST = new Date(1970, 0, 1);
const FAR_FUTURE = new Date(2999, 11, 31, 23, 59, 59, 999);

const isEligibleForBrokerRanking = (role?: string | null) => {
  const normalizedRole = String(role || '').toUpperCase();
  return normalizedRole === 'CORRETOR' || normalizedRole === 'COORDENADOR' || normalizedRole === 'GERENTE';
};

const compareRankingRows = (a: OpsRankingRow, b: OpsRankingRow) => (
  Number(b.Ri || 0) - Number(a.Ri || 0) ||
  Number(b.Vi || 0) - Number(a.Vi || 0) ||
  Number(b.Li || 0) - Number(a.Li || 0) ||
  String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR') ||
  String(a.entity_id || '').localeCompare(String(b.entity_id || ''))
);

export function useOperationsReport({ startDate, endDate }: UseOperationsReportOptions = {}) {
  const { clients, leads, allProfiles, teams, appointments } = useApp();

  const rangeStart = useMemo(() => (startDate ? parseDateOnlyLocal(startDate) : FAR_PAST), [startDate]);
  const rangeEnd = useMemo(() => (endDate ? parseDateOnlyLocalEnd(endDate) : FAR_FUTURE), [endDate]);
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();

  // ── Period-filtered cohorts ────────────────────────────────────────────────
  const periodClients = useMemo(() => clients.filter((c) => {
    const created = new Date(c.createdAt);
    return created >= rangeStart && created <= rangeEnd;
  }), [clients, rangeStart, rangeEnd]);

  const periodLeads = useMemo(() => leads.filter((l: any) => {
    const created = new Date((l as any).created_at || l.timestamp);
    return created >= rangeStart && created <= rangeEnd;
  }), [leads, rangeStart, rangeEnd]);

  // Sales = 'Concluído' clients whose closed_at falls inside the range
  const periodSales = useMemo(
    () => clients.filter((c) => isSaleInPeriod(c, startMs, endMs)),
    [clients, startMs, endMs],
  );

  const periodSalesCount = periodSales.length;
  const vgv = useMemo(
    () => periodSales.reduce((acc, c) => acc + parseCurrency(c.intendedValue), 0),
    [periodSales],
  );
  const conversion = periodClients.length > 0
    ? Number(((periodSalesCount / periodClients.length) * 100).toFixed(1))
    : 0;
  const approved = useMemo(
    () => periodClients.filter((c) => c.stage === 'Aprovado').length,
    [periodClients],
  );

  const upcomingAppointmentsCount = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return appointments.filter((a) => a.date >= todayStr).length;
  }, [appointments]);

  // ── Pipeline distribution (clients per stage in period) ────────────────────
  const pipelineByStage = useMemo<PipelineStageRow[]>(() =>
    CLIENT_STAGES
      .map((stage) => {
        const quantidade = periodClients.filter((c) => c.stage === stage).length;
        const percentual = periodClients.length > 0
          ? Number(((quantidade / periodClients.length) * 100).toFixed(2))
          : 0;
        return { etapa: stage as string, quantidade, percentual };
      })
      .filter((row) => row.quantidade > 0),
    [periodClients]);

  // ── Trend: Leads × Vendas × Receita grouped by day (or week if > 31 days) ──
  const trendData = useMemo<TrendPoint[]>(() => {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const daysDiff = Math.max(0, Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / MS_DAY));
    const groupByWeek = daysDiff > 31;

    const normalizePeriod = (d: Date) => {
      const local = new Date(d);
      if (groupByWeek) {
        const day = local.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day;
        local.setDate(local.getDate() + diffToMonday);
      }
      local.setHours(0, 0, 0, 0);
      return toDateOnlyLocal(local);
    };

    const buckets = new Map<string, TrendPoint>();

    const cursor = new Date(rangeStart);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= rangeEnd) {
      const key = normalizePeriod(cursor);
      if (!buckets.has(key)) buckets.set(key, { periodo: key, Lt: 0, Vt: 0, Rt: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    periodLeads.forEach((lead) => {
      const key = normalizePeriod(new Date((lead as any).created_at || lead.timestamp));
      const bucket = buckets.get(key);
      if (bucket) bucket.Lt += 1;
    });

    periodSales.forEach((client) => {
      const closedRaw = (client as any).closed_at;
      if (!closedRaw) return;
      const key = normalizePeriod(new Date(closedRaw));
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.Vt += 1;
        bucket.Rt += parseCurrency(client.intendedValue);
      }
    });

    return Array.from(buckets.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
  }, [rangeStart, rangeEnd, periodLeads, periodSales]);

  // ── Geography & builders ───────────────────────────────────────────────────
  const regionData = useMemo<CategorySlice[]>(
    () => aggregateClientsBy((c) => c.regionOfInterest, periodClients).slice(0, 8),
    [periodClients],
  );
  const builderData = useMemo<CategorySlice[]>(
    () => aggregateClientsBy((c) => c.builder, periodClients).slice(0, 8),
    [periodClients],
  );

  /** Drill-down: neighborhoods of the selected city */
  const getDrillBairroData = useCallback(
    (city: string): CategorySlice[] =>
      aggregateClientsBy(
        (c) => c.neighborhood,
        periodClients.filter((c) => normalizeText(c.regionOfInterest || '') === normalizeText(city)),
      ).slice(0, 10),
    [periodClients],
  );

  // ── Rankings ───────────────────────────────────────────────────────────────
  const brokerRanking = useMemo<OpsRankingRow[]>(() => {
    const brokers = allProfiles.filter((p) => isEligibleForBrokerRanking(p.role));

    return brokers
      .map((p): OpsRankingRow | null => {
        const createdByBroker = periodClients.filter((c) => (c as any).owner_id === p.id);
        const salesByBroker = periodSales.filter((c) => (c as any).owner_id === p.id);
        if (createdByBroker.length === 0 && salesByBroker.length === 0) return null;

        const vi = salesByBroker.length;
        const ri = salesByBroker.reduce((acc, c) => acc + parseCurrency(c.intendedValue), 0);
        return {
          entity_id: p.id,
          corretor_id: p.id,
          nome: p.name,
          Li: createdByBroker.length,
          Vi: vi,
          Taxa_Conversao_i: createdByBroker.length > 0 ? Math.round((vi / createdByBroker.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter((row): row is OpsRankingRow => row !== null)
      .sort((a, b) => b.Vi - a.Vi || b.Ri - a.Ri);
  }, [allProfiles, periodClients, periodSales]);

  const brokerRankingTop3 = useMemo(
    () => [...brokerRanking].sort(compareRankingRows).slice(0, 3),
    [brokerRanking],
  );

  const managerRankingTop3 = useMemo<OpsRankingRow[]>(() => {
    const managers = allProfiles.filter((p) => p.role?.toUpperCase() === 'GERENTE');

    return managers
      .map((manager): OpsRankingRow | null => {
        const managedTeams = teams.filter((t) => t.manager_id === manager.id);
        const managedTeamIds = managedTeams.map((t) => t.id);

        const memberIds = Array.from(new Set([
          manager.id,
          ...managedTeams.flatMap((t) => t.members ?? []),
          ...allProfiles
            .filter((p: any) => managedTeamIds.includes(p.team_id || p.team))
            .map((p) => p.id),
          ...allProfiles
            .filter((p: any) => p.manager_id === manager.id)
            .map((p) => p.id),
        ]));

        const createdByManager = periodClients.filter((c) => memberIds.includes((c as any).owner_id));
        const salesByManager = periodSales.filter((c) => memberIds.includes((c as any).owner_id));
        if (createdByManager.length === 0 && salesByManager.length === 0) return null;

        const vi = salesByManager.length;
        const ri = salesByManager.reduce((acc, c) => acc + parseCurrency(c.intendedValue), 0);
        return {
          entity_id: manager.id,
          nome: manager.name,
          Li: createdByManager.length,
          Vi: vi,
          Taxa_Conversao_i: createdByManager.length > 0 ? Math.round((vi / createdByManager.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter((row): row is OpsRankingRow => row !== null)
      .sort(compareRankingRows)
      .slice(0, 3);
  }, [allProfiles, teams, periodClients, periodSales]);

  const coordinatorRankingTop3 = useMemo<OpsRankingRow[]>(() => {
    const coordinators = allProfiles.filter((p) => p.role?.toUpperCase() === 'COORDENADOR');

    return coordinators
      .map((coord): OpsRankingRow | null => {
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coord.id)
          .map((p) => p.id)));

        const createdByCoord = periodClients.filter((c) => brokerIds.includes((c as any).owner_id));
        const salesByCoord = periodSales.filter((c) => brokerIds.includes((c as any).owner_id));
        if (createdByCoord.length === 0 && salesByCoord.length === 0) return null;

        const vi = salesByCoord.length;
        const ri = salesByCoord.reduce((acc, c) => acc + parseCurrency(c.intendedValue), 0);
        return {
          entity_id: coord.id,
          nome: coord.name,
          Li: createdByCoord.length,
          Vi: vi,
          Taxa_Conversao_i: createdByCoord.length > 0 ? Math.round((vi / createdByCoord.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter((row): row is OpsRankingRow => row !== null)
      .sort(compareRankingRows)
      .slice(0, 3);
  }, [allProfiles, periodClients, periodSales]);

  // ── Grouped reports (PDF exports) ──────────────────────────────────────────
  const reportByTeam = useMemo<OpsGroupReportRow[]>(() =>
    teams
      .map((team) => {
        const teamMemberIds = Array.from(new Set([
          ...getTeamMemberIds(team, allProfiles),
          team.manager_id,
        ].filter(Boolean) as string[]));
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => profileMatchesTeam(p, team) && p.role?.toUpperCase() === 'CORRETOR')
          .map((p) => p.id)));

        const clientsByTeam = periodClients.filter((c: any) => teamMemberIds.includes(String(c?.owner_id || '')));
        const salesByTeam = periodSales.filter((c: any) => teamMemberIds.includes(String(c?.owner_id || '')));
        const clientes = clientsByTeam.length;
        const vendas = salesByTeam.length;
        const receita = salesByTeam.reduce((acc, c) => acc + parseCurrency((c as any).intendedValue), 0);
        const conversao = clientes > 0 ? Math.round((vendas / clientes) * 100) : 0;

        return { nome: team.name, corretores: brokerIds.length, clientes, vendas, conversao, receita };
      })
      .filter((row) => row.clientes > 0 || row.vendas > 0 || row.receita > 0)
      .sort((a, b) => b.vendas - a.vendas || b.receita - a.receita),
    [teams, allProfiles, periodClients, periodSales]);

  const reportByCoordination = useMemo<OpsGroupReportRow[]>(() => {
    const brokerMap = new Map(brokerRanking.map((row) => [row.corretor_id, row]));

    return allProfiles
      .filter((p) => p.role?.toUpperCase() === 'COORDENADOR')
      .map((coord) => {
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => p.coordinator_id === coord.id && p.role?.toUpperCase() === 'CORRETOR')
          .map((p) => p.id)));

        const rows = brokerIds.map((id) => brokerMap.get(id)).filter(Boolean) as OpsRankingRow[];
        const clientes = rows.reduce((acc, row) => acc + Number(row.Li || 0), 0);
        const vendas = rows.reduce((acc, row) => acc + Number(row.Vi || 0), 0);
        const receita = rows.reduce((acc, row) => acc + Number(row.Ri || 0), 0);
        const conversao = clientes > 0 ? Math.round((vendas / clientes) * 100) : 0;

        return { nome: coord.name, corretores: brokerIds.length, clientes, vendas, conversao, receita };
      })
      .filter((row) => row.corretores > 0 || row.clientes > 0 || row.vendas > 0)
      .sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);
  }, [allProfiles, brokerRanking]);

  return {
    rangeStart,
    rangeEnd,
    periodLeads,
    periodClients,
    periodSales,
    periodSalesCount,
    vgv,
    conversion,
    approved,
    upcomingAppointmentsCount,
    pipelineByStage,
    trendData,
    regionData,
    builderData,
    getDrillBairroData,
    brokerRanking,
    brokerRankingTop3,
    managerRankingTop3,
    coordinatorRankingTop3,
    reportByTeam,
    reportByCoordination,
  };
}
