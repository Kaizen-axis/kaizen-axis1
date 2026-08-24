import React, { useState, useEffect } from 'react';
import { PageHeader, PremiumCard, RoundedButton } from '@/components/ui/PremiumComponents';
import { Users, Shield, ShieldCheck, Target, Megaphone, BarChart3, Plus, Search, Trophy, Download, FileSpreadsheet, FileText, Trash2, Edit2, ChevronDown, ChevronLeft, Calendar, Loader2, Building2, TrendingUp, Printer, Star, Award, Zap, Flame, MoreHorizontal, FileDown, MapPin } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useApp, Team, Goal, Announcement, Directorate } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Navigate, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '@/lib/supabase';
import { PDFDocument } from 'pdf-lib';
import { PAGE, PDF_THEME, embedFonts, loadKaizenLogo, drawReportHeader, drawSectionTitle, drawKeyValues, drawDivider, drawContinuationHeader, drawHBars, addStandardFooters, downloadPdf, safeText } from '@/lib/pdf/reportKit';
import PipelinePdfExport from '@/components/admin/PipelinePdfExport';
import { useReportsData } from '@/hooks/useReportsData';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd, toDateOnlyLocal, toPtBrDate } from '@/lib/dateRange';
import { CLIENT_STAGES } from '@/data/clients';

type Tab = 'users' | 'teams' | 'goals' | 'announcements' | 'reports' | 'directorates' | 'gamification';

