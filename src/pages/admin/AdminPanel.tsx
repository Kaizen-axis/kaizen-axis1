import React, { useCallback, useEffect, useState } from 'react';
import { PageHeader, PremiumCard, RoundedButton } from '@/components/ui/PremiumComponents';
import { Users, Shield, Target, Megaphone, BarChart3, Plus, Search, Trophy, Download, FileSpreadsheet, FileText, Trash2, Edit2, ChevronDown, ChevronLeft, Calendar, Loader2, Building2, TrendingUp, Printer, Star, Award, Zap, Flame, MoreHorizontal, FileDown, MapPin, Ban, Lock, UserCircle, DollarSign, Clock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useApp, Team, Goal, Announcement, Directorate } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Navigate, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, PieChart, Pie, Cell } from 'recharts';
import { supabase } from '@/lib/supabase';
import { PDFDocument } from 'pdf-lib';
import { PAGE, PDF_THEME, embedFonts, loadKaizenLogo, drawReportHeader, drawSectionTitle, drawKeyValues, drawDivider, drawContinuationHeader, drawHBars, addStandardFooters, downloadPdf, safeText } from '@/lib/pdf/reportKit';
import PipelinePdfExport from '@/components/admin/PipelinePdfExport';
import { ScopeTargetPicker } from '@/components/admin/ScopeTargetPicker';
import {
  ANNOUNCEMENT_SCOPES,
  GOAL_SCOPES,
  normalizeScopeType,
  resolveAssigneeLabel,
  resolveDirectorateIdForTarget,
} from '@/lib/admin/scopeTarget';
import { useReportsData } from '@/hooks/useReportsData';
import { parseDateOnlyLocal, parseDateOnlyLocalEnd, toDateOnlyLocal, toPtBrDate } from '@/lib/dateRange';
import { CLIENT_STAGES } from '@/data/clients';
import { getTeamMemberIds, profileMatchesTeam } from '@/lib/reports/teamMembers';
import { TeamCardGrid } from '@/pages/reports/TeamCardGrid';
import { DiretoriaCardGrid } from '@/pages/reports/DiretoriaCardGrid';
import { FilterMenu } from '@/pages/reports/FilterMenu';
import { buildReportHref } from '@/lib/reports/reportNav';
import { formatGoalProgressLine, goalObjectiveBadge } from '@/lib/goals/objectiveLabel';
import { hhmmToMinutes, minutesToHHMM } from '@/lib/checkin/checkinUi';
import {
  getReceptionUnitCode,
  getUserRoleLabel,
  USER_ROLE_OPTIONS,
} from '@/lib/auth/userRoles';

import { CardActionsMenu, type CardActionItem } from '@/components/ui/CardActionsMenu';
import { CommissionManagement } from '@/pages/admin/CommissionManagement';
import { UserProfileModal } from '@/components/admin/UserProfileModal';
import { ScrollTabBar } from '@/components/ui/ScrollTabBar';
import {
  FloatingToast,
  type FloatingToastFeedback,
} from '@/components/ui/FloatingToast';

type Tab = 'users' | 'teams' | 'goals' | 'announcements' | 'reports' | 'commissions' | 'directorates' | 'gamification' | 'checkin';