export default function AdminPanel() {
  // ── Hard role guard: only ADMIN and DIRETOR can access this page ────────────
  const { isAdmin, isDirector } = useAuthorization();
  if (!isAdmin && !isDirector) return <Navigate to="/" replace />;

  const {
    allProfiles, updateProfile, refreshProfiles,
    teams, refreshTeams, addTeam, updateTeam, deleteTeam,
    goals, addGoal, updateGoal, deleteGoal,
    announcements, addAnnouncement, updateAnnouncement, deleteAnnouncement,
    directorates, addDirectorate, updateDirectorate, deleteDirectorate,
    clients, leads, appointments,
    developments,
    loading, user
  } = useApp();

  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [activeGoalTab, setActiveGoalTab] = useState<'active' | 'ended'>('active');
  const [activeGamifSection, setActiveGamifSection] = useState<'xp' | 'conquistas'>('xp');
  const [searchTerm, setSearchTerm] = useState('');

  // Team modal
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamForm, setTeamForm] = useState<Partial<Team>>({ name: '', directorate_id: '' });
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  // Goal modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isMission, setIsMission] = useState(false);
  const [goalForm, setGoalForm] = useState<Partial<Goal>>({ title: '', description: '', target: 0, start_date: '', deadline: '', type: 'Mensal', assignee_type: 'All', points: 0 });
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  // Announcement modal
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [announcementForm, setAnnouncementForm] = useState<Partial<Announcement>>({ title: '', content: '', priority: 'Normal', start_date: '', end_date: '' });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  // Manage members
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Directorate modal
  const [isDirModalOpen, setIsDirModalOpen] = useState(false);
  const [editingDir, setEditingDir] = useState<Directorate | null>(null);
  const [dirForm, setDirForm] = useState<Partial<Directorate>>({ name: '', description: '' });
  const [isSavingDir, setIsSavingDir] = useState(false);

  // Extra tools dropdown/modal
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(false);
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);

  // Reports
  const [reportDateRange, setReportDateRange] = useState(() => {
    const today = new Date();
    return {
      start: toDateOnlyLocal(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: toDateOnlyLocal(today),
    };
  });
  const [reportPeriod, setReportPeriod] = useState<'este_mes' | '30_dias' | '60_dias' | '90_dias' | 'custom'>('este_mes');
  const [drillCity, setDrillCity] = useState<string | null>(null); // drill-down de regiões: cidade → bairros
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [isGeneratingCSV, setIsGeneratingCSV] = useState(false);
  const [pdfExportType, setPdfExportType] = useState<'geral' | 'equipe' | 'coordenacao' | null>(null);

  // XP Report
  const [xpDateRange, setXpDateRange] = useState({
    start: toDateOnlyLocal(new Date(new Date().setDate(new Date().getDate() - 30))),
    end: toDateOnlyLocal(new Date())
  });
  const [xpReportData, setXpReportData] = useState<any[]>([]);
  const [xpReportLoading, setXpReportLoading] = useState(false);

  const navigate = useNavigate();

  // ── Client-side metrics (reliable, bypass broken RPC fields) ───────────────
  const { globalMetrics } = useReportsData({ startDate: reportDateRange.start, endDate: reportDateRange.end });

  // Same parser as Reports.tsx — handles "R$ 1.500.000,00" and "1500000,00"
  const parseCurrencyLocal = (v: string | undefined | null): number => {
    if (!v) return 0;
    return parseFloat(v.replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
  };

  const normalizeTeamRef = (value?: string | null) => String(value || '').trim().toLowerCase();

  const profileMatchesTeam = (profile: any, team: Team): boolean => {
    if (!profile || !team) return false;
    if (profile.team_id === team.id || profile.team === team.id) return true;
    const profileTeamName = normalizeTeamRef(profile.team);
    const teamName = normalizeTeamRef(team.name);
    return profileTeamName.length > 0 && profileTeamName === teamName;
  };

  const getTeamMemberIds = (team: Team): string[] => {
    const directMembers = allProfiles.filter((p: any) => profileMatchesTeam(p, team)).map((p: any) => p.id);
    const managerId = team.manager_id || null;
    const managerLinked = managerId
      ? allProfiles.filter((p: any) => p.manager_id === managerId).map((p: any) => p.id)
      : [];

    const coordinatorIds = managerId
      ? allProfiles
        .filter((p: any) => p.role?.toUpperCase() === 'COORDENADOR' && p.manager_id === managerId)
        .map((p: any) => p.id)
      : [];

    const coordinatorLinkedBrokers = coordinatorIds.length > 0
      ? allProfiles
        .filter((p: any) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id && coordinatorIds.includes(p.coordinator_id))
        .map((p: any) => p.id)
      : [];

    return Array.from(new Set([
      ...(team.members || []),
      ...directMembers,
      ...(managerId ? [managerId] : []),
      ...managerLinked,
      ...coordinatorIds,
      ...coordinatorLinkedBrokers,
    ]));
  };

  const formatBrokerDisplayName = (name?: string | null): string => {
    const normalized = String(name || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return 'Sem nome';

    const parts = normalized.split(' ');
    const first = parts[0] || '';
    if (!first || first === '.') return 'Sem nome';
    if (parts.length === 1) return first;

    const last = parts[parts.length - 1] || '';
    const initial = last.charAt(0).toUpperCase();
    if (!initial || initial === '.') return first;

    return `${first} ${initial}.`;
  };

  const reportRangeStart = parseDateOnlyLocal(reportDateRange.start);
  const reportRangeEnd = parseDateOnlyLocalEnd(reportDateRange.end);
  const getSaleReferenceDate = (client: any): Date | null => {
    const raw = client?.closed_at || null;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  // Seletor de período no padrão do Dashboard (pílulas) → ajusta reportDateRange
  const applyReportPeriod = (p: 'este_mes' | '30_dias' | '60_dias' | '90_dias' | 'custom') => {
    setReportPeriod(p);
    if (p === 'custom') return; // mantém o range atual e revela os inputs de data
    const today = new Date();
    const end = toDateOnlyLocal(today);
    let start: string;
    if (p === 'este_mes') {
      start = toDateOnlyLocal(new Date(today.getFullYear(), today.getMonth(), 1));
    } else {
      const days = p === '30_dias' ? 30 : p === '60_dias' ? 60 : 90;
      const d = new Date();
      d.setDate(today.getDate() - days);
      start = toDateOnlyLocal(d);
    }
    setReportDateRange({ start, end });
  };

  const selectedPeriodClients = clients.filter((c) => {
    const created = new Date(c.createdAt);
    return created >= reportRangeStart && created <= reportRangeEnd;
  });

  // ── Agregações para gráficos de Regiões de Interesse e Construtoras ──────────
  // Normaliza (sem acento/caixa) p/ agrupar variações de digitação ("CAMPO GRANDE" = "campo grande")
  const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const aggregateBy = (getter: (c: any) => string | undefined | null, list: any[] = selectedPeriodClients) => {
    const map = new Map<string, { label: string; value: number }>();
    list.forEach((c) => {
      const raw = (getter(c) || '').trim().replace(/\s+/g, ' ');
      if (!raw) return;
      const key = normText(raw);
      const existing = map.get(key);
      if (existing) existing.value += 1;
      else map.set(key, { label: raw, value: 1 });
    });
    const total = Array.from(map.values()).reduce((a, b) => a + b.value, 0);
    return Array.from(map.values(), ({ label, value }) => ({
      name: label,
      value,
      percentual: total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0,
    })).sort((a, b) => b.value - a.value);
  };
  const regionDataLocal = aggregateBy((c) => c.regionOfInterest).slice(0, 8);
  const builderDataLocal = aggregateBy((c) => c.builder).slice(0, 8);
  // Drill-down: bairros da cidade selecionada (clientes cuja cidade == drillCity)
  const drillBairroData = drillCity
    ? aggregateBy(
        (c) => c.neighborhood,
        selectedPeriodClients.filter((c) => normText(c.regionOfInterest || '') === normText(drillCity)),
      ).slice(0, 10)
    : [];
  // Paleta de gráficos on-palette (azul/verde primeiro, depois acentos)
  const CHART_COLORS = ['#2563eb', '#22c55e', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#14b8a6'];

  const selectedPeriodLeads = leads.filter((l) => {
    const created = new Date((l as any).created_at || l.timestamp);
    return created >= reportRangeStart && created <= reportRangeEnd;
  });

  const selectedPeriodSales = clients.filter((c) => {
    if (c.stage !== 'Concluído') return false;
    const saleDate = getSaleReferenceDate(c);
    return !!saleDate && saleDate >= reportRangeStart && saleDate <= reportRangeEnd;
  });
  const selectedPeriodSalesCount = selectedPeriodSales.length;
  const selectedPeriodConversion = selectedPeriodClients.length > 0
    ? Number(((selectedPeriodSalesCount / selectedPeriodClients.length) * 100).toFixed(1))
    : 0;
  const selectedPeriodApproved = selectedPeriodClients.filter((c) => c.stage === 'Aprovado').length;

  const pipelineDataLocal = CLIENT_STAGES
    .map((stage) => {
      const quantidade = selectedPeriodClients.filter((c) => c.stage === stage).length;
      const percentual = selectedPeriodClients.length > 0
        ? Number(((quantidade / selectedPeriodClients.length) * 100).toFixed(2))
        : 0;
      return { etapa: stage, quantidade, percentual };
    })
    .filter((row) => row.quantidade > 0);

  const trendDataLocal = (() => {
    const MS_DAY = 24 * 60 * 60 * 1000;
    const daysDiff = Math.max(0, Math.floor((reportRangeEnd.getTime() - reportRangeStart.getTime()) / MS_DAY));
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

    const buckets = new Map<string, { periodo: string; Lt: number; Vt: number; Rt: number }>();

    const cursor = new Date(reportRangeStart);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= reportRangeEnd) {
      const key = normalizePeriod(cursor);
      if (!buckets.has(key)) buckets.set(key, { periodo: key, Lt: 0, Vt: 0, Rt: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    selectedPeriodLeads.forEach((lead) => {
      const key = normalizePeriod(new Date((lead as any).created_at || lead.timestamp));
      const bucket = buckets.get(key);
      if (bucket) bucket.Lt += 1;
    });

    selectedPeriodSales.forEach((client) => {
      const saleDate = getSaleReferenceDate(client);
      if (!saleDate) return;
      const key = normalizePeriod(saleDate);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.Vt += 1;
        bucket.Rt += parseCurrencyLocal(client.intendedValue);
      }
    });

    return Array.from(buckets.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
  })();

  // VGV aligned with selected report period and sales card criteria
  const vgvLocal = selectedPeriodSales.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);

  const isEligibleForBrokerRanking = (role?: string | null) => {
    const normalizedRole = String(role || '').toUpperCase();
    return normalizedRole === 'CORRETOR' || normalizedRole === 'COORDENADOR' || normalizedRole === 'GERENTE';
  };

  // Broker ranking computed client-side (RPC Li=0 because leads table is empty per-broker)
  const localBrokerRanking = (() => {
    const brokers = allProfiles.filter((p) => isEligibleForBrokerRanking(p.role));

    return brokers
      .map((p) => {
        const createdByBroker = selectedPeriodClients.filter((c) => (c as any).owner_id === p.id);
        const salesByBroker = selectedPeriodSales.filter((c) => (c as any).owner_id === p.id);
        if (createdByBroker.length === 0 && salesByBroker.length === 0) return null;

        const vi = salesByBroker.length;
        const ri = salesByBroker.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
        return {
          corretor_id: p.id,
          nome: p.name,
          Li: createdByBroker.length,
          Vi: vi,
          Taxa_Conversao_i: createdByBroker.length > 0 ? Math.round((vi / createdByBroker.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.Vi - a.Vi || b.Ri - a.Ri);
  })();

  const compareRankingRows = (a: any, b: any) => {
    return (
      Number(b.Ri || 0) - Number(a.Ri || 0) ||
      Number(b.Vi || 0) - Number(a.Vi || 0) ||
      Number(b.Li || 0) - Number(a.Li || 0) ||
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR') ||
      String(a.entity_id || '').localeCompare(String(b.entity_id || ''))
    );
  };

  const selectedPeriodLabel = `${toPtBrDate(reportDateRange.start)} a ${toPtBrDate(reportDateRange.end)}`;

  const periodBrokerRanking = (() => {

    const brokers = allProfiles.filter((p) => isEligibleForBrokerRanking(p.role));

    return brokers
      .map((p) => {
        const createdByBroker = selectedPeriodClients.filter((c) => (c as any).owner_id === p.id);
        const salesByBroker = selectedPeriodSales.filter((c) => (c as any).owner_id === p.id);
        if (createdByBroker.length === 0 && salesByBroker.length === 0) return null;

        const vi = salesByBroker.length;
        const ri = salesByBroker.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
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
      .filter(Boolean)
      .sort(compareRankingRows)
      .slice(0, 3);
  })();

  const periodManagerRanking = (() => {
    const managers = allProfiles.filter((p) => p.role?.toUpperCase() === 'GERENTE');

    return managers
      .map((manager) => {
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

        const createdByManager = selectedPeriodClients.filter((c) => memberIds.includes((c as any).owner_id));
        const salesByManager = selectedPeriodSales.filter((c) => memberIds.includes((c as any).owner_id));
        if (createdByManager.length === 0 && salesByManager.length === 0) return null;

        const vi = salesByManager.length;
        const ri = salesByManager.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
        return {
          entity_id: manager.id,
          nome: manager.name,
          Li: createdByManager.length,
          Vi: vi,
          Taxa_Conversao_i: createdByManager.length > 0 ? Math.round((vi / createdByManager.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter(Boolean)
      .sort(compareRankingRows)
      .slice(0, 3);
  })();

  const periodCoordinatorRanking = (() => {
    const coordinators = allProfiles.filter((p) => p.role?.toUpperCase() === 'COORDENADOR');

    return coordinators
      .map((coord) => {
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => p.role?.toUpperCase() === 'CORRETOR' && p.coordinator_id === coord.id)
          .map((p) => p.id)));

        const createdByCoord = selectedPeriodClients.filter((c) => brokerIds.includes((c as any).owner_id));
        const salesByCoord = selectedPeriodSales.filter((c) => brokerIds.includes((c as any).owner_id));
        if (createdByCoord.length === 0 && salesByCoord.length === 0) return null;

        const vi = salesByCoord.length;
        const ri = salesByCoord.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
        return {
          entity_id: coord.id,
          nome: coord.name,
          Li: createdByCoord.length,
          Vi: vi,
          Taxa_Conversao_i: createdByCoord.length > 0 ? Math.round((vi / createdByCoord.length) * 100) : 0,
          Ri: ri,
        };
      })
      .filter(Boolean)
      .sort(compareRankingRows)
      .slice(0, 3);
  })();

  const reportByTeam = (() => {
    return teams
      .map((team) => {
        const teamMemberIds = Array.from(new Set([
          ...getTeamMemberIds(team),
          team.manager_id,
        ].filter(Boolean) as string[]));
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => profileMatchesTeam(p, team) && p.role?.toUpperCase() === 'CORRETOR')
          .map((p) => p.id)));

        const clientsByTeam = selectedPeriodClients.filter((c: any) => teamMemberIds.includes(String(c?.owner_id || '')));
        const salesByTeam = selectedPeriodSales.filter((c: any) => teamMemberIds.includes(String(c?.owner_id || '')));
        const clientes = clientsByTeam.length;
        const vendas = salesByTeam.length;
        const receita = salesByTeam.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
        const conversao = clientes > 0 ? Math.round((vendas / clientes) * 100) : 0;

        return {
          nome: team.name,
          corretores: brokerIds.length,
          clientes,
          vendas,
          conversao,
          receita,
        };
      })
      .filter((row) => row.clientes > 0 || row.vendas > 0 || row.receita > 0)
      .sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);
  })();

  const reportByCoordination = (() => {
    const brokerMap = new Map(localBrokerRanking.map((row: any) => [row.corretor_id, row]));

    return allProfiles
      .filter((p) => p.role?.toUpperCase() === 'COORDENADOR')
      .map((coord) => {
        const brokerIds = Array.from(new Set(allProfiles
          .filter((p: any) => p.coordinator_id === coord.id && p.role?.toUpperCase() === 'CORRETOR')
          .map((p) => p.id)));

        const rows = brokerIds.map((id) => brokerMap.get(id)).filter(Boolean) as any[];
        const clientes = rows.reduce((acc, row) => acc + Number(row.Li || 0), 0);
        const vendas = rows.reduce((acc, row) => acc + Number(row.Vi || 0), 0);
        const receita = rows.reduce((acc, row) => acc + Number(row.Ri || 0), 0);
        const conversao = clientes > 0 ? Math.round((vendas / clientes) * 100) : 0;

        return {
          nome: coord.name,
          corretores: brokerIds.length,
          clientes,
          vendas,
          conversao,
          receita,
        };
      })
      .filter((row) => row.corretores > 0 || row.clientes > 0 || row.vendas > 0)
      .sort((a, b) => b.vendas - a.vendas || b.receita - a.receita);
  })();

  const buildPdfReport = async ({
    filename,
    title,
    subtitle,
    metrics,
    columns,
    rows,
    insights,
    charts,
  }: {
    filename: string;
    title: string;
    subtitle: string;
    metrics: Array<{ label: string; value: string }>;
    columns: Array<{ header: string; width: number }>;
    rows: string[][];
    insights?: string[];
    charts?: Array<{ title: string; data: Array<{ label: string; value: number; sub?: string }> }>;
  }) => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const logo = await loadKaizenLogo(doc);

    const { W, H, MARGIN } = PAGE;
    const TABLE_W = W - (MARGIN * 2);
    const ROW_H = 18;
    const HEADER_H = 20;

    let page = doc.addPage([W, H]);
    let y = drawReportHeader(page, fonts, logo, { title, subtitle });

    const drawTableHeader = () => {
      page.drawRectangle({ x: MARGIN, y: y - HEADER_H, width: TABLE_W, height: HEADER_H, color: PDF_THEME.blue });
      let cx = MARGIN + 4;
      columns.forEach((col) => {
        page.drawText(col.header, { x: cx, y: y - HEADER_H + 6, size: 7, font: fonts.bold, color: PDF_THEME.white });
        cx += col.width;
      });
      y -= HEADER_H;
    };

    y = drawSectionTitle(page, fonts, y, 'Resumo');
    y = drawKeyValues(page, fonts, y, metrics);
    y -= 5;
    y = drawDivider(page, y);

    const ensure = (needed: number) => {
      if (y < MARGIN + needed) {
        page = doc.addPage([W, H]);
        y = drawContinuationHeader(page, fonts, title);
      }
    };

    // Insights (texto interpretando os números)
    if (insights && insights.length > 0) {
      ensure(30);
      y = drawSectionTitle(page, fonts, y, 'Insights');
      insights.forEach((line) => {
        ensure(16);
        const txt = safeText(line.length > 110 ? line.slice(0, 109) + '…' : line);
        page.drawText(`•  ${txt}`, { x: MARGIN, y, size: 8.5, font: fonts.regular, color: PDF_THEME.ink });
        y -= 13;
      });
      y -= 4;
      y = drawDivider(page, y);
    }

    // Gráficos (barras nativas, on-brand)
    if (charts && charts.length > 0) {
      charts.forEach((ch) => {
        if (ch.data.length === 0) return;
        ensure(24 + ch.data.length * 16);
        y = drawSectionTitle(page, fonts, y, ch.title);
        y = drawHBars(page, fonts, y, ch.data);
        y -= 6;
      });
      y = drawDivider(page, y);
    }

    ensure(60);
    y = drawSectionTitle(page, fonts, y, 'Detalhamento');
    drawTableHeader();

    rows.forEach((row, rowIndex) => {
      const rowLines = row.map((cell) => String(cell || '').split('\n').length);
      const lineCount = Math.max(1, ...rowLines);
      const rowHeight = Math.max(ROW_H, 10 + (lineCount * 8));

      if (y < MARGIN + rowHeight + 18) {
        page = doc.addPage([W, H]);
        y = drawContinuationHeader(page, fonts, title);
        drawTableHeader();
      }

      const isEven = rowIndex % 2 === 0;
      page.drawRectangle({
        x: MARGIN,
        y: y - rowHeight,
        width: TABLE_W,
        height: rowHeight,
        color: isEven ? PDF_THEME.white : PDF_THEME.rowAlt,
      });

      let cx = MARGIN + 4;
      row.forEach((cell, cellIndex) => {
        const colW = columns[cellIndex]?.width || 80;
        const text = String(cell || '');
        const maxChars = Math.max(8, Math.floor(colW / 4.2));
        const lines = text.split('\n');
        lines.forEach((line, lineIndex) => {
          const clipped = safeText(line.length > maxChars ? `${line.slice(0, maxChars - 1)}…` : line);
          page.drawText(clipped, {
            x: cx,
            y: y - 12 - (lineIndex * 8),
            size: 7,
            font: fonts.regular,
            color: PDF_THEME.ink,
          });
        });
        cx += colW;
      });
      y -= rowHeight;
    });

    addStandardFooters(doc, fonts);
    await downloadPdf(doc, filename);
  };

  const handleExportGeneralPdf = async () => {
    setPdfExportType('geral');
    try {
      const totalClientes = selectedPeriodClients.length;
      const totalVendas = selectedPeriodSalesCount;
      const receitaTotal = selectedPeriodSales.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
      const taxaConversaoReal = totalClientes > 0 ? Number(((totalVendas / totalClientes) * 100).toFixed(1)) : 0;
      const salesByUserMap = new Map<string, { clients: string[]; clientCount: number; salesCount: number; revenue: number }>();
      selectedPeriodSales.forEach((client: any) => {
        const ownerId = String(client?.owner_id || '');
        if (!ownerId) return;
        const row = salesByUserMap.get(ownerId) || { clients: [], clientCount: 0, salesCount: 0, revenue: 0 };
        row.salesCount += 1;
        row.revenue += parseCurrencyLocal(client.intendedValue);
        if (client?.name) row.clients.push(String(client.name));
        salesByUserMap.set(ownerId, row);
      });

      const clientsByUserMap = new Map<string, number>();
      selectedPeriodClients.forEach((client: any) => {
        const ownerId = String(client?.owner_id || '');
        if (!ownerId) return;
        clientsByUserMap.set(ownerId, (clientsByUserMap.get(ownerId) || 0) + 1);
      });

      const sellerRows = Array.from(salesByUserMap.entries())
        .map(([ownerId, row]) => {
          const profileRow = allProfiles.find((p) => p.id === ownerId);
          const role = String(profileRow?.role || '').toUpperCase();
          const userName = profileRow?.name || `Usuário ${ownerId.slice(0, 8)}`;
          const uniqueClients = Array.from(new Set(row.clients));
          const clientLines = uniqueClients.length > 0
            ? uniqueClients.map((clientName) => `Cliente: ${clientName}`)
            : ['Cliente: Cliente não identificado'];
          const clientsCount = clientsByUserMap.get(ownerId) || 0;
          const conversion = clientsCount > 0 ? Math.round((row.salesCount / clientsCount) * 100) : 0;
          return {
            userCell: `${userName} (${role || 'SEM CARGO'})\n${clientLines.join('\n')}`,
            clientsCount,
            salesCount: row.salesCount,
            conversion,
            revenue: row.revenue,
          };
        })
        .sort((a, b) => b.salesCount - a.salesCount || b.revenue - a.revenue);

      // ── Insights (interpretam os números) e gráficos nativos ──
      const fmtBRL0 = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
      const topStage = [...pipelineDataLocal].sort((a, b) => b.quantidade - a.quantidade)[0];
      const topRegion = regionDataLocal[0];
      const topBuilder = builderDataLocal[0];
      const ticketMedio = totalVendas > 0 ? receitaTotal / totalVendas : 0;
      const insights: string[] = [];
      insights.push(`Foram ${totalVendas} venda(s) concluída(s) no período, somando ${fmtBRL0(vgvLocal)} em VGV.`);
      insights.push(`Taxa de conversão de ${taxaConversaoReal}% (${totalVendas} vendas para ${totalClientes} clientes no período).`);
      if (totalVendas > 0) insights.push(`Ticket médio por venda: ${fmtBRL0(ticketMedio)}.`);
      if (globalMetrics.cicloMedioDias > 0) insights.push(`Ciclo médio de venda (do lead à conclusão): ${Math.round(globalMetrics.cicloMedioDias)} dias.`);
      if (topStage) insights.push(`Maior concentração no pipeline: "${topStage.etapa}" com ${topStage.quantidade} cliente(s) (${topStage.percentual}%) — atenção a possível gargalo.`);
      if (topRegion) insights.push(`Cidade de maior interesse: ${topRegion.name} (${topRegion.percentual}% dos clientes com cidade informada).`);
      if (topBuilder) insights.push(`Construtora mais procurada: ${topBuilder.name} (${topBuilder.value} cliente(s)).`);
      insights.push(`Leads recebidos no período: ${selectedPeriodLeads.length}.`);

      const generalCharts = [
        { title: 'Distribuição do pipeline', data: pipelineDataLocal.map((d) => ({ label: d.etapa, value: d.quantidade, sub: `${d.quantidade} (${d.percentual}%)` })) },
        { title: 'Cidades de interesse (top)', data: regionDataLocal.map((d) => ({ label: d.name, value: d.value, sub: `${d.value} (${d.percentual}%)` })) },
        { title: 'Construtoras (top)', data: builderDataLocal.map((d) => ({ label: d.name, value: d.value, sub: `${d.value} (${d.percentual}%)` })) },
      ].filter((c) => c.data.length > 0);

      await buildPdfReport({
        filename: `relatorio-geral-${reportDateRange.start}-${reportDateRange.end}.pdf`,
        title: 'Relatorio Geral de Performance',
        subtitle: `Periodo ${toPtBrDate(reportDateRange.start)} a ${toPtBrDate(reportDateRange.end)}`,
        insights,
        charts: generalCharts,
        metrics: [
          { label: 'Leads', value: String(selectedPeriodLeads.length) },
          { label: 'Clientes', value: String(totalClientes) },
          { label: 'Vendas concluidas', value: String(totalVendas) },
          { label: 'Taxa de conversao', value: `${taxaConversaoReal}%` },
          { label: 'Receita total', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(receitaTotal) },
          { label: 'VGV concluido', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(vgvLocal) },
        ],
        columns: [
          { header: 'Usuário / Cliente', width: 260 },
          { header: 'Clientes', width: 70 },
          { header: 'Vendas', width: 65 },
          { header: 'Conv.%', width: 60 },
          { header: 'Receita', width: 68 },
        ],
        rows: sellerRows.map((row: any) => [
          row.userCell,
          String(row.clientsCount || 0),
          String(row.salesCount || 0),
          `${row.conversion || 0}%`,
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(row.revenue || 0)),
        ]),
      });
    } catch (error) {
      console.error('Erro ao gerar PDF geral', error);
      alert('Nao foi possivel gerar o PDF geral.');
    } finally {
      setPdfExportType(null);
    }
  };

  const handleExportTeamPdf = async () => {
    if (!reportData) return;
    setPdfExportType('equipe');
    try {
      await buildPdfReport({
        filename: `relatorio-equipes-${reportDateRange.start}-${reportDateRange.end}.pdf`,
        title: 'Relatorio por Equipe',
        subtitle: `Periodo ${toPtBrDate(reportDateRange.start)} a ${toPtBrDate(reportDateRange.end)}`,
        metrics: [
          { label: 'Equipes com resultado', value: String(reportByTeam.length) },
          { label: 'Clientes no periodo', value: String(reportByTeam.reduce((acc, row) => acc + row.clientes, 0)) },
          { label: 'Vendas concluidas', value: String(reportByTeam.reduce((acc, row) => acc + row.vendas, 0)) },
          { label: 'Receita total', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reportByTeam.reduce((acc, row) => acc + row.receita, 0)) },
        ],
        columns: [
          { header: 'Equipe', width: 185 },
          { header: 'Corretores', width: 70 },
          { header: 'Clientes', width: 62 },
          { header: 'Vendas', width: 58 },
          { header: 'Conv.%', width: 55 },
          { header: 'Receita', width: 122 },
        ],
        rows: reportByTeam.map((row) => [
          row.nome,
          String(row.corretores),
          String(row.clientes),
          String(row.vendas),
          `${row.conversao}%`,
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(row.receita),
        ]),
      });
    } catch (error) {
      console.error('Erro ao gerar PDF por equipe', error);
      alert('Nao foi possivel gerar o PDF por equipe.');
    } finally {
      setPdfExportType(null);
    }
  };

  const handleExportCoordinationPdf = async () => {
    if (!reportData) return;
    setPdfExportType('coordenacao');
    try {
      await buildPdfReport({
        filename: `relatorio-coordenacao-${reportDateRange.start}-${reportDateRange.end}.pdf`,
        title: 'Relatorio por Coordenacao',
        subtitle: `Periodo ${toPtBrDate(reportDateRange.start)} a ${toPtBrDate(reportDateRange.end)}`,
        metrics: [
          { label: 'Coordenacoes com resultado', value: String(reportByCoordination.length) },
          { label: 'Corretores mapeados', value: String(reportByCoordination.reduce((acc, row) => acc + row.corretores, 0)) },
          { label: 'Vendas concluidas', value: String(reportByCoordination.reduce((acc, row) => acc + row.vendas, 0)) },
          { label: 'Receita total', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reportByCoordination.reduce((acc, row) => acc + row.receita, 0)) },
        ],
        columns: [
          { header: 'Coordenacao', width: 185 },
          { header: 'Corretores', width: 70 },
          { header: 'Clientes', width: 62 },
          { header: 'Vendas', width: 58 },
          { header: 'Conv.%', width: 55 },
          { header: 'Receita', width: 122 },
        ],
        rows: reportByCoordination.map((row) => [
          row.nome,
          String(row.corretores),
          String(row.clientes),
          String(row.vendas),
          `${row.conversao}%`,
          new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(row.receita),
        ]),
      });
    } catch (error) {
      console.error('Erro ao gerar PDF por coordenacao', error);
      alert('Nao foi possivel gerar o PDF por coordenacao.');
    } finally {
      setPdfExportType(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'reports' && reportDateRange.start && reportDateRange.end) {
      fetchReportData();
    }
  }, [activeTab, reportDateRange]);

  const fetchReportData = async () => {
    setReportLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_report_metrics', {
        data_inicial: reportDateRange.start,
        data_final: reportDateRange.end
      });
      if (error) throw error;
      setReportData(data);
    } catch (e) {
      console.error('Erro ao buscar relatórios:', e);
    } finally {
      setReportLoading(false);
    }
  };

  const handleExportCSV = () => {
    setIsGeneratingCSV(true);
    try {
      const receitaTotal = selectedPeriodSales.reduce((acc, c) => acc + parseCurrencyLocal(c.intendedValue), 0);
      const rows = [
        ['Métrica', 'Valor'],
        ['Total de Leads', String(selectedPeriodLeads.length)],
        ['Total de Clientes', String(selectedPeriodClients.length)],
        ['Vendas Concluídas', String(selectedPeriodSalesCount)],
        ['Receita Total', receitaTotal.toFixed(2)],
        ['Agendamentos', String(upcomingAppointmentsCount)],
        ['Taxa de Conversão', `${selectedPeriodConversion.toFixed(1)}%`],
        ['Ticket Médio', selectedPeriodSalesCount > 0 ? (receitaTotal / selectedPeriodSalesCount).toFixed(2) : '0'],
        ['Tempo Médio de Conversão (dias)', String(globalMetrics.cicloMedioDias)],
        [],
        ['Pipeline - Etapa', 'Quantidade', 'Percentual']
      ];

      pipelineDataLocal.forEach((p: any) => {
        rows.push([p.etapa, p.quantidade.toString(), `${p.percentual}%`]);
      });

      rows.push([]);
      rows.push(['Corretores - Nome', 'Clientes', 'Vendas', 'Receita', 'Taxa Conversão']);
      localBrokerRanking.forEach((c: any) => {
        rows.push([c.nome, c.Li.toString(), c.Vi.toString(), c.Ri.toString(), `${c.Taxa_Conversao_i}%`]);
      });

      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + rows.map(e => e.join(";")).join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `relatorio_${reportDateRange.start}_${reportDateRange.end}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      console.error('Erro ao gerar CSV', e);
    } finally {
      setIsGeneratingCSV(false);
    }
  };

  // Approval Modal
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [selectedPendingUserId, setSelectedPendingUserId] = useState<string | null>(null);
  const [approvalForm, setApprovalForm] = useState({ role: 'CORRETOR', directorate_id: '', team_id: '', coordinator_id: '' });
  const [isSavingApproval, setIsSavingApproval] = useState(false);

  useEffect(() => {
    if (activeTab === 'gamification' && xpDateRange.start && xpDateRange.end) {
      fetchXpReportData();
    }
  }, [activeTab, xpDateRange]);

  const fetchXpReportData = async () => {
    setXpReportLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_xp_report', {
        start_date: xpDateRange.start,
        end_date: xpDateRange.end
      });
      if (error) throw error;
      setXpReportData(data || []);
    } catch (e) {
      console.error('Erro ao buscar relatórios de XP:', e);
    } finally {
      setXpReportLoading(false);
    }
  };

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const pendingUsers = allProfiles.filter(p => p.status === 'pending' || p.status === 'Pendente');
  const activeUsers = allProfiles.filter(p => (p.status === 'active' || p.status === 'Ativo') && p.name?.toLowerCase().includes(searchTerm.toLowerCase()));
  const inactiveUsers = allProfiles.filter(p => (p.status === 'inactive' || p.status === 'Inativo') && p.name?.toLowerCase().includes(searchTerm.toLowerCase()));
  const isProfileActive = (status?: string | null) => {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'active' || normalized === 'ativo';
  };

  // ── Users Actions ──────────────────────────────────────────────────────────
  const handleRoleChange = async (id: string, role: string) => {
    try {
      await updateProfile(id, { role });
    } catch (e: any) {
      console.error('Erro ao atualizar perfil (role):', e);
      alert(`Não foi possível atualizar o cargo. ${e?.message || ''}`.trim());
    }
  };
  const handleDirectorateChange = async (id: string, directorate_id: string | null) => {
    try {
      const targetDirectorateId = directorate_id || null;
      const profileToChange = allProfiles.find(p => p.id === id);
      const currentTeamId = profileToChange?.team_id || profileToChange?.team || null;
      const teamStillBelongsToDirectorate = currentTeamId
        ? teams.some(t => t.id === currentTeamId && t.directorate_id === targetDirectorateId)
        : true;

      if (!teamStillBelongsToDirectorate) {
        await updateProfile(id, {
          directorate_id: targetDirectorateId,
          team: null,
          team_id: null,
          manager_id: null,
          coordinator_id: null,
        } as any);
        return;
      }

      await updateProfile(id, { directorate_id: targetDirectorateId });
    } catch (e: any) {
      console.error('Erro ao atualizar perfil (diretoria):', e);
      alert(`Não foi possível atualizar a diretoria. ${e?.message || ''}`.trim());
    }
  };
  const handleManagerChange = async (id: string, manager_id: string | null) => {
    try {
      await updateProfile(id, { manager_id: manager_id || null });
    } catch (e: any) {
      console.error('Erro ao atualizar perfil (gestor):', e);
      alert(`Não foi possível atualizar o gestor. ${e?.message || ''}`.trim());
    }
  };
  const handleTeamChange = async (id: string, team_id: string | null) => {
    try {
      const targetTeamId = team_id || null;
      const selectedTeam = targetTeamId ? teams.find(t => t.id === targetTeamId) : null;

      await updateProfile(id, {
        team: targetTeamId,
        team_id: targetTeamId,
        directorate_id: targetTeamId ? (selectedTeam?.directorate_id || null) : null,
        manager_id: targetTeamId ? (selectedTeam?.manager_id || null) : null,
      } as any);
    } catch (e: any) {
      console.error('Erro ao atualizar perfil (equipe):', e);
      alert(`Não foi possível transferir a equipe. ${e?.message || ''}`.trim());
    }
  };
  const handleCoordinatorChange = async (id: string, coordinator_id: string | null) => {
    try {
      await updateProfile(id, { coordinator_id: coordinator_id || null } as any);
    } catch (e: any) {
      console.error('Erro ao atualizar perfil (coordenador):', e);
      alert(`Não foi possível atualizar o coordenador. ${e?.message || ''}`.trim());
    }
  };


  const handleDeactivateUser = async (userId: string, userName: string) => {
    const confirmMessage = `⚠️ Confirmar desativação\n\nVocê está prestes a remover o acesso do usuário:\n\n"${userName}"\n\nEsta ação:\n- bloqueia o acesso do usuário\n- mantém o histórico e as vendas já registradas\n\nDigite "CONFIRMAR" para prosseguir:`;

    const userInput = prompt(confirmMessage);

    if (userInput !== 'CONFIRMAR') {
      alert('Desativação cancelada.');
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'Inativo' })
        .eq('id', userId);

      if (error) throw error;

      alert(`✅ Usuário "${userName}" foi desativado com sucesso. O histórico foi preservado.`);
      await refreshProfiles();
    } catch (error: any) {
      console.error('Erro ao desativar usuário:', error);
      alert(`❌ Erro ao desativar usuário: ${error.message}`);
    }
  };

  const handleReactivateUser = async (userId: string, userName: string) => {
    if (!confirm(`Reativar o usuário "${userName}"?`)) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'Ativo' })
        .eq('id', userId);

      if (error) throw error;

      alert(`✅ Usuário "${userName}" foi reativado com sucesso.`);
      await refreshProfiles();
    } catch (error: any) {
      console.error('Erro ao reativar usuário:', error);
      alert(`❌ Erro ao reativar usuário: ${error.message}`);
    }
  };
  // ── Approval Flow ──────────────────────────────────────────────────────────
  const handleOpenApprovalModal = (userId: string) => {
    setSelectedPendingUserId(userId);
    setApprovalForm({ role: 'CORRETOR', directorate_id: '', team_id: '', coordinator_id: '' });
    setIsApprovalModalOpen(true);
  };

  const handleConfirmApproval = async () => {
    if (!selectedPendingUserId) return;
    setIsSavingApproval(true);
    try {
      const selectedTeam = teams.find(t => t.id === approvalForm.team_id);

      const updateData: any = {
        role: approvalForm.role,
        status: 'Ativo',
        directorate_id: approvalForm.directorate_id || null,
        team: approvalForm.team_id || null,
        team_id: approvalForm.team_id || null,
        manager_id: null,
        coordinator_id: approvalForm.coordinator_id || null,
      };

      // Se escolheu uma equipe, a diretoria e o gestor herdaram dessa equipe
      if (selectedTeam) {
        updateData.directorate_id = selectedTeam.directorate_id || null;
        updateData.manager_id = selectedTeam.manager_id || null;

        // Adiciona o usuário na array `members` da equipe selecionada
        const currentMembers = selectedTeam.members || [];
        if (!currentMembers.includes(selectedPendingUserId)) {
          await updateTeam(selectedTeam.id, { members: [...currentMembers, selectedPendingUserId] });
        }
      }

      await updateProfile(selectedPendingUserId, updateData);
      setIsApprovalModalOpen(false);
      setSelectedPendingUserId(null);
    } catch (e) {
      console.error('Erro ao aprovar usuário:', e);
    } finally {
      setIsSavingApproval(false);
    }
  };

  const handleRejectUser = async (id: string) => {
    if (confirm('Rejeitar este usuário?')) {
      await updateProfile(id, { status: 'rejected' });
    }
  };

  // ── Team Actions ───────────────────────────────────────────────────────────
  const openTeamModal = (team?: Team) => {
    if (team) { setEditingTeam(team); setTeamForm({ ...team }); }
    else { setEditingTeam(null); setTeamForm({ name: '', directorate_id: '', manager_id: '' }); }
    setIsTeamModalOpen(true);
  };
  const handleSaveTeam = async () => {
    if (!teamForm.name) {
      alert("O nome da equipe é obrigatório.");
      return;
    }
    setIsSavingTeam(true);

    try {
      if (editingTeam) {
        await updateTeam(editingTeam.id, teamForm);
      } else {
        await addTeam({ ...teamForm, members: [] } as Omit<Team, 'id'>);
      }
      setIsTeamModalOpen(false);
    } catch (e: any) {
      alert("Erro ao salvar equipe: " + (e.message || "Tente novamente."));
    } finally {
      setIsSavingTeam(false);
    }
  };

  const handleToggleMember = async (teamId: string, userId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const members = getTeamMemberIds(team);
    const isAdding = !members.includes(userId);

    try {
      // Persiste o vínculo canônico no profile (RPC + trigger sincronizam members[]).
      await updateProfile(userId, {
        team: isAdding ? teamId : null,
        team_id: isAdding ? teamId : null,
        directorate_id: isAdding ? (team.directorate_id || null) : undefined,
        manager_id: isAdding ? (team.manager_id || null) : undefined,
      });
      await refreshTeams();
      await refreshProfiles();
    } catch (e: any) {
      console.error('Falha ao transferir membro de equipe:', e);
      alert(`Não foi possível concluir a transferência de equipe. ${e?.message || ''}`.trim());
    }
  };

  // ── Goal Actions ───────────────────────────────────────────────────────────
  const openGoalModal = (goal?: Goal, missionMode = false) => {
    setIsMission(missionMode);
    if (goal) { setEditingGoal(goal); setGoalForm({ ...goal }); }
    else { setEditingGoal(null); setGoalForm({ title: '', description: '', target: 0, start_date: '', deadline: '', type: missionMode ? 'Missão' : 'Mensal', assignee_type: 'All', points: missionMode ? 100 : 0, measure_type: 'currency', objective_type: 'sales' }); }
    setIsGoalModalOpen(true);
  };
  const handleSaveGoal = async () => {
    if (!goalForm.title) return;
    setIsSavingGoal(true);
    try {
      if (editingGoal) await updateGoal(editingGoal.id, goalForm);
      else await addGoal({ ...goalForm, current_progress: 0 } as Omit<Goal, 'id'>);
      setIsGoalModalOpen(false);
    } catch (e: any) {
      alert('Erro ao salvar meta/missao: ' + (e?.message || 'Tente novamente.'));
    } finally { setIsSavingGoal(false); }
  };

  // ── Announcement Actions ───────────────────────────────────────────────────
  const openAnnouncementModal = (ann?: Announcement) => {
    if (ann) { setEditingAnnouncement(ann); setAnnouncementForm({ ...ann }); }
    else { setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', priority: 'Normal', start_date: '', end_date: '' }); }
    setIsAnnouncementModalOpen(true);
  };
  const handleSaveAnnouncement = async () => {
    if (!announcementForm.title) return;
    setIsSavingAnnouncement(true);
    try {
      if (editingAnnouncement) await updateAnnouncement(editingAnnouncement.id, announcementForm);
      else await addAnnouncement({ ...announcementForm, author_id: user?.id } as Omit<Announcement, 'id' | 'created_at'>);
      setIsAnnouncementModalOpen(false);
    } catch (e: any) {
      alert('Erro ao salvar anuncio: ' + (e?.message || 'Tente novamente.'));
    } finally { setIsSavingAnnouncement(false); }
  };

  // ── Reports data ───────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingAppointmentsCount = appointments.filter(a => a.date >= todayStr).length;

  const stageData = ['Em Análise', 'Aprovados', 'Condicionados', 'Reprovados', 'Em Tratativa', 'Contrato', 'Vendas Concluidas'].map(stage => ({
    name: stage.length > 10 ? stage.substring(0, 10) + '…' : stage,
    total: clients.filter(c => c.stage === stage).length
  }));

  const renderTabContent = () => {
    switch (activeTab) {
      case 'users':
        return (
          <div className="space-y-6">
            <section>
              <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-3 gap-2">
                <h3 className="text-sm font-bold text-text-secondary uppercase">Usuários Ativos ({activeUsers.length})</h3>
                <div className="relative w-full md:w-56">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
                  <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-xs bg-card-bg dark:bg-surface-100 border border-surface-200 rounded-lg focus:outline-none focus:border-gold-400" />
                </div>
              </div>
              <div className="grid gap-3">
                {loading ? <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-4" /> :
                  activeUsers.map(u => (
                    <PremiumCard key={u.id} className="w-full p-4 overflow-hidden">
                      {/* Linha superior: avatar + nome + botão excluir */}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-surface-200 flex items-center justify-center text-text-primary font-bold text-sm flex-shrink-0 overflow-hidden">
                          {(u as any).avatar_url ? (
                            <img src={(u as any).avatar_url} alt={u.name} className="w-full h-full object-cover" />
                          ) : (
                            (u.name || '?').charAt(0)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-text-primary truncate">{u.name}</p>
                          <p className="text-xs text-text-secondary">{u.role}</p>
                        </div>
                        {/* Botão desativar visível no mobile ao lado do nome */}
                        <button
                          onClick={() => handleDeactivateUser(u.id, u.name || 'Usuário')}
                          className="md:hidden p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors flex-shrink-0"
                          title="Desativar usuário"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {/* Dropdowns + botão desativar desktop */}
                      <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-col gap-1.5 md:flex-row md:gap-2 md:items-center">
                          <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                            className="w-full md:w-40 text-xs bg-surface-50 border border-surface-200 rounded-lg p-1.5 focus:outline-none focus:border-gold-400">
                            {['CORRETOR', 'COORDENADOR', 'GERENTE', 'DIRETOR', 'ADMIN', 'RECEPCAO', 'ANALISTA'].map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <select value={(u as any).directorate_id ?? ''} onChange={e => handleDirectorateChange(u.id, e.target.value || null)}
                            className="w-full md:w-40 text-xs bg-surface-50 border border-surface-200 rounded-lg p-1.5 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Diretoria</option>
                            {directorates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <select
                            value={(u as any).team_id || (u as any).team || ''}
                            onChange={e => handleTeamChange(u.id, e.target.value || null)}
                            className="w-full md:w-40 text-xs bg-surface-50 border border-surface-200 rounded-lg p-1.5 focus:outline-none focus:border-gold-400"
                          >
                            <option value="">Sem Equipe</option>
                            {teams
                              .filter(t => !(u as any).directorate_id || t.directorate_id === (u as any).directorate_id || t.id === ((u as any).team_id || (u as any).team))
                              .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          <select value={(u as any).manager_id ?? ''} onChange={e => handleManagerChange(u.id, e.target.value || null)}
                            className="w-full md:w-40 text-xs bg-surface-50 border border-surface-200 rounded-lg p-1.5 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Gestor</option>
                            {allProfiles
                              .filter(p => p.id !== u.id && p.role?.toUpperCase() === 'GERENTE' && isProfileActive((p as any).status))
                              .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <select value={(u as any).coordinator_id ?? ''} onChange={e => handleCoordinatorChange(u.id, e.target.value || null)}
                            className="w-full md:w-40 text-xs bg-surface-50 border border-surface-200 rounded-lg p-1.5 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Coordenador</option>
                            {allProfiles
                              .filter(p => p.id !== u.id && p.role?.toUpperCase() === 'COORDENADOR' && isProfileActive((p as any).status))
                              .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        {/* Botão desativar visível só no desktop */}
                        <button
                          onClick={() => handleDeactivateUser(u.id, u.name || 'Usuário')}
                          className="hidden md:flex p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors flex-shrink-0"
                          title="Desativar usuário"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </PremiumCard>
                  ))}
              </div>
            </section>

            <section>
              <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-3 gap-2">
                <h3 className="text-sm font-bold text-text-secondary uppercase">Usuários Inativos ({inactiveUsers.length})</h3>
              </div>
              <div className="grid gap-3">
                {inactiveUsers.length === 0 ? (
                  <p className="text-xs text-text-secondary">Nenhum usuário inativo encontrado.</p>
                ) : (
                  inactiveUsers.map(u => (
                    <PremiumCard key={u.id} className="w-full p-4 overflow-hidden opacity-80">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-surface-200 flex items-center justify-center text-text-primary font-bold text-sm flex-shrink-0 overflow-hidden">
                          {(u as any).avatar_url ? (
                            <img src={(u as any).avatar_url} alt={u.name} className="w-full h-full object-cover" />
                          ) : (
                            (u.name || '?').charAt(0)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-text-primary truncate">{u.name}</p>
                          <p className="text-xs text-text-secondary">{u.role}</p>
                        </div>
                        <RoundedButton
                          size="sm"
                          onClick={() => handleReactivateUser(u.id, u.name || 'Usuário')}
                          className="bg-green-500 hover:bg-green-600 text-white border-0"
                        >
                          Reativar
                        </RoundedButton>
                      </div>
                    </PremiumCard>
                  ))
                )}
              </div>
            </section>
          </div>
        );

      case 'teams':
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <RoundedButton size="sm" onClick={() => openTeamModal()}><Plus size={16} className="mr-1" /> Nova Equipe</RoundedButton>
            </div>
            {loading ? <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-4" /> :
              teams.length === 0 ? <p className="text-center text-text-secondary py-8">Nenhuma equipe cadastrada.</p> :
                teams.map(team => {
                  const dirName = directorates.find(d => d.id === team.directorate_id)?.name;
                  const mgrName = allProfiles.find(p => p.id === team.manager_id)?.name;
                  return (
                    <PremiumCard
                      key={team.id}
                      className="p-4 cursor-pointer transition-colors hover:border-primary-500/40"
                      onClick={() => navigate(`/reports?scope=equipe&id=${team.id}&name=${encodeURIComponent(team.name)}&start=${reportDateRange.start}&end=${reportDateRange.end}`)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-bold text-text-primary">{team.name}</h4>
                          <div className="flex flex-col gap-0.5 mt-1">
                            {dirName && <p className="text-xs text-text-secondary">🏢 {dirName}</p>}
                            {mgrName && <p className="text-xs text-text-secondary">👤 Gestor: {mgrName}</p>}
                          </div>
                        </div>
                        <div className="flex gap-2 items-start" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openTeamModal(team)} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={14} /></button>
                          <button onClick={() => { setSelectedTeamId(team.id); setIsMembersModalOpen(true); }} className="p-1.5 bg-surface-50 rounded-full hover:text-blue-600"><Users size={14} /></button>
                          <button onClick={() => { if (confirm('Excluir equipe?')) deleteTeam(team.id); }} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <p className="text-xs text-text-secondary">{getTeamMemberIds(team).length} membros</p>
                    </PremiumCard>
                  );
                })}
          </div>
        );

      case 'goals': {
        const activeGoals = goals.filter(g => g.status !== 'achieved' && g.status !== 'failed');
        const endedGoals = goals.filter(g => g.status === 'achieved' || g.status === 'failed');
        const displayedGoals = activeGoalTab === 'active' ? activeGoals : endedGoals;

        return (
          <div className="space-y-3">
            {/* ── Filter Bar ────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              {/* Segmented control */}
              <div className="flex bg-surface-100 dark:bg-surface-200 rounded-2xl p-1 gap-1">
                <button
                  onClick={() => setActiveGoalTab('active')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${activeGoalTab === 'active' ? 'bg-card-bg dark:bg-surface-50 text-gold-600 shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${activeGoalTab === 'active' ? 'bg-gold-400' : 'bg-surface-300'}`} />
                  Em Andamento
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeGoalTab === 'active' ? 'bg-gold-100 text-gold-600' : 'bg-surface-200 text-text-secondary'}`}>{activeGoals.length}</span>
                </button>
                <button
                  onClick={() => setActiveGoalTab('ended')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${activeGoalTab === 'ended' ? 'bg-card-bg dark:bg-surface-50 text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  <span className={`w-2 h-2 rounded-full ${activeGoalTab === 'ended' ? 'bg-surface-400' : 'bg-surface-300'}`} />
                  Encerradas
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold bg-surface-200 text-text-secondary`}>{endedGoals.length}</span>
                </button>
              </div>
              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => openGoalModal(undefined, true)}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border-2 border-gold-200 dark:border-gold-800 text-gold-600 dark:text-gold-400 bg-gold-50 dark:bg-gold-900/10 hover:bg-gold-100 dark:hover:bg-gold-900/20 font-semibold text-sm transition-all duration-200 active:scale-95"
                >
                  <Trophy size={16} /> Nova Missão
                </button>
                <button
                  onClick={() => openGoalModal()}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gold-500 hover:bg-gold-600 text-white font-semibold text-sm transition-all duration-200 shadow-sm active:scale-95"
                >
                  <Plus size={16} /> Nova Meta
                </button>
              </div>
            </div>

            {/* ── Goals List ────────────────────────────────────────── */}
            {loading ? <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-4" /> :
              displayedGoals.length === 0
                ? <p className="text-center text-text-secondary py-8">{activeGoalTab === 'active' ? 'Nenhuma meta em andamento.' : 'Nenhuma meta encerrada ainda.'}</p>
                : displayedGoals.map(goal => {
                  const progress = goal.target ? ((goal.current_progress || 0) / goal.target) * 100 : 0;
                  const formatGoalVal = (val: number) =>
                    goal.measure_type === 'quantity'
                      ? val.toString()
                      : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

                  let progressColor = 'bg-blue-500';
                  let tierText = '';
                  let remainingToNextTier = 0;

                  if (progress >= 100) {
                    progressColor = 'bg-green-500';
                    tierText = '🎉 Meta Batida!';
                  } else if (progress >= 67) {
                    progressColor = 'bg-green-500';
                    tierText = 'Prata';
                    remainingToNextTier = (goal.target || 0) - (goal.current_progress || 0);
                  } else if (progress >= 34) {
                    progressColor = 'bg-orange-400';
                    tierText = 'Bronze';
                    remainingToNextTier = ((goal.target || 0) * 0.67) - (goal.current_progress || 0);
                  } else {
                    progressColor = 'bg-blue-500';
                    tierText = 'Em Andamento';
                    remainingToNextTier = ((goal.target || 0) * 0.34) - (goal.current_progress || 0);
                  }

                  return (
                    <PremiumCard key={goal.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {goal.type === 'Missão' && <Trophy size={14} className="text-gold-500 flex-shrink-0" />}
                            <h4 className="font-bold text-text-primary truncate">{goal.title}</h4>
                            {goal.status === 'achieved' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Atingida</span>}
                            {goal.status === 'failed' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Falhou</span>}
                          </div>
                          {goal.description && <p className="text-xs text-text-secondary mt-1">{goal.description}</p>}
                          {goal.property_id && (
                            <p className="text-xs text-gold-600 mt-1 flex items-center gap-1">
                              <Building2 size={12} /> {developments?.find(d => d.id === goal.property_id)?.name || 'Empreendimento'}
                            </p>
                          )}
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-text-secondary mb-1">
                              <span>Progresso: {tierText}</span>
                              <span>{formatGoalVal(goal.current_progress || 0)} / {formatGoalVal(goal.target || 0)}</span>
                            </div>
                            <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                              <div className={`h-full ${progressColor} rounded-full transition-all`} style={{ width: `${Math.min(progress, 100)}%` }} />
                            </div>

                          </div>
                        </div>
                        <div className="flex gap-2 ml-3 flex-shrink-0">
                          <button onClick={() => openGoalModal(goal, goal.type === 'Missão')} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={14} /></button>
                          <button onClick={() => { if (confirm('Excluir meta?')) deleteGoal(goal.id); }} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </PremiumCard>
                  );
                })
            }
          </div>
        );
      }

      case 'announcements':
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <RoundedButton size="sm" onClick={() => openAnnouncementModal()}><Plus size={16} className="mr-1" /> Novo Anúncio</RoundedButton>
            </div>
            {loading ? <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-4" /> :
              announcements.length === 0 ? <p className="text-center text-text-secondary py-8">Nenhum anúncio cadastrado.</p> :
                announcements.map(ann => {
                  const priorityColors: Record<string, string> = { Urgente: 'text-red-600 bg-red-50', Importante: 'text-amber-600 bg-amber-50', Normal: 'text-blue-600 bg-blue-50' };
                  return (
                    <PremiumCard key={ann.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityColors[ann.priority || 'Normal']}`}>{ann.priority}</span>
                            <h4 className="font-bold text-text-primary truncate">{ann.title}</h4>
                          </div>
                          <p className="text-sm text-text-secondary line-clamp-2">{ann.content}</p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => openAnnouncementModal(ann)} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={14} /></button>
                          <button onClick={() => { if (confirm('Excluir anúncio?')) deleteAnnouncement(ann.id); }} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </PremiumCard>
                  );
                })}
          </div>
        );

      case 'reports':
        return (
          <div className="space-y-6 print:space-y-4">
            {/* ── Modal: Pipeline por Corretor ── */}
            <Modal isOpen={isPipelineModalOpen} onClose={() => setIsPipelineModalOpen(false)} title="Pipeline por Corretor (PDF)">
              <PipelinePdfExport corretores={allProfiles} />
            </Modal>

            {/* ── Extra Tools: "..." button ── */}
            <div className="print:hidden flex justify-end relative">
              <button
                onClick={() => setIsToolsMenuOpen(v => !v)}
                className="flex items-center justify-center w-9 h-9 rounded-lg border border-surface-200 bg-card-bg dark:bg-surface-100 text-text-secondary hover:text-text-primary hover:border-gold-300 shadow-sm transition-all"
              >
                <MoreHorizontal size={18} />
              </button>

              {isToolsMenuOpen && (
                <>
                  {/* backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setIsToolsMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-20 w-72 bg-card-bg dark:bg-surface-100 border border-surface-200 rounded-xl shadow-xl overflow-hidden">
                    <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Exportar relatórios</div>
                    <div className="px-3 pb-3 space-y-1.5">
                      <button
                        onClick={() => { setIsToolsMenuOpen(false); handleExportGeneralPdf(); }}
                        disabled={reportLoading || !reportData || pdfExportType !== null}
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
                        title="Gerar PDF geral"
                      >
                        {pdfExportType === 'geral' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} PDF Geral
                      </button>
                      <button
                        onClick={() => { setIsToolsMenuOpen(false); handleExportTeamPdf(); }}
                        disabled={reportLoading || !reportData || pdfExportType !== null}
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
                        title="Gerar PDF por equipe"
                      >
                        {pdfExportType === 'equipe' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} PDF Equipe
                      </button>
                      <button
                        onClick={() => { setIsToolsMenuOpen(false); handleExportCoordinationPdf(); }}
                        disabled={reportLoading || !reportData || pdfExportType !== null}
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-gold-50 transition-colors disabled:opacity-50"
                        title="Gerar PDF por coordenacao"
                      >
                        {pdfExportType === 'coordenacao' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF Coordenacao
                      </button>
                    </div>

                    <div className="border-t border-surface-100" />
                    <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Ferramentas</div>
                    <button
                      onClick={() => { setIsToolsMenuOpen(false); setIsPipelineModalOpen(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-200 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                        <FileDown size={15} className="text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">Pipeline por Corretor</p>
                        <p className="text-[11px] text-text-secondary">Exportar PDF dos leads ativos</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setIsToolsMenuOpen(false); navigate('/admin/reports/presence'); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-200 transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center shrink-0">
                        <BarChart3 size={15} className="text-gold-600 dark:text-gold-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">Presença e Engajamento</p>
                        <p className="text-[11px] text-text-secondary">Check-ins, score e alertas</p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col gap-3 print:hidden">
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'este_mes', label: 'Este mês' },
                  { id: '30_dias', label: '30 dias' },
                  { id: '60_dias', label: '60 dias' },
                  { id: '90_dias', label: '90 dias' },
                  { id: 'custom', label: 'Personalizado' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => applyReportPeriod(opt.id)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                      reportPeriod === opt.id
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-card-bg text-text-secondary border-surface-200 hover:border-primary-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {reportPeriod === 'custom' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-text-secondary uppercase mb-1">Início</span>
                    <input
                      type="date"
                      value={reportDateRange.start}
                      onChange={(e) => setReportDateRange(prev => ({ ...prev, start: e.target.value }))}
                      className="w-full px-2 py-2 border border-surface-200 rounded-lg text-sm bg-surface-50 text-text-primary focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none transition-all"
                      max={reportDateRange.end}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-text-secondary uppercase mb-1">Fim</span>
                    <input
                      type="date"
                      value={reportDateRange.end}
                      onChange={(e) => setReportDateRange(prev => ({ ...prev, end: e.target.value }))}
                      className="w-full px-2 py-2 border border-surface-200 rounded-lg text-sm bg-surface-50 text-text-primary focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none transition-all"
                      min={reportDateRange.start}
                    />
                  </div>
                </div>
              )}
            </div>

            {reportLoading || !reportData ? (
              <div className="flex flex-col items-center justify-center py-20 bg-card-bg rounded-2xl border border-surface-200 shadow-sm">
                <Loader2 size={40} className="animate-spin text-gold-500 mb-4" />
                <p className="text-sm font-semibold text-text-primary">Processando indicadores no banco de dados...</p>
                <p className="text-xs text-text-secondary mt-1">Isso pode levar alguns segundos dependendo do volume do período.</p>
              </div>
            ) : (
              <>
                {/* TOP NAVIGATION METRICS */}
                <div className="hidden print:block text-center mt-4">
                  <h2 className="text-xl font-bold">Relatório de Desempenho</h2>
                  <p className="text-sm text-text-secondary">{toPtBrDate(reportDateRange.start)} a {toPtBrDate(reportDateRange.end)}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 print:grid-cols-4 print:gap-4 print:mt-4">
                  {[
                    { label: 'Leads', value: selectedPeriodLeads.length, cmp: null, icon: <Users size={14} />, color: 'text-text-primary', bg: 'bg-surface-100 text-text-secondary', route: '/clients', state: { tab: 'documentacao' } },
                    { label: 'Clientes', value: selectedPeriodClients.length, cmp: null, icon: <Users size={14} />, color: 'text-primary-400', bg: 'bg-primary-500/15 text-primary-400', route: '/clients', state: undefined },
                    { label: 'Aprovados', value: selectedPeriodApproved, cmp: null, icon: <Shield size={14} />, color: 'text-green-400', bg: 'bg-green-500/15 text-green-400', route: '/clients', state: { initialStage: 'Aprovado' } },
                    { label: 'Agenda', value: upcomingAppointmentsCount, cmp: null, icon: <Calendar size={14} />, color: 'text-blue-400', bg: 'bg-blue-500/15 text-blue-400', route: '/schedule', state: undefined },
                  ].map((stat, i) => (
                    <PremiumCard key={i} className={`p-3 relative flex flex-col justify-between h-24 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-surface-100 ${stat.route ? 'cursor-pointer hover:border-primary-400/50 hover:shadow-md transition-all' : ''}`} onClick={() => stat.route && navigate(stat.route, { state: stat.state })}>
                      <div className="flex justify-between items-start">
                        <span className={`p-1.5 rounded-md ${stat.bg}`}>{stat.icon}</span>
                        {stat.cmp !== null && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${stat.cmp > 0 ? 'bg-green-50 text-green-700' : stat.cmp < 0 ? 'bg-red-50 text-red-700' : 'bg-surface-50 text-text-secondary'}`}>
                            {stat.cmp > 0 ? '+' : ''}{stat.cmp}%
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <p className={`text-2xl font-bold ${stat.color} leading-none`}>{stat.value}</p>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary mt-1">{stat.label}</p>
                      </div>
                    </PremiumCard>
                  ))}
                </div>

                {/* STRATEGIC DASHBOARD */}
                <div className="grid grid-cols-2 gap-3 print:grid-cols-4 print:gap-4">
                  <PremiumCard className="p-3 bg-gradient-to-br from-primary-500/10 to-card-bg border-primary-500/20 shadow-[0_2px_10px_rgba(0,0,0,0.03)] h-28 flex flex-col justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-primary-400 flex items-center gap-1"><Trophy size={12} /> Vendas</p>
                    <div>
                      <p className="text-2xl font-bold text-text-primary leading-none">{selectedPeriodSalesCount}</p>
                      <p className="text-[9px] font-semibold text-text-secondary mt-1.5">no período selecionado</p>
                    </div>
                  </PremiumCard>

                  <PremiumCard className="p-3 bg-gradient-to-br from-green-500/10 to-card-bg border-green-500/20 shadow-[0_2px_10px_rgba(0,0,0,0.03)] h-28 flex flex-col justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-green-400 flex items-center gap-1"><TrendingUp size={12} /> VGV</p>
                    <div>
                      <p className="text-xl font-bold text-text-primary leading-none whitespace-nowrap">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(vgvLocal)}
                      </p>
                      <p className="text-[9px] font-semibold text-text-secondary mt-1.5">vendas concluídas</p>
                    </div>
                  </PremiumCard>

                  <PremiumCard className="p-3 bg-gradient-to-br from-blue-500/10 to-card-bg border-blue-500/20 shadow-[0_2px_10px_rgba(0,0,0,0.03)] h-28 flex flex-col justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-blue-400 flex items-center gap-1"><Target size={12} /> Conversão</p>
                    <div>
                      <div className="flex items-end gap-1 mb-1">
                        <p className="text-2xl font-bold text-text-primary leading-none">{selectedPeriodConversion.toFixed(1)}%</p>
                      </div>
                      <p className="text-[9px] font-semibold text-text-secondary mt-0.5">vendas / total clientes</p>
                    </div>
                  </PremiumCard>

                  <PremiumCard className="p-3 bg-gradient-to-br from-indigo-500/10 to-card-bg border-indigo-500/20 shadow-[0_2px_10px_rgba(0,0,0,0.03)] h-28 flex flex-col justify-between">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-indigo-400 flex items-center gap-1 justify-between">
                      <span className="flex items-center gap-1"><Calendar size={12} /> Jornada</span>
                    </p>
                    <div>
                      <p className="text-2xl font-bold text-text-primary leading-none">{Math.round(globalMetrics.cicloMedioDias)} <span className="text-[10px] font-bold text-text-secondary tracking-normal">dias</span></p>
                      <p className="text-[9px] font-semibold text-text-secondary mt-1.5 flex items-center gap-1">TMC em média</p>
                    </div>
                  </PremiumCard>
                </div>

                {/* CHARTS LAYER — grid 2x2 de cards menores */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-6 print:break-inside-avoid">
                  <PremiumCard className="p-4 border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-4 flex items-center gap-1.5"><BarChart3 size={14} className="text-primary-400" /> Distribuição de Pipeline</h4>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pipelineDataLocal}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e2636" />
                          <XAxis dataKey="etapa" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8b94a3' }} />
                          <YAxis hide />
                          <Tooltip
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                            itemStyle={{ color: '#f4f6fb' }}
                            labelStyle={{ color: '#8b94a3' }}
                            formatter={(value: any, name: any, props: any) => [`${value} Clientes (${props.payload.percentual}%)`, 'Quantidade']}
                          />
                          <Bar dataKey="quantidade" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </PremiumCard>

                  <PremiumCard className="p-4 border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-4 flex items-center gap-1.5"><TrendingUp size={14} className="text-blue-400" /> Tendência no Período</h4>
                    <div className="h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendDataLocal}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e2636" />
                          <XAxis dataKey="periodo" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#8b94a3' }} tickFormatter={(v) => v.substring(8, 10) + '/' + v.substring(5, 7)} />
                          <YAxis hide yAxisId="left" />
                          <YAxis hide yAxisId="right" orientation="right" />
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                            itemStyle={{ color: '#f4f6fb' }}
                            labelStyle={{ color: '#8b94a3' }}
                            labelFormatter={(label) => `Data: ${label.split('-').reverse().join('/')}`}
                          />
                          <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '10px' }} />
                          <Line yAxisId="left" type="monotone" dataKey="Lt" name="Leads Adquiridos" stroke="#8b94a3" strokeWidth={2} dot={false} />
                          <Line yAxisId="left" type="monotone" dataKey="Vt" name="Vendas Concluídas" stroke="#22c55e" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 5 }} />
                          <Line yAxisId="right" type="monotone" dataKey="Rt" name="Receita" stroke="#2563eb" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </PremiumCard>

                  {/* Regiões de Interesse — drill-down: cidades → bairros */}
                  <PremiumCard className="p-4 border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary flex items-center gap-1.5">
                        <MapPin size={14} className="text-primary-400" />
                        {drillCity ? `Bairros — ${drillCity}` : 'Regiões de Interesse'}
                      </h4>
                      {drillCity ? (
                        <button onClick={() => setDrillCity(null)} className="flex items-center gap-1 text-[10px] font-semibold text-primary-400 hover:text-primary-300 transition-colors">
                          <ChevronLeft size={13} /> Cidades
                        </button>
                      ) : (
                        regionDataLocal.length > 0 && <span className="text-[9px] text-text-secondary">clique p/ ver bairros</span>
                      )}
                    </div>
                    <div className="h-44 w-full">
                      {!drillCity ? (
                        regionDataLocal.length === 0 ? (
                          <div className="flex h-full items-center justify-center text-xs text-text-secondary text-center px-4">Sem dados de cidade no período.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={regionDataLocal} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                innerRadius={38} outerRadius={64} paddingAngle={2} stroke="none" className="cursor-pointer"
                                onClick={(d: any) => { const n = d?.name ?? d?.payload?.name; if (n) setDrillCity(n); }}
                              >
                                {regionDataLocal.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} className="cursor-pointer" />)}
                              </Pie>
                              <Tooltip
                                contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                                itemStyle={{ color: '#f4f6fb' }}
                                formatter={(value: any, name: any, props: any) => [`${value} (${props.payload.percentual}%)`, name]}
                              />
                              <Legend wrapperStyle={{ fontSize: '9px' }} iconType="circle" />
                            </PieChart>
                          </ResponsiveContainer>
                        )
                      ) : (
                        drillBairroData.length === 0 ? (
                          <div className="flex h-full items-center justify-center text-xs text-text-secondary text-center px-4">Sem bairros informados para {drillCity} no período.</div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={drillBairroData} layout="vertical" margin={{ left: 8, right: 16 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e2636" />
                              <XAxis type="number" hide />
                              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={96} tick={{ fontSize: 9, fill: '#8b94a3' }} />
                              <Tooltip
                                cursor={{ fill: 'transparent' }}
                                contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                                itemStyle={{ color: '#f4f6fb' }}
                                formatter={(value: any, name: any, props: any) => [`${value} clientes (${props.payload.percentual}%)`, 'Quantidade']}
                              />
                              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                {drillBairroData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        )
                      )}
                    </div>
                  </PremiumCard>

                  {/* Construtoras (origem: campo Construtora da ficha do cliente) */}
                  <PremiumCard className="p-4 border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary mb-4 flex items-center gap-1.5"><Building2 size={14} className="text-green-400" /> Construtoras</h4>
                    <div className="h-44 w-full">
                      {builderDataLocal.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-xs text-text-secondary text-center px-4">Sem dados de construtora no período.</div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={builderDataLocal} layout="vertical" margin={{ left: 8, right: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e2636" />
                            <XAxis type="number" hide />
                            <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={90} tick={{ fontSize: 9, fill: '#8b94a3' }} />
                            <Tooltip
                              cursor={{ fill: 'transparent' }}
                              contentStyle={{ borderRadius: '8px', border: '1px solid #2b3547', backgroundColor: '#0d111a', color: '#f4f6fb', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                              itemStyle={{ color: '#f4f6fb' }}
                              formatter={(value: any, name: any, props: any) => [`${value} clientes (${props.payload.percentual}%)`, 'Quantidade']}
                            />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                              {builderDataLocal.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </PremiumCard>
                </div>

                {/* TOP 3 RANKINGS */}
                {[{
                  key: 'brokers',
                  title: `Ranking de Corretores (Top 3 • ${selectedPeriodLabel})`,
                  label: 'Corretor',
                  rows: periodBrokerRanking,
                  empty: `Nenhum corretor com dados no período ${selectedPeriodLabel}.`,
                }, {
                  key: 'managers',
                  title: `Ranking de Gerentes (Top 3 • ${selectedPeriodLabel})`,
                  label: 'Gerente',
                  rows: periodManagerRanking,
                  empty: `Nenhum gerente com dados no período ${selectedPeriodLabel}.`,
                }, {
                  key: 'coordinators',
                  title: `Ranking de Coordenadores (Top 3 • ${selectedPeriodLabel})`,
                  label: 'Coordenador',
                  rows: periodCoordinatorRanking,
                  empty: `Nenhum coordenador com dados no período ${selectedPeriodLabel}.`,
                }].map((ranking) => (
                  <PremiumCard key={ranking.key} className="p-0 overflow-hidden border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] mt-4">
                    <div className="p-3 border-b border-surface-100 flex items-center justify-between bg-surface-50">
                      <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> {ranking.title}</h4>
                      <span className="text-[10px] font-bold text-text-secondary bg-card-bg px-2 py-0.5 border border-surface-200 rounded-md shadow-sm">{ranking.rows.length}/3</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[760px]">
                        <thead>
                          <tr className="bg-card-bg text-text-secondary text-[9px] uppercase tracking-wider border-b border-surface-100">
                            <th className="p-3 font-bold">{ranking.label}</th>
                            <th className="p-3 font-bold text-center">Clientes</th>
                            <th className="p-3 font-bold text-center">Vendas</th>
                            <th className="p-3 font-bold text-center">Conversão</th>
                            <th className="p-3 font-bold text-right">VGV / Receita</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ranking.rows.map((c: any, i: number) => (
                            <tr key={`${ranking.key}-${c.entity_id}`} className="border-b border-surface-50 last:border-0 hover:bg-surface-50/50 transition-colors">
                              <td className="p-3 text-[11px] font-bold text-text-primary flex items-center gap-2">
                                <span className={`text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold shadow-sm shrink-0 ${i === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white' : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white' : 'bg-gradient-to-br from-orange-300 to-orange-500 text-white'}`}>{i + 1}</span>
                                <span className="truncate max-w-[70px]" title={String(c.nome || '').trim() || 'Sem nome'}>
                                  {formatBrokerDisplayName(c.nome)}
                                </span>
                              </td>
                              <td className="p-3 text-[11px] text-center text-text-secondary font-medium">{c.Li}</td>
                              <td className="p-3 text-[11px] text-center font-black text-green-600">{c.Vi}</td>
                              <td className="p-3 text-center">
                                <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold ${c.Taxa_Conversao_i >= 5 ? 'bg-green-50 text-green-700' : c.Taxa_Conversao_i > 0 ? 'bg-blue-50 text-blue-700' : 'bg-surface-50 text-text-secondary'}`}>
                                  {c.Taxa_Conversao_i}%
                                </span>
                              </td>
                              <td className="p-3 text-[11px] text-right font-bold text-text-primary tracking-tight">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0, notation: 'compact' }).format(c.Ri)}
                              </td>
                            </tr>
                          ))}
                          {ranking.rows.length === 0 && (
                            <tr><td colSpan={5} className="p-8 text-center text-text-secondary text-sm">{ranking.empty}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </PremiumCard>
                ))}
              </>
            )}
          </div>
        );

      case 'directorates':
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <RoundedButton size="sm" onClick={() => {
                setEditingDir(null);
                setDirForm({ name: '', description: '', manager_id: null });
                setIsDirModalOpen(true);
              }}>
                <Plus size={16} className="mr-1" /> Nova Diretoria
              </RoundedButton>
            </div>
            {loading ? <Loader2 size={24} className="animate-spin mx-auto text-gold-400 py-4" /> :
              directorates.map(d => (
                <PremiumCard
                  key={d.id}
                  className="flex items-center justify-between p-4 cursor-pointer transition-colors hover:border-primary-500/40"
                  onClick={() => navigate(`/reports?scope=diretoria&id=${d.id}&name=${encodeURIComponent(d.name)}&start=${reportDateRange.start}&end=${reportDateRange.end}`)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
                      <Building2 size={18} className="text-primary-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-text-primary">{d.name}</p>
                      <p className="text-xs text-text-secondary">{d.description || 'Sem descrição'}</p>
                      {d.manager_id && (
                        <p className="text-[10px] font-semibold text-gold-600 mt-0.5">
                          Gestor: {allProfiles.find(p => p.id === d.manager_id)?.name || 'Desconhecido'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setEditingDir(d); setDirForm({ name: d.name, description: d.description, manager_id: d.manager_id }); setIsDirModalOpen(true); }}
                      className="p-2 rounded-lg hover:bg-surface-100 text-text-secondary">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => { if (confirm('Excluir esta diretoria?')) deleteDirectorate(d.id); }}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </PremiumCard>
              ))
            }
          </div>
        );
      case 'gamification':
        return (
          <div className="space-y-4 print:space-y-6">
            {/* Internal sub-tab navigation */}
            <div className="flex gap-2 print:hidden">
              {[
                { id: 'xp', label: 'Pontos (XP)', icon: Zap },
                { id: 'conquistas', label: 'Conquistas', icon: Award },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveGamifSection(s.id as 'xp' | 'conquistas')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${activeGamifSection === s.id
                    ? 'bg-gold-500 text-white shadow-md shadow-gold-500/20'
                    : 'bg-card-bg dark:bg-surface-100 text-text-secondary border border-surface-200'
                    }`}
                >
                  <s.icon size={14} /> {s.label}
                </button>
              ))}
            </div>

            {/* Pontos (XP) section */}
            {activeGamifSection === 'xp' && (
              <section>
                <div className="flex flex-col gap-4 print:hidden">
                  <div className="bg-card-bg p-4 rounded-xl border border-surface-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-gold-600 font-semibold mb-2">
                        <Zap size={18} />
                        <span className="text-sm text-text-primary">Pontos Recebidos (XP)</span>
                      </div>
                      <p className="text-xs text-text-secondary hidden sm:block">Exibindo o total de moedas e XP gerado no período selecionado.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-text-secondary uppercase mb-1">Início</span>
                        <input
                          type="date"
                          value={xpDateRange.start}
                          onChange={e => setXpDateRange(p => ({ ...p, start: e.target.value }))}
                          className="w-full px-2 py-2 border border-surface-200 rounded-lg text-sm bg-surface-50 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none transition-all"
                          max={xpDateRange.end}
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-text-secondary uppercase mb-1">Fim</span>
                        <input
                          type="date"
                          value={xpDateRange.end}
                          onChange={e => setXpDateRange(p => ({ ...p, end: e.target.value }))}
                          className="w-full px-2 py-2 border border-surface-200 rounded-lg text-sm bg-surface-50 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none transition-all"
                          min={xpDateRange.start}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2 gap-2 border-t border-surface-100 mt-2">
                      <p className="text-[11px] text-text-secondary sm:hidden">Exibindo moedas/XP no período.</p>
                      <div className="flex gap-2">
                        <button onClick={() => {
                          const today = new Date();
                          setXpDateRange({ start: toDateOnlyLocal(new Date(today.getFullYear(), today.getMonth(), 1)), end: toDateOnlyLocal(today) });
                        }} className="px-3 py-1.5 bg-surface-100 text-[11px] font-semibold text-text-secondary rounded-lg hover:bg-gold-50 hover:text-gold-700 transition-colors">Este Mês</button>
                        <button onClick={() => {
                          const today = new Date();
                          const m30 = new Date();
                          m30.setDate(today.getDate() - 30);
                          setXpDateRange({ start: toDateOnlyLocal(m30), end: toDateOnlyLocal(today) });
                        }} className="px-3 py-1.5 bg-surface-100 text-[11px] font-semibold text-text-secondary rounded-lg hover:bg-gold-50 hover:text-gold-700 transition-colors">30 Dias</button>
                      </div>
                    </div>
                  </div>
                </div>

                <PremiumCard className="p-0 overflow-hidden">
                  {xpReportLoading ? (
                    <div className="p-12 text-center text-text-secondary">
                      <Loader2 size={32} className="animate-spin mx-auto text-gold-400 mb-4" />
                      Carregando pontuações...
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {/* Desktop Table View */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-surface-50 text-text-secondary text-[10px] uppercase tracking-wider border-b border-surface-100">
                              <th className="p-4 font-bold">Usuário / Corretor</th>
                              <th className="p-4 font-bold text-center">🏆 Vendas</th>
                              <th className="p-4 font-bold text-center">🎯 Missões/Metas</th>
                              <th className="p-4 font-bold text-center">📚 Treinamentos</th>
                              <th className="p-4 font-bold text-right">XP Total no Período</th>
                            </tr>
                          </thead>
                          <tbody>
                            {xpReportData.map((row: any, i: number) => (
                              <tr key={row.user_id} className="border-b border-surface-50 last:border-0 hover:bg-surface-50/50 transition-colors">
                                <td className="p-4 text-sm font-bold text-text-primary flex items-center gap-3">
                                  {i < 3 ? (
                                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold shadow-sm shrink-0 ${i === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white' : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white' : 'bg-gradient-to-br from-orange-300 to-orange-500 text-white'}`}>{i + 1}</span>
                                  ) : (
                                    <span className="w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold bg-surface-100 text-text-secondary shrink-0">{i + 1}</span>
                                  )}
                                  {row.user_name}
                                </td>
                                <td className="p-4 text-xs font-semibold text-center text-blue-600">{row.sales_xp} XP</td>
                                <td className="p-4 text-xs font-semibold text-center text-green-600">{row.missions_xp} XP</td>
                                <td className="p-4 text-xs font-semibold text-center text-purple-600">{row.training_xp} XP</td>
                                <td className="p-4 text-sm font-black text-right text-gold-600">
                                  {row.total_xp.toLocaleString('pt-BR')} XP
                                </td>
                              </tr>
                            ))}
                            {xpReportData.length === 0 && (
                              <tr><td colSpan={5} className="p-8 text-center text-text-secondary">Nenhum ponto recebido nesse período.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card View */}
                      <div className="md:hidden flex flex-col divide-y divide-surface-100">
                        {xpReportData.map((row: any, i: number) => (
                          <div key={row.user_id} className="p-4 flex flex-col gap-3 hover:bg-surface-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {i < 3 ? (
                                  <span className={`w-8 h-8 flex items-center justify-center rounded-full text-[11px] font-bold shadow-sm shrink-0 ${i === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white' : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white' : 'bg-gradient-to-br from-orange-300 to-orange-500 text-white'}`}>{i + 1}</span>
                                ) : (
                                  <span className="w-8 h-8 flex items-center justify-center rounded-full text-[11px] font-bold bg-surface-100 text-text-secondary shrink-0">{i + 1}</span>
                                )}
                                <span className="text-sm font-bold text-text-primary truncate">{row.user_name}</span>
                              </div>
                              <span className="text-base font-black text-gold-600 shrink-0">{row.total_xp.toLocaleString('pt-BR')} XP</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1 bg-surface-50 p-2.5 rounded-lg border border-surface-100">
                              <div className="flex flex-col items-center text-center">
                                <span className="text-[9px] font-bold text-text-secondary uppercase mb-0.5">Vendas</span>
                                <span className="text-xs font-bold text-blue-600">{row.sales_xp}</span>
                              </div>
                              <div className="flex flex-col items-center text-center border-l border-r border-surface-200">
                                <span className="text-[9px] font-bold text-text-secondary uppercase mb-0.5">Missões</span>
                                <span className="text-xs font-bold text-green-600">{row.missions_xp}</span>
                              </div>
                              <div className="flex flex-col items-center text-center">
                                <span className="text-[9px] font-bold text-text-secondary uppercase mb-0.5">Treinos</span>
                                <span className="text-xs font-bold text-purple-600">{row.training_xp}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                        {xpReportData.length === 0 && (
                          <div className="p-8 text-center text-text-secondary">Nenhum ponto recebido nesse período.</div>
                        )}
                      </div>
                    </div>
                  )}
                </PremiumCard>
              </section>
            )}

            {/* Conquistas section */}
            {activeGamifSection === 'conquistas' && (
              <section>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                    <Award className="text-gold-500" size={24} /> Sistema de Conquistas
                  </h2>
                </div>
                {renderAchievementsTab()}
              </section>
            )}
          </div>
        );

    }
  }; // end renderContent

  // ── Achievements state (inline, not in AppContext) ─────────────────────────
  const [achievements, setAchievements] = useState<any[]>([]);
  const [isAchievementModalOpen, setIsAchievementModalOpen] = useState(false);
  const [editingAchievement, setEditingAchievement] = useState<any | null>(null);
  const [achievementForm, setAchievementForm] = useState<any>({
    title: '', description: '', icon: 'Award', condition_type: 'sales_count', condition_value: 1
  });

  const CONDITION_LABELS: Record<string, string> = {
    sales_count: '# Vendas',
    sales_value: 'Valor de Vendas (R$)',
    streak_days: 'Dias Seguidos',
    approved_count: '# Fichas Aprovadas',
    goals_count: '# Metas Concluídas',
    missions_count: '# Missões Concluídas',
  };
  const ICON_OPTIONS = ['Award', 'Trophy', 'Star', 'Zap', 'Flame', 'Shield', 'Target', 'TrendingUp'];

  useEffect(() => {
    if (activeTab === 'gamification') {
      supabase.from('achievements').select('*').order('condition_type').order('condition_value')
        .then(({ data }) => setAchievements(data || []));
    }
  }, [activeTab]);

  const openAchievementModal = (ach?: any) => {
    setEditingAchievement(ach || null);
    setAchievementForm(ach
      ? { title: ach.title, description: ach.description, icon: ach.icon, condition_type: ach.condition_type, condition_value: ach.condition_value }
      : { title: '', description: '', icon: 'Award', condition_type: 'sales_count', condition_value: 1 }
    );
    setIsAchievementModalOpen(true);
  };

  const saveAchievement = async () => {
    if (!achievementForm.title.trim()) return;
    if (editingAchievement) {
      await supabase.from('achievements').update(achievementForm).eq('id', editingAchievement.id);
    } else {
      await supabase.from('achievements').insert([achievementForm]);
    }
    setIsAchievementModalOpen(false);
    const { data } = await supabase.from('achievements').select('*').order('condition_type').order('condition_value');
    setAchievements(data || []);
  };

  const deleteAchievement = async (id: string) => {
    if (!confirm('Excluir conquista?')) return;
    await supabase.from('achievements').delete().eq('id', id);
    setAchievements(prev => prev.filter(a => a.id !== id));
  };

  const renderAchievementsTab = () => (
    <div className="space-y-3">
      <div className="flex justify-end">
        <RoundedButton size="sm" onClick={() => openAchievementModal()}>
          <Plus size={14} className="mr-1" /> Nova Conquista
        </RoundedButton>
      </div>

      {/* Group by condition type */}
      {Object.entries(CONDITION_LABELS).map(([type, label]) => {
        const group = achievements.filter(a => a.condition_type === type);
        if (group.length === 0) return null;
        return (
          <div key={type}>
            <p className="text-[11px] font-bold text-text-secondary uppercase tracking-widest mb-2 mt-4 flex items-center gap-1">
              <Award size={12} className="text-gold-500" /> {label}
            </p>
            <div className="space-y-2">
              {group.map(ach => (
                <PremiumCard key={ach.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 border border-gold-200 dark:border-gold-800 flex items-center justify-center flex-shrink-0">
                      <Star size={18} className="text-gold-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-text-primary text-sm">{ach.title}</p>
                      <p className="text-xs text-text-secondary truncate">{ach.description}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-100 text-text-secondary mt-1 inline-block">
                        Gatilho: {ach.condition_type === 'sales_value'
                          ? `R$ ${Number(ach.condition_value).toLocaleString('pt-BR')}`
                          : ach.condition_value}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => openAchievementModal(ach)} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={13} /></button>
                      <button onClick={() => deleteAchievement(ach.id)} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                </PremiumCard>
              ))}
            </div>
          </div>
        );
      })}

      {achievements.length === 0 && (
        <p className="text-center text-text-secondary py-8">Nenhuma conquista cadastrada ainda.</p>
      )}
    </div>
  );



  return (
    <div className="w-full max-w-full px-3 sm:px-6 pt-6 pb-24 min-h-screen bg-surface-50 print:p-0 print:bg-white">
      <div className="print:hidden">
        <PageHeader title="Painel Administrativo" subtitle="Governança, equipes e estratégia da operação." />
      </div>

      <div className="w-full flex gap-2 overflow-x-auto mb-6 pb-2 print:hidden -mx-1 px-1">
        {[
          { id: 'users', label: 'Usuários', icon: Users },
          { id: 'teams', label: 'Equipes', icon: Shield },
          { id: 'goals', label: 'Metas', icon: Target },
          { id: 'announcements', label: 'Anúncios', icon: Megaphone },
          { id: 'reports', label: 'Relatórios', icon: BarChart3, adminOnly: true },
          { id: 'directorates', label: 'Diretorias', icon: Building2 },
          { id: 'gamification', label: 'Gamificação', icon: Zap },
        ].filter(tab => !tab.adminOnly || isAdmin).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-gold-500 text-white shadow-md shadow-gold-500/20' : 'bg-card-bg dark:bg-surface-100 text-text-secondary border border-surface-200'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
        <button
          onClick={() => navigate('/admin/security')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all bg-card-bg dark:bg-surface-100 text-text-secondary border border-surface-200 hover:border-gold-400 hover:text-gold-500"
        >
          <ShieldCheck size={14} /> Painel de Segurança
        </button>
      </div>

      <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* GLOBAL PENDING APPROVALS ALERT */}
        {activeTab === 'users' && pendingUsers.length > 0 && (
          <section className="mb-8 print:hidden">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-2xl p-4 mb-4 shadow-sm flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center shrink-0">
                <Shield className="text-amber-600 dark:text-amber-400" size={20} />
              </div>
              <div className="flex-1">
                <h3 className="text-amber-800 dark:text-amber-300 font-bold">Atenção Necessária</h3>
                <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-1">
                  Existem {pendingUsers.length} novo(s) usuário(s) aguardando liberação de acesso.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {pendingUsers.map(u => (
                <PremiumCard key={u.id} className="w-full p-3 sm:p-4 flex flex-col md:flex-row md:items-center md:flex-wrap justify-between gap-4 border-amber-200/50 dark:border-amber-700/30 overflow-hidden">
                  <div className="flex items-center gap-3 min-w-0 flex-1 basis-auto">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-surface-200 dark:bg-surface-800 flex items-center justify-center text-text-primary font-bold text-lg">
                      {(u.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-bold text-text-primary text-sm sm:text-base truncate">{u.name}</p>
                      <p className="inline-block relative z-10 text-[9px] sm:text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 rounded uppercase tracking-wider mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                        Novo Cadastro
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto shrink-0 mt-2 md:mt-0 relative z-20">
                    <RoundedButton onClick={() => handleRejectUser(u.id)} variant="outline" className="flex-1 sm:flex-none justify-center text-red-500 border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs px-3 py-1.5 w-full sm:w-[130px]">
                      Recusar
                    </RoundedButton>
                    <RoundedButton onClick={() => handleOpenApprovalModal(u.id)} className="flex-1 sm:flex-none justify-center bg-green-500 hover:bg-green-600 text-white border-0 shadow-sm shadow-green-500/20 text-xs px-3 py-1.5 w-full sm:w-[130px] whitespace-nowrap">
                      Aceitar Acesso
                    </RoundedButton>
                  </div>
                </PremiumCard>
              ))}
            </div>
          </section>
        )}

        {renderTabContent()}
      </div>

      {/* Approval Modal */}
      <Modal isOpen={isApprovalModalOpen} onClose={() => setIsApprovalModalOpen(false)} title="Aprovar Usuário">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary mb-4">
            Defina as permissões iniciais deste usuário antes de ativá-lo no sistema.
          </p>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Cargo</label>
            <select value={approvalForm.role} onChange={e => setApprovalForm(p => ({ ...p, role: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              {['CORRETOR', 'COORDENADOR', 'GERENTE', 'DIRETOR', 'ADMIN', 'RECEPCAO', 'ANALISTA'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Diretoria</label>
            <select value={approvalForm.directorate_id} onChange={e => setApprovalForm(p => ({ ...p, directorate_id: e.target.value, team_id: '' }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <option value="">Nenhuma / Global</option>
              {directorates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Equipe</label>
            <select value={approvalForm.team_id} onChange={e => setApprovalForm(p => ({ ...p, team_id: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary disabled:opacity-50"
              disabled={!approvalForm.directorate_id && teams.length > 0}>
              <option value="">Sem Equipe</option>
              {teams
                .filter(t => !approvalForm.directorate_id || t.directorate_id === approvalForm.directorate_id)
                .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {approvalForm.team_id && (
              <p className="text-xs text-green-600 mt-1">✓ O Gestor e a Diretoria serão herdados desta equipe automaticamente.</p>
            )}
          </div>
          {approvalForm.role === 'CORRETOR' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Coordenador Responsável</label>
              <select value={approvalForm.coordinator_id} onChange={e => setApprovalForm(p => ({ ...p, coordinator_id: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option value="">Sem Coordenador</option>
                {allProfiles
                  .filter(p => p.role?.toUpperCase() === 'COORDENADOR' && isProfileActive((p as any).status))
                  .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <RoundedButton fullWidth onClick={handleConfirmApproval} disabled={isSavingApproval} className="mt-2">
            {isSavingApproval ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Confirmar Aprovação'}
          </RoundedButton>
        </div>
      </Modal>

      {/* Team Modal */}
      <Modal isOpen={isTeamModalOpen} onClose={() => setIsTeamModalOpen(false)} title={editingTeam ? 'Editar Equipe' : 'Nova Equipe'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Nome</label>
            <input value={teamForm.name || ''} onChange={e => setTeamForm(p => ({ ...p, name: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" placeholder="Ex: Equipe Alpha" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Diretoria</label>
            <select value={teamForm.directorate_id || ''} onChange={e => setTeamForm(p => ({ ...p, directorate_id: e.target.value || null }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <option value="">Sem Diretoria</option>
              {directorates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Gestor da Equipe</label>
            <select value={teamForm.manager_id || ''} onChange={e => setTeamForm(p => ({ ...p, manager_id: e.target.value || null }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <option value="">Sem Gestor</option>
              {allProfiles
                .filter(p => ['ADMIN', 'DIRETOR', 'GERENTE', 'COORDENADOR'].includes(p.role))
                .map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)
              }
            </select>
          </div>
          <RoundedButton fullWidth onClick={handleSaveTeam} disabled={isSavingTeam}>
            {isSavingTeam ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Salvar'}
          </RoundedButton>
        </div>
      </Modal>

      {/* Manage Members Modal */}
      <Modal isOpen={isMembersModalOpen} onClose={() => setIsMembersModalOpen(false)} title="Gerenciar Membros">
        <div className="space-y-4">
          <div className="max-h-60 overflow-y-auto space-y-2">
            {allProfiles.filter(u => u.status === 'active' || u.status === 'Ativo').map(u => {
              const team = teams.find(t => t.id === selectedTeamId);
              const isMember = team ? getTeamMemberIds(team).includes(u.id) : false;
              return (
                <div key={u.id} className="flex justify-between items-center p-2 bg-surface-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-xs font-bold">{(u.name || '?').charAt(0)}</div>
                    <div><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-text-secondary">{u.role}</p></div>
                  </div>
                  <button onClick={() => selectedTeamId && handleToggleMember(selectedTeamId, u.id)}
                    className={`text-xs font-medium hover:underline ${isMember ? 'text-red-500' : 'text-green-600'}`}>
                    {isMember ? 'Remover' : 'Adicionar'}
                  </button>
                </div>
              );
            })}
          </div>
          <RoundedButton fullWidth onClick={() => setIsMembersModalOpen(false)}>Concluir</RoundedButton>
        </div>
      </Modal>

      {/* Goal Modal */}
      <Modal isOpen={isGoalModalOpen} onClose={() => setIsGoalModalOpen(false)} title={editingGoal ? (isMission ? 'Editar Missão' : 'Editar Meta') : (isMission ? 'Nova Missão' : 'Nova Meta')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <input value={goalForm.title || ''} onChange={e => setGoalForm(p => ({ ...p, title: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição</label>
            <textarea value={goalForm.description || ''} onChange={e => setGoalForm(p => ({ ...p, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-20" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Atribuir para</label>
            <select
              value={goalForm.assignee_type === 'All' ? 'All' : goalForm.assignee_type === 'Team' ? `team_${goalForm.assignee_id}` : goalForm.assignee_type === 'Directorate' ? `dir_${goalForm.assignee_id}` : goalForm.assignee_id}
              onChange={e => {
                const val = e.target.value;
                if (val === 'All') setGoalForm(p => ({ ...p, assignee_id: undefined, assignee_type: 'All' }));
                else if (val.startsWith('dir_')) setGoalForm(p => ({ ...p, assignee_id: val.replace('dir_', ''), assignee_type: 'Directorate' }));
                else if (val.startsWith('team_')) setGoalForm(p => ({ ...p, assignee_id: val.replace('team_', ''), assignee_type: 'Team' }));
                else setGoalForm(p => ({ ...p, assignee_id: val, assignee_type: 'User' }));
              }}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <optgroup label="Geral">
                <option value="All">Todos (Global)</option>
              </optgroup>
              {directorates.length > 0 && (
                <optgroup label="Diretorias">
                  {directorates.map(d => <option key={d.id} value={`dir_${d.id}`}>{d.name}</option>)}
                </optgroup>
              )}
              {teams.length > 0 && (
                <optgroup label="Equipes">
                  {teams.map(t => <option key={t.id} value={`team_${t.id}`}>{t.name}</option>)}
                </optgroup>
              )}
              <optgroup label="Usuários (Individuais)">
                {allProfiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              </optgroup>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Medição</label>
              <select value={goalForm.measure_type || 'currency'} onChange={e => setGoalForm(p => ({ ...p, measure_type: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option value="currency">Soma de Valores (R$)</option>
                <option value="quantity">Quantidades</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Alvo</label>
              {(goalForm.measure_type || 'currency') === 'currency' ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={goalForm.target ? Number(goalForm.target).toLocaleString('pt-BR') : ''}
                  onChange={e => {
                    // Strip everything except digits, then store as number
                    const raw = e.target.value.replace(/\D/g, '');
                    setGoalForm(p => ({ ...p, target: raw ? Number(raw) : 0 }));
                  }}
                  placeholder="Ex: 10.000.000"
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary"
                />
              ) : (
                <input
                  type="number"
                  min={1}
                  value={goalForm.target || ''}
                  onChange={e => setGoalForm(p => ({ ...p, target: Number(e.target.value) }))}
                  placeholder="Ex: 5"
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary"
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Objetivo</label>
              <select value={goalForm.objective_type || 'sales'} onChange={e => setGoalForm(p => ({ ...p, objective_type: e.target.value as 'sales' | 'approved_clients' }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option value="sales">🏆 Vendas Concluídas</option>
                <option value="approved_clients">✅ Fichas Aprovadas</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Empreendimento (Filtro)</label>
              <select value={goalForm.property_id || ''} onChange={e => setGoalForm(p => ({ ...p, property_id: e.target.value || undefined }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option value="">Todos os Empreendimentos</option>
                {developments?.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
              <input type="date" value={goalForm.start_date || ''} onChange={e => setGoalForm(p => ({ ...p, start_date: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
              <input type="date" value={goalForm.deadline || ''} onChange={e => setGoalForm(p => ({ ...p, deadline: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              ⚡ Recompensa XP ao concluir
            </label>
            <input
              type="number"
              min={0}
              placeholder={isMission ? '500 (padrão para Missão)' : '300 (padrão para Meta)'}
              value={goalForm.points || ''}
              onChange={e => setGoalForm(p => ({ ...p, points: e.target.value ? Number(e.target.value) : undefined }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary"
            />
            <p className="text-[11px] text-text-secondary mt-1 opacity-75">
              Deixe em branco para usar o padrão ({isMission ? '500' : '300'} XP)
            </p>
          </div>
          <RoundedButton fullWidth onClick={handleSaveGoal} disabled={isSavingGoal}>
            {isSavingGoal ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Salvar'}
          </RoundedButton>
        </div>
      </Modal>

      {/* Announcement Modal */}
      <Modal isOpen={isAnnouncementModalOpen} onClose={() => setIsAnnouncementModalOpen(false)} title={editingAnnouncement ? 'Editar Anúncio' : 'Novo Anúncio'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <input value={announcementForm.title || ''} onChange={e => setAnnouncementForm(p => ({ ...p, title: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Conteúdo</label>
            <textarea value={announcementForm.content || ''} onChange={e => setAnnouncementForm(p => ({ ...p, content: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-24" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Prioridade</label>
            <select value={announcementForm.priority} onChange={e => setAnnouncementForm(p => ({ ...p, priority: e.target.value as any }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <option>Normal</option><option>Importante</option><option>Urgente</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
              <input type="date" value={announcementForm.start_date || ''} onChange={e => setAnnouncementForm(p => ({ ...p, start_date: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
              <input type="date" value={announcementForm.end_date || ''} onChange={e => setAnnouncementForm(p => ({ ...p, end_date: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
          </div>
          <RoundedButton fullWidth onClick={handleSaveAnnouncement} disabled={isSavingAnnouncement}>
            {isSavingAnnouncement ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Salvar'}
          </RoundedButton>
        </div>
      </Modal>

      {/* Directorate Modal */}
      <Modal isOpen={isDirModalOpen} onClose={() => setIsDirModalOpen(false)} title={editingDir ? 'Editar Diretoria' : 'Nova Diretoria'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Nome da Diretoria</label>
            <input value={dirForm.name || ''} onChange={e => setDirForm(p => ({ ...p, name: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary"
              placeholder="Ex: DIRETORIA COMERCIAL" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Gestor Responsável (Opcional)</label>
            <select value={dirForm.manager_id || ''} onChange={e => setDirForm(p => ({ ...p, manager_id: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
              <option value="">Nenhum Gestor</option>
              {allProfiles.filter(p => p.role === 'DIRETOR' || p.role === 'ADMIN' || p.role === 'GERENTE').map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição (opcional)</label>
            <textarea value={dirForm.description || ''} onChange={e => setDirForm(p => ({ ...p, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-20"
              placeholder="Descreva a diretoria..." />
          </div>
          <RoundedButton fullWidth onClick={async () => {
            if (!dirForm.name) return;
            setIsSavingDir(true);
            try {
              if (editingDir) await updateDirectorate(editingDir.id, dirForm);
              else await addDirectorate({ name: dirForm.name, description: dirForm.description, manager_id: dirForm.manager_id });
              setIsDirModalOpen(false);
            } finally { setIsSavingDir(false); }
          }} disabled={isSavingDir}>
            {isSavingDir ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : 'Salvar Diretoria'}
          </RoundedButton>
        </div>
      </Modal>
      {/* Achievements Modal */}
      <Modal isOpen={isAchievementModalOpen} onClose={() => setIsAchievementModalOpen(false)} title={editingAchievement ? 'Editar Conquista' : 'Nova Conquista'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <input value={achievementForm.title || ''} onChange={e => setAchievementForm((p: any) => ({ ...p, title: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" placeholder="Ex: Primeira Venda" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição</label>
            <textarea value={achievementForm.description || ''} onChange={e => setAchievementForm((p: any) => ({ ...p, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-20" placeholder="Descrição da conquista..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Tipo de Gatilho</label>
              <select value={achievementForm.condition_type} onChange={e => setAchievementForm((p: any) => ({ ...p, condition_type: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option value="sales_count"># Vendas</option>
                <option value="sales_value">Valor de Vendas (R$)</option>
                <option value="streak_days">Dias Seguidos</option>
                <option value="approved_count"># Fichas Aprovadas</option>
                <option value="goals_count"># Metas Concluídas</option>
                <option value="missions_count"># Missões Concluídas</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                {achievementForm.condition_type === 'sales_value' ? 'Valor (R$)' : 'Quantidade'}
              </label>
              {achievementForm.condition_type === 'sales_value' ? (
                <input type="text" inputMode="numeric"
                  value={achievementForm.condition_value ? Number(achievementForm.condition_value).toLocaleString('pt-BR') : ''}
                  onChange={e => { const raw = e.target.value.replace(/\D/g, ''); setAchievementForm((p: any) => ({ ...p, condition_value: raw ? Number(raw) : 0 })); }}
                  placeholder="Ex: 1.000.000"
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              ) : (
                <input type="number" min={1}
                  value={achievementForm.condition_value || ''}
                  onChange={e => setAchievementForm((p: any) => ({ ...p, condition_value: Number(e.target.value) }))}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              )}
            </div>
          </div>
          <RoundedButton fullWidth onClick={saveAchievement}>Salvar Conquista</RoundedButton>
        </div>
      </Modal>
    </div>
  );
}