export default function AdminPanel() {
  // ── Hard role guard: only ADMIN and DIRETOR can access this page ────────────
  const { isAdmin, isDirector, directorateId } = useAuthorization();
  if (!isAdmin && !isDirector) return <Navigate to="/" replace />;

  const {
    allProfiles, updateProfile, refreshProfiles,
    teams, refreshTeams, addTeam, updateTeam, deleteTeam,
    goals, addGoal, updateGoal, deleteGoal,
    announcements, addAnnouncement, updateAnnouncement, deleteAnnouncement,
    directorates, addDirectorate, updateDirectorate, deleteDirectorate,
    checkinUnits, updateCheckinUnitSchedule,
    clients, leads, appointments,
    developments,
    loading, user
  } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();

  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [activeGoalTab, setActiveGoalTab] = useState<'active' | 'ended'>('active');
  const [activeGamifSection, setActiveGamifSection] = useState<'xp' | 'conquistas'>('xp');
  const [searchTerm, setSearchTerm] = useState('');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Team modal
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [teamForm, setTeamForm] = useState<Partial<Team>>({ name: '', directorate_id: '' });
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  // Goal modal
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalForm, setGoalForm] = useState<Partial<Goal>>({ title: '', description: '', target: 0, start_date: '', deadline: '', type: 'Mensal', assignee_type: 'All', points: 0 });
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  // Announcement modal
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [announcementForm, setAnnouncementForm] = useState<Partial<Announcement>>({ title: '', content: '', priority: 'Normal', start_date: '', end_date: '', assignee_type: 'All' });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  // Manage members
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Directorate modal
  const [isDirModalOpen, setIsDirModalOpen] = useState(false);
  const [editingDir, setEditingDir] = useState<Directorate | null>(null);
  const [dirForm, setDirForm] = useState<Partial<Directorate>>({ name: '', description: '' });
  const [isSavingDir, setIsSavingDir] = useState(false);

  // Check-in settings by unit
  const [unitScheduleForms, setUnitScheduleForms] = useState<Record<string, { start: string; end: string }>>({});
  const [savingUnitCode, setSavingUnitCode] = useState<string | null>(null);
  const [unitScheduleFeedback, setUnitScheduleFeedback] = useState<FloatingToastFeedback | null>(null);
  const closeUnitScheduleFeedback = useCallback(() => setUnitScheduleFeedback(null), []);

  useEffect(() => {
    setUnitScheduleForms(Object.fromEntries(checkinUnits.map(unit => [
      unit.code,
      {
        start: minutesToHHMM(unit.start_minutes),
        end: minutesToHHMM(unit.end_minutes),
      },
    ])));
  }, [checkinUnits]);

  const handleSaveCheckinUnitSchedule = async (unitCode: string, unitName: string) => {
    const form = unitScheduleForms[unitCode];
    const startMinutes = hhmmToMinutes(form?.start ?? '');
    const endMinutes = hhmmToMinutes(form?.end ?? '');
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      setUnitScheduleFeedback({ type: 'error', message: 'Informe horários válidos.' });
      return;
    }
    if (endMinutes <= startMinutes) {
      setUnitScheduleFeedback({
        type: 'error',
        message: 'O horário final deve ser posterior ao horário inicial.',
      });
      return;
    }

    setSavingUnitCode(unitCode);
    setUnitScheduleFeedback(null);
    try {
      await updateCheckinUnitSchedule(unitCode, startMinutes, endMinutes);
      setUnitScheduleFeedback({
        type: 'success',
        message: `Horário de ${unitName} salvo com sucesso.`,
      });
    } catch (error: any) {
      console.error(`Erro ao salvar horário de ${unitName}:`, error);
      setUnitScheduleFeedback({
        type: 'error',
        message: 'Não foi possível salvar. Tente novamente.',
      });
    } finally {
      setSavingUnitCode(null);
    }
  };

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
  const [isReportDateModalOpen, setIsReportDateModalOpen] = useState(false);
  const [customStartInput, setCustomStartInput] = useState('');
  const [customEndInput, setCustomEndInput] = useState('');
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

  // Seletor de período no padrão da aba Relatórios (FilterMenu) ───────────────
  const REPORT_PERIOD_LABELS: Record<'este_mes' | '30_dias' | '60_dias' | '90_dias', string> = {
    este_mes: 'Mês vigente',
    '30_dias': '30 dias',
    '60_dias': '60 dias',
    '90_dias': '90 dias',
  };

  const reportPeriodFilterLabel = reportPeriod === 'custom'
    ? `${toPtBrDate(reportDateRange.start)} - ${toPtBrDate(reportDateRange.end)}`
    : REPORT_PERIOD_LABELS[reportPeriod];

  const handleReportPeriodFilter = (option: string) => {
    if (option === 'Personalizado') {
      setCustomStartInput(reportDateRange.start);
      setCustomEndInput(reportDateRange.end);
      setIsReportDateModalOpen(true);
      return;
    }
    const map: Record<string, 'este_mes' | '30_dias' | '60_dias' | '90_dias'> = {
      'Mês vigente': 'este_mes',
      '30 dias': '30_dias',
      '60 dias': '60_dias',
      '90 dias': '90_dias',
    };
    const id = map[option];
    if (id) applyReportPeriod(id);
  };

  const applyCustomReportRange = () => {
    if (!customStartInput || !customEndInput) {
      alert('Por favor, selecione as datas de início e fim.');
      return;
    }
    setReportPeriod('custom');
    setReportDateRange({ start: customStartInput, end: customEndInput });
    setIsReportDateModalOpen(false);
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
          ...getTeamMemberIds(team, allProfiles),
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

  const scopedDirectorates = isAdmin ? directorates : directorates.filter(d => d.id === directorateId);
  const scopedTeams = isAdmin ? teams : teams.filter(t => t.directorate_id === directorateId);
  const scopedProfiles = isAdmin ? allProfiles : allProfiles.filter(p => p.directorate_id === directorateId);
  const scopedCoordinators = scopedProfiles.filter(p => p.role?.toUpperCase() === 'COORDENADOR' && isProfileActive(p.status));
  const announcementScopes = isAdmin ? ANNOUNCEMENT_SCOPES : ANNOUNCEMENT_SCOPES.filter(scope => scope !== 'All');
  const goalScopes = isAdmin ? GOAL_SCOPES : GOAL_SCOPES.filter(scope => scope !== 'All');
  const assigneeCatalogs = { directorates, teams, profiles: allProfiles };

  // ── Users Actions ──────────────────────────────────────────────────────────
  const handleRoleChange = async (id: string, role: string) => {
    try {
      const receptionUnit = getReceptionUnitCode(role);
      await updateProfile(id, {
        role,
        ...(receptionUnit ? { checkin_unit_code: receptionUnit } : {}),
      });
    } catch (error: any) {
      console.error('Erro ao atualizar perfil (role):', error);
      alert(`Não foi possível atualizar o cargo. ${error?.message || ''}`.trim());
    }
  };
  const handleCheckinUnitChange = async (id: string, checkin_unit_code: string) => {
    try {
      await updateProfile(id, { checkin_unit_code });
    } catch (error: any) {
      console.error('Erro ao atualizar unidade de check-in:', error);
      alert(`Não foi possível atualizar a unidade de check-in. ${error?.message || ''}`.trim());
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


  const handleDeactivateUser = (userId: string, userName: string) => {
    requestConfirm({
      title: 'Confirmar desativação',
      message: (
        <>
          <p>Você está prestes a remover o acesso do usuário:</p>
          <p className="font-bold text-text-primary mt-2">&quot;{userName}&quot;</p>
          <ul className="mt-3 space-y-1 list-disc list-inside">
            <li>Bloqueia o acesso do usuário</li>
            <li>Mantém o histórico e as vendas já registradas</li>
          </ul>
        </>
      ),
      confirmLabel: 'Desativar usuário',
      requireTypedConfirm: true,
      onConfirm: async () => {
        const { error } = await supabase
          .from('profiles')
          .update({ status: 'Inativo' })
          .eq('id', userId);

        if (error) throw error;

        logAuditEvent({ action: 'user_deactivated', entity: 'profile', entityId: userId, metadata: { name: userName } });
        alert(`Usuário "${userName}" foi desativado com sucesso. O histórico foi preservado.`);
        await refreshProfiles();
      },
    });
  };

  const handleReactivateUser = (userId: string, userName: string) => {
    requestConfirm({
      title: 'Reativar usuário',
      message: `Tem certeza que deseja reativar o usuário "${userName}"?`,
      confirmLabel: 'Reativar',
      variant: 'default',
      onConfirm: async () => {
        const { error } = await supabase
          .from('profiles')
          .update({ status: 'Ativo' })
          .eq('id', userId);

        if (error) throw error;

        alert(`Usuário "${userName}" foi reativado.`);
        await refreshProfiles();
      },
    });
  };

  const handlePermanentDeleteUser = (userId: string, userName: string) => {
    requestConfirm({
      title: 'Excluir permanentemente',
      message: (
        <>
          <p>O login de <span className="font-bold text-text-primary">"{userName}"</span> será removido de vez.</p>
          <ul className="mt-3 space-y-1 list-disc list-inside text-sm">
            <li>O acesso e o perfil desaparecem da lista</li>
            <li>Vendas, clientes e check-ins permanecem no histórico, desvinculados</li>
            <li>Esta ação não pode ser desfeita</li>
          </ul>
        </>
      ),
      confirmLabel: 'Excluir',
      requireTypedConfirm: true,
      variant: 'danger',
      onConfirm: async () => {
        const { data, error } = await supabase.rpc('delete_user_permanently', { user_id: userId });
        if (error) {
          alert(error.message || 'Não foi possível excluir o usuário.');
          throw error;
        }
        if (data && typeof data === 'object' && 'success' in data && (data as { success?: boolean }).success === false) {
          throw new Error((data as { message?: string }).message || 'Falha ao excluir usuário.');
        }
        alert(`Usuário "${userName}" foi excluído. O histórico comercial foi preservado.`);
        logAuditEvent({ action: 'user_deleted', entity: 'profile', entityId: userId, metadata: { name: userName } });
        await refreshProfiles();
      },
    });
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

      const receptionUnit = getReceptionUnitCode(approvalForm.role);
      if (receptionUnit) {
        updateData.checkin_unit_code = receptionUnit;
      }

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

  const handleRejectUser = (id: string) => {
    requestConfirm({
      title: 'Rejeitar usuário',
      message: 'Tem certeza que deseja rejeitar este usuário? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Rejeitar',
      onConfirm: () => updateProfile(id, { status: 'rejected' }),
    });
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

  const handleToggleMember = async (teamId: string, userId: string, userName?: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const members = getTeamMemberIds(team, allProfiles);
    const isAdding = !members.includes(userId);

    const performToggle = async () => {
      try {
        await updateProfile(userId, {
          team: isAdding ? teamId : null,
          team_id: isAdding ? teamId : null,
          directorate_id: isAdding ? (team.directorate_id || null) : undefined,
          manager_id: isAdding ? (team.manager_id || null) : undefined,
        });
        await refreshTeams();
        await refreshProfiles();
      } catch (e) {
        console.error('Erro ao atualizar membro da equipe:', e);
      }
    };

    if (!isAdding) {
      requestConfirm({
        title: 'Remover membro',
        message: `Tem certeza que deseja remover ${userName || 'este membro'} da equipe?`,
        confirmLabel: 'Remover',
        onConfirm: performToggle,
      });
      return;
    }

    await performToggle();
  };

  // ── Goal Actions ───────────────────────────────────────────────────────────
  const openGoalModal = (goal?: Goal) => {
    if (goal) {
      setEditingGoal(goal);
      setGoalForm({
        ...goal,
        assignee_type: normalizeScopeType(goal.assignee_type),
      });
    } else {
      setEditingGoal(null);
      setGoalForm({ title: '', description: '', target: 0, start_date: '', deadline: '', type: 'Mensal', assignee_type: isAdmin ? 'All' : 'Directorate', assignee_id: isAdmin ? undefined : directorateId || undefined, points: 0, measure_type: 'currency', objective_type: 'sales' });
    }
    setIsGoalModalOpen(true);
  };
  const handleSaveGoal = async () => {
    if (!goalForm.title) return;
    const assigneeType = normalizeScopeType(goalForm.assignee_type);
    if (assigneeType !== 'All' && !goalForm.assignee_id) {
      alert('Selecione o destino da meta.');
      return;
    }
    setIsSavingGoal(true);
    try {
      const payload = {
        ...goalForm,
        type: editingGoal?.type || 'Mensal',
        assignee_type: assigneeType,
        assignee_id: assigneeType === 'All' ? null : goalForm.assignee_id,
        directorate_id: resolveDirectorateIdForTarget(
          { type: assigneeType, id: goalForm.assignee_id || undefined },
          { teams: scopedTeams, profiles: scopedProfiles, fallbackDirectorateId: isAdmin ? null : directorateId },
        ),
      } as Omit<Goal, 'id'> & { directorate_id?: string | null };
      if (editingGoal) await updateGoal(editingGoal.id, payload);
      else await addGoal({ ...payload, current_progress: 0 });
      setIsGoalModalOpen(false);
    } catch (e: any) {
      alert('Erro ao salvar meta: ' + (e?.message || 'Tente novamente.'));
    } finally { setIsSavingGoal(false); }
  };

  // ── Announcement Actions ───────────────────────────────────────────────────
  const openAnnouncementModal = (ann?: Announcement) => {
    if (ann) {
      const type = normalizeScopeType(ann.assignee_type || (ann.directorate_id ? 'Directorate' : 'All'));
      setEditingAnnouncement(ann);
      setAnnouncementForm({
        ...ann,
        assignee_type: type,
        assignee_id: ann.assignee_id || (type === 'Directorate' ? ann.directorate_id || undefined : undefined),
      });
    } else {
      setEditingAnnouncement(null);
      setAnnouncementForm({ title: '', content: '', priority: 'Normal', start_date: '', end_date: '', assignee_type: isAdmin ? 'All' : 'Directorate', assignee_id: isAdmin ? undefined : directorateId || undefined });
    }
    setIsAnnouncementModalOpen(true);
  };
  const handleSaveAnnouncement = async () => {
    if (!announcementForm.title) return;
    const assigneeType = normalizeScopeType(announcementForm.assignee_type);
    if (assigneeType !== 'All' && !announcementForm.assignee_id) {
      alert('Selecione o destino do anúncio.');
      return;
    }
    setIsSavingAnnouncement(true);
    try {
      const payload = {
        ...announcementForm,
        assignee_type: assigneeType,
        assignee_id: assigneeType === 'All' ? null : announcementForm.assignee_id,
        directorate_id: resolveDirectorateIdForTarget(
          { type: assigneeType, id: announcementForm.assignee_id || undefined },
          { teams: scopedTeams, profiles: scopedProfiles, fallbackDirectorateId: isAdmin ? null : directorateId },
        ),
      };
      if (editingAnnouncement) await updateAnnouncement(editingAnnouncement.id, payload);
      else await addAnnouncement({ ...payload, author_id: user?.id } as Omit<Announcement, 'id' | 'created_at'>);
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
                    <PremiumCard key={u.id} className="w-full p-4">
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
                          <p className="text-xs text-text-secondary">{getUserRoleLabel(u.role)}</p>
                        </div>
                        <CardActionsMenu
                          items={[
                            {
                              label: 'Perfil',
                              icon: <UserCircle size={13} />,
                              onClick: () => setProfileUserId(u.id),
                            },
                            {
                              label: 'Desativar acesso',
                              icon: <Ban size={13} />,
                              onClick: () => handleDeactivateUser(u.id, u.name || 'Usuário'),
                            },
                            ...(isAdmin ? [{
                              label: 'Excluir',
                              icon: <Trash2 size={13} />,
                              danger: true as const,
                              onClick: () => handlePermanentDeleteUser(u.id, u.name || 'Usuário'),
                            } satisfies CardActionItem] : []),
                          ]}
                        />
                      </div>

                      {/* Dropdowns */}
                      <div className="w-full">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-center">
                          <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                            className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400">
                            {USER_ROLE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <select value={(u as any).directorate_id ?? ''} onChange={e => handleDirectorateChange(u.id, e.target.value || null)}
                            className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Diretoria</option>
                            {directorates.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <select
                            value={(u as any).team_id || (u as any).team || ''}
                            onChange={e => handleTeamChange(u.id, e.target.value || null)}
                            className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400"
                          >
                            <option value="">Sem Equipe</option>
                            {teams
                              .filter(t => !(u as any).directorate_id || t.directorate_id === (u as any).directorate_id || t.id === ((u as any).team_id || (u as any).team))
                              .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                          <select value={(u as any).manager_id ?? ''} onChange={e => handleManagerChange(u.id, e.target.value || null)}
                            className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Gestor</option>
                            {allProfiles
                              .filter(p => p.id !== u.id && p.role?.toUpperCase() === 'GERENTE' && isProfileActive((p as any).status))
                              .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <select value={(u as any).coordinator_id ?? ''} onChange={e => handleCoordinatorChange(u.id, e.target.value || null)}
                            className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400">
                            <option value="">Sem Coordenador</option>
                            {allProfiles
                              .filter(p => p.id !== u.id && p.role?.toUpperCase() === 'COORDENADOR' && isProfileActive((p as any).status))
                              .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          {isAdmin && (
                            <select
                              value={u.checkin_unit_code ?? 'zona_oeste'}
                              onChange={e => handleCheckinUnitChange(u.id, e.target.value)}
                              aria-label={`Unidade de check-in de ${u.name}`}
                              className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400"
                            >
                              {checkinUnits.map(unit => (
                                <option key={unit.code} value={unit.code}>{unit.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
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
                    <PremiumCard key={u.id} className="w-full p-4 opacity-80">
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
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
                          <RoundedButton
                            size="sm"
                            onClick={() => handleReactivateUser(u.id, u.name || 'Usuário')}
                            className="bg-green-500 hover:bg-green-600 text-white border-0"
                          >
                            Reativar
                          </RoundedButton>
                          {isAdmin && (
                            <RoundedButton
                              size="sm"
                              variant="outline"
                              onClick={() => handlePermanentDeleteUser(u.id, u.name || 'Usuário')}
                              className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                            >
                              Excluir
                            </RoundedButton>
                          )}
                        </div>
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
                <TeamCardGrid
                  teams={teams}
                  clients={clients as ReportClientLike[]}
                  startDate={reportDateRange.start}
                  endDate={reportDateRange.end}
                  renderActions={(team) => (
                    <CardActionsMenu items={[
                      { label: 'Editar', icon: <Edit2 size={13} />, onClick: () => openTeamModal(team) },
                      { label: 'Gerenciar membros', icon: <Users size={13} />, onClick: () => { setSelectedTeamId(team.id); setIsMembersModalOpen(true); } },
                      { label: 'Excluir', icon: <Trash2 size={13} />, danger: true, onClick: () => {
                        requestConfirm({
                          title: 'Excluir equipe',
                          message: 'Tem certeza que deseja excluir esta equipe? Esta ação não poderá ser desfeita.',
                          confirmLabel: 'Excluir',
                          onConfirm: () => deleteTeam(team.id),
                        });
                      } },
                    ]} />
                  )}
                />}
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
              <div className="flex justify-end">
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

                  let progressColor = 'bg-blue-500';
                  let tierText = '';

                  if (progress >= 100) {
                    progressColor = 'bg-emerald-500';
                    tierText = 'Meta batida';
                  } else if (progress >= 67) {
                    progressColor = 'bg-emerald-500';
                    tierText = 'Prata';
                  } else if (progress >= 34) {
                    progressColor = 'bg-orange-400';
                    tierText = 'Bronze';
                  } else {
                    progressColor = 'bg-blue-500';
                    tierText = 'Em andamento';
                  }

                  return (
                    <PremiumCard key={goal.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-text-primary truncate">{goal.title}</h4>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-100 text-text-secondary">
                              {resolveAssigneeLabel(goal, assigneeCatalogs)}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-100 text-text-secondary">
                              {goalObjectiveBadge(goal.objective_type)}
                            </span>
                            {goal.status === 'achieved' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">Atingida</span>}
                            {goal.status === 'failed' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Falhou</span>}
                          </div>
                          {goal.description && <p className="text-xs text-text-secondary mt-1">{goal.description}</p>}
                          {goal.property_id && (
                            <p className="text-xs text-gold-500 mt-1 flex items-center gap-1">
                              <Building2 size={12} /> {developments?.find(d => d.id === goal.property_id)?.name || 'Empreendimento'}
                            </p>
                          )}
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-text-secondary mb-1 gap-2">
                              <span>Progresso: {tierText}</span>
                              <span className="text-right">
                                {formatGoalProgressLine({
                                  measureType: goal.measure_type,
                                  objectiveType: goal.objective_type,
                                  current: goal.current_progress || 0,
                                  target: goal.target || 0,
                                })}
                              </span>
                            </div>
                            <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                              <div className={`h-full ${progressColor} rounded-full transition-all`} style={{ width: `${Math.min(progress, 100)}%` }} />
                            </div>

                          </div>
                        </div>
                        <div className="flex gap-2 ml-3 flex-shrink-0">
                          <button onClick={() => openGoalModal(goal)} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={14} /></button>
                          <button onClick={() => {
                            requestConfirm({
                              title: 'Excluir meta',
                              message: 'Tem certeza que deseja excluir esta meta? Esta ação não poderá ser desfeita.',
                              confirmLabel: 'Excluir',
                              onConfirm: () => deleteGoal(goal.id),
                            });
                          }} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={14} /></button>
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
                  const priorityColors: Record<string, string> = {
                    Urgente: 'text-red-400 bg-red-500/15',
                    Importante: 'text-amber-400 bg-amber-500/15',
                    Normal: 'text-blue-400 bg-blue-500/15',
                  };
                  return (
                    <PremiumCard key={ann.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityColors[ann.priority || 'Normal']}`}>{ann.priority}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-100 text-text-secondary">
                              {resolveAssigneeLabel(ann, assigneeCatalogs)}
                            </span>
                            <h4 className="font-bold text-text-primary truncate">{ann.title}</h4>
                          </div>
                          <p className="text-sm text-text-secondary line-clamp-2">{ann.content}</p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button onClick={() => openAnnouncementModal(ann)} className="p-1.5 bg-surface-50 rounded-full hover:text-gold-600"><Edit2 size={14} /></button>
                          <button onClick={() => {
                            requestConfirm({
                              title: 'Excluir anúncio',
                              message: 'Tem certeza que deseja excluir este anúncio? Esta ação não poderá ser desfeita.',
                              confirmLabel: 'Excluir',
                              onConfirm: () => deleteAnnouncement(ann.id),
                            });
                          }} className="p-1.5 bg-surface-50 rounded-full hover:text-red-500"><Trash2 size={14} /></button>
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

            {/* ── Modal: período personalizado ── */}
            <Modal isOpen={isReportDateModalOpen} onClose={() => setIsReportDateModalOpen(false)} title="Período Personalizado">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Início</label>
                  <input type="date" value={customStartInput} onChange={(e) => setCustomStartInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Fim</label>
                  <input type="date" value={customEndInput} onChange={(e) => setCustomEndInput(e.target.value)} className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
                </div>
                <RoundedButton fullWidth onClick={applyCustomReportRange}>Aplicar Filtro</RoundedButton>
              </div>
            </Modal>

            {/* ── Period filter + Extra Tools ── */}
            <div className="print:hidden flex items-center justify-end gap-2 relative">
              <FilterMenu period={reportPeriodFilterLabel} onPeriodChange={handleReportPeriodFilter} />
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
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-accent-hover transition-colors disabled:opacity-50"
                        title="Gerar relatório geral"
                      >
                        {pdfExportType === 'geral' ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Relatório Geral
                      </button>
                      <button
                        onClick={() => { setIsToolsMenuOpen(false); handleExportTeamPdf(); }}
                        disabled={reportLoading || !reportData || pdfExportType !== null}
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-accent-hover transition-colors disabled:opacity-50"
                        title="Gerar relatório por equipe"
                      >
                        {pdfExportType === 'equipe' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Relatório Equipe
                      </button>
                      <button
                        onClick={() => { setIsToolsMenuOpen(false); handleExportCoordinationPdf(); }}
                        disabled={reportLoading || !reportData || pdfExportType !== null}
                        className="w-full flex items-center gap-2 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-accent-hover transition-colors disabled:opacity-50"
                        title="Gerar relatório por coordenação"
                      >
                        {pdfExportType === 'coordenacao' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Relatório Coordenação
                      </button>
                    </div>

                    <div className="border-t border-surface-100" />
                    <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Ferramentas</div>
                    <button
                      onClick={() => { setIsToolsMenuOpen(false); setIsPipelineModalOpen(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-100 dark:hover:bg-surface-200 transition-colors text-left"
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
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-100 dark:hover:bg-surface-200 transition-colors text-left"
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

                {/* MÉTRICAS PRINCIPAIS — grid unificado, cards com mesma altura e largura */}
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 print:grid-cols-3 print:gap-4 print:mt-4">
                  {([
                    { label: 'Clientes', value: String(selectedPeriodClients.length), sub: 'no período selecionado', icon: <Users size={14} />, iconBg: 'bg-primary-500/15 text-primary-400', route: '/clients', state: undefined },
                    { label: 'Aprovados', value: String(selectedPeriodApproved), sub: 'clientes aprovados', icon: <Shield size={14} />, iconBg: 'bg-green-500/15 text-green-400', route: '/clients', state: { initialStage: 'Aprovado' } },
                    { label: 'Agenda', value: String(upcomingAppointmentsCount), sub: 'compromissos futuros', icon: <Calendar size={14} />, iconBg: 'bg-blue-500/15 text-blue-400', route: '/schedule', state: undefined },
                    { label: 'VGV', value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(vgvLocal), sub: `${selectedPeriodSalesCount} vendas concluídas`, icon: <TrendingUp size={14} />, iconBg: 'bg-green-500/15 text-green-400' },
                    { label: 'Conversão', value: `${selectedPeriodConversion.toFixed(1)}%`, sub: 'vendas / total clientes', icon: <Target size={14} />, iconBg: 'bg-blue-500/15 text-blue-400' },
                    { label: 'Jornada', value: `${Math.round(globalMetrics.cicloMedioDias)} dias`, sub: 'TMC em média', icon: <Calendar size={14} />, iconBg: 'bg-indigo-500/15 text-indigo-400' },
                  ] as Array<{ label: string; value: string; sub: string; icon: React.ReactNode; iconBg: string; route?: string; state?: any }>).map((stat) => (
                    <PremiumCard
                      key={stat.label}
                      interactive={!!stat.route}
                      className="p-3 relative flex flex-col justify-between h-28 shadow-[0_2px_10px_rgba(0,0,0,0.02)] border-surface-100"
                      onClick={() => stat.route && navigate(stat.route, { state: stat.state })}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`p-1.5 rounded-md shrink-0 ${stat.iconBg}`}>{stat.icon}</span>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary truncate">{stat.label}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-lg font-bold text-text-primary leading-none whitespace-nowrap truncate">{stat.value}</p>
                        <p className="text-[9px] font-semibold text-text-secondary mt-1.5 truncate">{stat.sub}</p>
                      </div>
                    </PremiumCard>
                  ))}
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
                  hrefFor: (row: any) => row?.entity_id
                    ? buildReportHref({ scope: 'corretor', id: row.entity_id, name: row.nome, start: reportDateRange.start, end: reportDateRange.end })
                    : null,
                }, {
                  key: 'managers',
                  title: `Ranking de Gerentes (Top 3 • ${selectedPeriodLabel})`,
                  label: 'Gerente',
                  rows: periodManagerRanking,
                  empty: `Nenhum gerente com dados no período ${selectedPeriodLabel}.`,
                  hrefFor: (row: any) => {
                    const team = teams.find(t => t.manager_id === row?.entity_id);
                    return team
                      ? buildReportHref({ scope: 'equipe', id: team.id, name: team.name, start: reportDateRange.start, end: reportDateRange.end })
                      : null;
                  },
                }, {
                  key: 'coordinators',
                  title: `Ranking de Coordenadores (Top 3 • ${selectedPeriodLabel})`,
                  label: 'Coordenador',
                  rows: periodCoordinatorRanking,
                  empty: `Nenhum coordenador com dados no período ${selectedPeriodLabel}.`,
                  hrefFor: (row: any) => row?.entity_id
                    ? buildReportHref({ scope: 'corretor', id: row.entity_id, name: row.nome, start: reportDateRange.start, end: reportDateRange.end })
                    : null,
                }].map((ranking) => (
                  <PremiumCard key={ranking.key} className="p-0 overflow-hidden border-surface-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] mt-4">
                    <div className="p-3 border-b border-surface-100 flex items-center justify-between bg-surface-50">
                      <h4 className="text-[11px] uppercase tracking-wider font-bold text-text-secondary flex items-center gap-1.5"><Trophy size={14} className="text-gold-500" /> {ranking.title}</h4>
                      <span className="text-[10px] font-bold text-text-secondary bg-card-bg px-2 py-0.5 border border-surface-200 rounded-md shadow-sm">{ranking.rows.length}/3</span>
                    </div>
                    <div className="overflow-x-auto overscroll-x-contain">
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
                          {ranking.rows.map((c: any, i: number) => {
                            const rowHref = ranking.hrefFor(c);
                            const displayName = formatBrokerDisplayName(c.nome);
                            const fullName = String(c.nome || '').trim() || 'Sem nome';
                            return (
                            <tr
                              key={`${ranking.key}-${c.entity_id}`}
                              className={`border-b border-surface-50 last:border-0 transition-colors ${rowHref ? 'cursor-pointer hover:bg-accent-hover' : 'hover:bg-surface-100/50'}`}
                              onClick={rowHref ? () => navigate(rowHref) : undefined}
                              role={rowHref ? 'button' : undefined}
                              tabIndex={rowHref ? 0 : undefined}
                              onKeyDown={rowHref ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(rowHref); } } : undefined}
                              title={rowHref ? `${fullName} — abrir relatório` : fullName}
                            >
                              <td className="p-3 text-[11px] font-bold text-text-primary">
                                <span className="flex items-center gap-2">
                                  <span className={`text-[9px] w-4 h-4 flex items-center justify-center rounded-full font-bold shadow-sm shrink-0 ${i === 0 ? 'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white' : i === 1 ? 'bg-gradient-to-br from-gray-200 to-gray-400 text-white' : 'bg-gradient-to-br from-orange-300 to-orange-500 text-white'}`}>{i + 1}</span>
                                  <span className="truncate max-w-[70px]">{displayName}</span>
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
                            );
                          })}
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

      case 'checkin':
        if (!isAdmin) return null;
        return (
          <div className="max-w-4xl space-y-4">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-text-primary flex items-center gap-2">
                <Clock size={18} className="text-gold-500" /> Horário do check-in
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Defina uma janela diária independente para cada unidade, no fuso de Brasília.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {checkinUnits.map(unit => {
                const form = unitScheduleForms[unit.code] ?? {
                  start: minutesToHHMM(unit.start_minutes),
                  end: minutesToHHMM(unit.end_minutes),
                };
                const isSaving = savingUnitCode === unit.code;

                return (
                  <PremiumCard key={unit.code} className="p-4 sm:p-5 space-y-4">
                    <div>
                      <p className="text-sm font-bold text-text-primary flex items-center gap-1.5">
                        <MapPin size={15} className="text-gold-500" /> {unit.name}
                      </p>
                      <p className="text-[11px] text-text-secondary mt-1">
                        Raio de {unit.max_radius_meters.toLocaleString('pt-BR')} m · precisão máxima de {unit.max_accuracy_meters} m
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Início</label>
                        <input
                          type="time"
                          value={form.start}
                          onChange={event => setUnitScheduleForms(current => ({
                            ...current,
                            [unit.code]: { ...form, start: event.target.value },
                          }))}
                          className="w-full min-h-10 px-3 bg-surface-50 rounded-lg border border-surface-200 text-sm text-text-primary focus:outline-none focus:border-gold-400"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Fim</label>
                        <input
                          type="time"
                          value={form.end}
                          onChange={event => setUnitScheduleForms(current => ({
                            ...current,
                            [unit.code]: { ...form, end: event.target.value },
                          }))}
                          className="w-full min-h-10 px-3 bg-surface-50 rounded-lg border border-surface-200 text-sm text-text-primary focus:outline-none focus:border-gold-400"
                        />
                      </div>
                    </div>

                    <RoundedButton
                      fullWidth
                      onClick={() => handleSaveCheckinUnitSchedule(unit.code, unit.name)}
                      disabled={isSaving}
                    >
                      {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />}
                      {isSaving ? 'Salvando...' : 'Salvar horário'}
                    </RoundedButton>
                  </PremiumCard>
                );
              })}
            </div>
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
              directorates.length === 0 ? <p className="text-center text-text-secondary py-8">Nenhuma diretoria cadastrada.</p> :
                <DiretoriaCardGrid
                  directorates={directorates}
                  clients={clients as ReportClientLike[]}
                  startDate={reportDateRange.start}
                  endDate={reportDateRange.end}
                  renderActions={(d) => (
                    <CardActionsMenu items={[
                      { label: 'Editar', icon: <Edit2 size={13} />, onClick: () => { setEditingDir(d); setDirForm({ name: d.name, description: d.description, manager_id: d.manager_id }); setIsDirModalOpen(true); } },
                      { label: 'Excluir', icon: <Trash2 size={13} />, danger: true, onClick: () => {
                        requestConfirm({
                          title: 'Excluir diretoria',
                          message: 'Tem certeza que deseja excluir esta diretoria? Esta ação não poderá ser desfeita.',
                          confirmLabel: 'Excluir',
                          onConfirm: () => deleteDirectorate(d.id),
                        });
                      } },
                    ]} />
                  )}
                />
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
                        }} className="px-3 py-1.5 bg-surface-100 text-[11px] font-semibold text-text-secondary rounded-lg hover:bg-accent-hover hover:text-gold-700 transition-colors">Este Mês</button>
                        <button onClick={() => {
                          const today = new Date();
                          const m30 = new Date();
                          m30.setDate(today.getDate() - 30);
                          setXpDateRange({ start: toDateOnlyLocal(m30), end: toDateOnlyLocal(today) });
                        }} className="px-3 py-1.5 bg-surface-100 text-[11px] font-semibold text-text-secondary rounded-lg hover:bg-accent-hover hover:text-gold-700 transition-colors">30 Dias</button>
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
                      <div className="hidden md:block overflow-x-auto overscroll-x-contain">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-surface-50 text-text-secondary text-[10px] uppercase tracking-wider border-b border-surface-100">
                              <th className="p-4 font-bold">Usuário / Corretor</th>
                              <th className="p-4 font-bold text-center">Vendas</th>
                              <th className="p-4 font-bold text-center">Metas</th>
                              <th className="p-4 font-bold text-center">Treinamentos</th>
                              <th className="p-4 font-bold text-right">XP Total no Período</th>
                            </tr>
                          </thead>
                          <tbody>
                            {xpReportData.map((row: any, i: number) => (
                              <tr key={row.user_id} className="border-b border-surface-50 last:border-0 hover:bg-surface-100/50 transition-colors">
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
                          <div key={row.user_id} className="p-4 flex flex-col gap-3 hover:bg-surface-100 transition-colors">
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
                                <span className="text-[9px] font-bold text-text-secondary uppercase mb-0.5">Metas</span>
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
      case 'commissions':
        return <CommissionManagement />;
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
    missions_count: '# Metas concluídas',
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

  const deleteAchievement = (id: string) => {
    requestConfirm({
      title: 'Excluir conquista',
      message: 'Tem certeza que deseja excluir esta conquista? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: async () => {
        await supabase.from('achievements').delete().eq('id', id);
        setAchievements(prev => prev.filter(a => a.id !== id));
      },
    });
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
                    <div className="w-10 h-10 rounded-xl bg-accent-subtle border border-gold-200 dark:border-gold-800 flex items-center justify-center flex-shrink-0">
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
      <FloatingToast
        feedback={unitScheduleFeedback}
        onClose={closeUnitScheduleFeedback}
      />

      <div className="print:hidden">
        <PageHeader title="Painel Administrativo" subtitle="Governança, equipes e estratégia da operação." />
      </div>

      <ScrollTabBar className="mb-6 print:hidden">
        {[
          { id: 'users', label: 'Usuários', icon: Users },
          { id: 'teams', label: 'Equipes', icon: Shield },
          { id: 'directorates', label: 'Diretorias', icon: Building2 },
          { id: 'reports', label: 'Central de relatórios', icon: BarChart3, adminOnly: true },
          { id: 'announcements', label: 'Anúncios', icon: Megaphone },
          { id: 'commissions', label: 'Comissionamento', icon: DollarSign },
          { id: 'goals', label: 'Metas', icon: Target },
          { id: 'gamification', label: 'Gamificação', icon: Zap },
          { id: 'checkin', label: 'Check-in', icon: Clock, adminOnly: true },
        ].filter(tab => !tab.adminOnly || isAdmin).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)}
            className={`shrink-0 min-h-11 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-gold-500 text-white shadow-md shadow-gold-500/20' : 'bg-card-bg dark:bg-surface-100 text-text-secondary border border-surface-200'}`}>
            <tab.icon size={13} className="shrink-0" /> {tab.label}
          </button>
        ))}
        <button
          type="button"
          disabled
          title="Em breve"
          aria-label="Segurança — em breve"
          className="shrink-0 min-h-11 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold whitespace-nowrap bg-card-bg dark:bg-surface-100 text-text-secondary border border-surface-200 opacity-50 cursor-not-allowed"
        >
          <Lock size={13} className="shrink-0" /> Segurança
        </button>
      </ScrollTabBar>

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
                    <RoundedButton onClick={() => handleRejectUser(u.id)} variant="outline" className="flex-1 sm:flex-none justify-center text-red-500 border-red-200 hover:bg-danger-subtle dark:hover:bg-red-900/20 text-xs px-3 py-1.5 w-full sm:w-[130px]">
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

      <UserProfileModal
        userId={profileUserId}
        isOpen={!!profileUserId}
        onClose={() => setProfileUserId(null)}
      />

      <ConfirmDialog {...confirmDialogProps} />

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
              {USER_ROLE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
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
              const isMember = team ? getTeamMemberIds(team, allProfiles).includes(u.id) : false;
              return (
                <div key={u.id} className="flex justify-between items-center p-2 bg-surface-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-xs font-bold">{(u.name || '?').charAt(0)}</div>
                    <div><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-text-secondary">{u.role}</p></div>
                  </div>
                  <button onClick={() => selectedTeamId && handleToggleMember(selectedTeamId, u.id, u.name)}
                    className={`min-h-11 px-3 text-xs font-medium hover:underline ${isMember ? 'text-red-500' : 'text-green-600'}`}>
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
      <Modal isOpen={isGoalModalOpen} onClose={() => setIsGoalModalOpen(false)} title={editingGoal ? 'Editar Meta' : 'Nova Meta'}>
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
          <ScopeTargetPicker
            scopes={goalScopes}
            value={{ type: normalizeScopeType(goalForm.assignee_type), id: goalForm.assignee_id || undefined }}
            onChange={({ type, id }) => setGoalForm(p => ({ ...p, assignee_type: type, assignee_id: id }))}
            directorates={scopedDirectorates}
            teams={scopedTeams}
            coordinators={scopedCoordinators}
            profiles={scopedProfiles}
          />
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
                <option value="sales">Vendas concluídas</option>
                <option value="approved_clients">Fichas aprovadas</option>
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
              Recompensa XP ao concluir
            </label>
            <input
              type="number"
              min={0}
              placeholder="300 (padrão)"
              value={goalForm.points || ''}
              onChange={e => setGoalForm(p => ({ ...p, points: e.target.value ? Number(e.target.value) : undefined }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary"
            />
            <p className="text-[11px] text-text-secondary mt-1 opacity-75">
              Deixe em branco para usar o padrão (300 XP)
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
          <ScopeTargetPicker
            scopes={announcementScopes}
            value={{ type: normalizeScopeType(announcementForm.assignee_type), id: announcementForm.assignee_id || undefined }}
            onChange={({ type, id }) => setAnnouncementForm(p => ({ ...p, assignee_type: type, assignee_id: id }))}
            directorates={scopedDirectorates}
            teams={scopedTeams}
            coordinators={scopedCoordinators}
            profiles={scopedProfiles}
          />
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
                <option value="missions_count"># Metas concluídas</option>
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

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
