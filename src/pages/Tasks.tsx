import { useEffect, useMemo, useRef, useState } from 'react';
import { PremiumCard, StatusBadge, PageHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import {
  Archive,
  ArchiveRestore,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Edit2,
  Filter,
  ListChecks,
  Loader2,
  Plus,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ScrollTabBar } from '@/components/ui/ScrollTabBar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useApp, Task } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import {
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

type CardFilter = 'Todos' | 'Pendente' | 'Em Andamento' | 'Concluída' | 'Arquivadas';
type DeadlinePeriod = 'Todos' | 'Vencidas' | 'Hoje' | 'Esta semana' | 'Este mês' | 'Sem prazo';

function parseDeadline(deadline?: string) {
  if (!deadline) return null;
  const date = new Date(`${deadline}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesDeadline(deadline: string | undefined, period: DeadlinePeriod, today: Date) {
  if (period === 'Todos') return true;
  if (period === 'Sem prazo') return !deadline;
  const date = parseDeadline(deadline);
  if (!date) return false;
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (period === 'Vencidas') return isBefore(date, startToday);
  if (period === 'Hoje') return isSameDay(date, startToday);
  if (period === 'Esta semana') {
    return isWithinInterval(date, {
      start: startOfWeek(startToday, { weekStartsOn: 1 }),
      end: endOfWeek(startToday, { weekStartsOn: 1 }),
    });
  }
  if (period === 'Este mês') {
    return isWithinInterval(date, {
      start: startOfMonth(startToday),
      end: endOfMonth(startToday),
    });
  }
  return true;
}

export default function Tasks() {
  const { tasks, addTask, updateTask, deleteTask, loading, profile, allProfiles, teams } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const [cardFilter, setCardFilter] = useState<CardFilter>('Todos');
  const [filterStatus, setFilterStatus] = useState('Todas');
  const [filterResponsible, setFilterResponsible] = useState('');
  const [filterPeriod, setFilterPeriod] = useState<DeadlinePeriod>('Todos');
  const [showFilters, setShowFilters] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const today = new Date();
  const [reportStartDate, setReportStartDate] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`);
  const [reportEndDate, setReportEndDate] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, '0')}`);
  const [formData, setFormData] = useState<Partial<Task>>({
    title: '', responsible: 'Eu', deadline: '', status: 'Pendente', description: '', subtasks: []
  });
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  const currentRole = String(profile?.role || '').toUpperCase();
  const canDelegate = currentRole === 'GERENTE' || currentRole === 'COORDENADOR' || currentRole === 'ADMIN' || currentRole === 'DIRETOR';
  const isManager = currentRole === 'GERENTE';
  const assignableBrokers = allProfiles.filter((p) => {
    const role = String(p.role || '').toUpperCase();
    if (role !== 'CORRETOR') return false;
    if (currentRole === 'COORDENADOR') return p.coordinator_id === profile?.id;
    if (currentRole === 'GERENTE') {
      const teamId = String(p.team_id || p.team || '');
      const belongsToManagedTeam = !!teamId && teams.some((t) => t.id === teamId && t.manager_id === profile?.id);
      const directManagerLink = p.manager_id === profile?.id;
      const coordinatorLinkedToManager = !!(p.coordinator_id && allProfiles.some((c) => c.id === p.coordinator_id && c.manager_id === profile?.id));
      return directManagerLink || coordinatorLinkedToManager || belongsToManagedTeam;
    }
    return true;
  });

  const taskOwnerName = (task: Task) =>
    allProfiles.find((p) => p.id === task.assigned_to)?.name || task.responsible || '';

  const responsibleOptions = useMemo(() => {
    const names = new Set<string>();
    allProfiles.forEach((p) => { if (p.name) names.add(p.name); });
    tasks.forEach((t) => {
      const name = taskOwnerName(t);
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [allProfiles, tasks]);

  useEffect(() => {
    if (!showFilters) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setShowFilters(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showFilters]);

  const handleOpenModal = (task?: Task) => {
    if (task) { setEditingTask(task); setFormData(JSON.parse(JSON.stringify(task))); }
    else { setEditingTask(null); setFormData({ title: '', responsible: 'Eu', deadline: '', status: 'Pendente', description: '', subtasks: [], assigned_to: canDelegate ? (assignableBrokers[0]?.id || profile?.id) : profile?.id, assignment_scope: 'INDIVIDUAL' }); }
    setNewSubtaskTitle('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title) return;
    setIsSaving(true);
    try {
      if (editingTask) {
        await updateTask(editingTask.id, formData);
      } else {
        await addTask({ ...formData, assigned_to: formData.assigned_to || profile?.id, subtasks: formData.subtasks || [] } as Omit<Task, 'id' | 'created_at'>);
      }
      setIsModalOpen(false);
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel salvar a tarefa. Tente novamente.');
    } finally { setIsSaving(false); }
  };

  const handleDelete = (id: string) => {
    requestConfirm({
      title: 'Excluir tarefa',
      message: 'Tem certeza que deseja excluir esta tarefa? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: async () => {
        try {
          await deleteTask(id);
        } catch (e: any) {
          alert(e?.message || 'Nao foi possivel excluir a tarefa. Tente novamente.');
        }
      },
    });
  };

  const handleArchive = async (task: Task) => {
    try {
      await updateTask(task.id, { archived_at: new Date().toISOString() });
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel arquivar a tarefa.');
    }
  };

  const handleUnarchive = async (task: Task) => {
    try {
      await updateTask(task.id, { archived_at: null });
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel desarquivar a tarefa.');
    }
  };

  const toggleComplete = async (task: Task) => {
    try {
      await updateTask(task.id, { status: task.status === 'Concluída' ? 'Pendente' : 'Concluída' });
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel atualizar a tarefa. Tente novamente.');
    }
  };

  const toggleSubtaskCompletion = async (task: Task, subtaskId: string) => {
    const newSubtasks = task.subtasks.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s);
    try {
      await updateTask(task.id, { subtasks: newSubtasks });
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel atualizar subtarefa. Tente novamente.');
    }
  };

  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const newSubtask = { id: Date.now().toString(), title: newSubtaskTitle, completed: false };
    setFormData(p => ({ ...p, subtasks: [...(p.subtasks || []), newSubtask] }));
    setNewSubtaskTitle('');
  };

  const removeSubtask = (subtaskId: string) => {
    setFormData(p => ({ ...p, subtasks: (p.subtasks || []).filter(s => s.id !== subtaskId) }));
  };

  const isArchived = (task: Task) => Boolean(task.archived_at);
  const activeTasks = tasks.filter((t) => !isArchived(t));
  const archivedTasks = tasks.filter(isArchived);

  const counts = {
    total: activeTasks.length,
    pendentes: activeTasks.filter((t) => t.status === 'Pendente').length,
    andamento: activeTasks.filter((t) => t.status === 'Em Andamento').length,
    concluidas: activeTasks.filter((t) => t.status === 'Concluída').length,
    arquivadas: archivedTasks.length,
  };

  const filteredTasks = (cardFilter === 'Arquivadas' ? archivedTasks : activeTasks).filter((t) => {
    if (cardFilter === 'Pendente' || cardFilter === 'Em Andamento' || cardFilter === 'Concluída') {
      if (t.status !== cardFilter) return false;
    } else if (cardFilter === 'Todos' && filterStatus !== 'Todas') {
      if (t.status !== filterStatus) return false;
    }
    if (filterResponsible && taskOwnerName(t) !== filterResponsible) return false;
    if (!matchesDeadline(t.deadline, filterPeriod, today)) return false;
    return true;
  });

  const activeFiltersCount =
    (filterStatus !== 'Todas' && cardFilter === 'Todos' ? 1 : 0) +
    (filterResponsible ? 1 : 0) +
    (filterPeriod !== 'Todos' ? 1 : 0);

  const selectCard = (next: CardFilter) => {
    setCardFilter(next);
    if (next === 'Todos') setFilterStatus('Todas');
    else if (next !== 'Arquivadas') setFilterStatus(next);
  };

  const formatDeadline = (deadline?: string) => {
    if (!deadline) return '';
    try {
      return format(new Date(deadline + 'T00:00:00'), "d 'de' MMM", { locale: ptBR });
    } catch { return deadline; }
  };

  const summaryCards: {
    id: CardFilter;
    label: string;
    value: number;
    icon: typeof ListChecks;
    iconClass: string;
  }[] = [
    { id: 'Todos', label: 'Total', value: counts.total, icon: ListChecks, iconClass: 'bg-primary-500/15 text-primary-400' },
    { id: 'Pendente', label: 'Pendentes', value: counts.pendentes, icon: Circle, iconClass: 'bg-amber-500/15 text-amber-400' },
    { id: 'Em Andamento', label: 'Em andamento', value: counts.andamento, icon: Clock, iconClass: 'bg-blue-500/15 text-blue-400' },
    { id: 'Concluída', label: 'Concluídas', value: counts.concluidas, icon: CheckCircle2, iconClass: 'bg-emerald-500/15 text-emerald-400' },
    { id: 'Arquivadas', label: 'Arquivadas', value: counts.arquivadas, icon: Archive, iconClass: 'bg-surface-200 text-text-secondary' },
  ];

  const downloadCompletedTasksReport = async () => {
    setIsExporting(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'Concluída')
        .gte('completed_at', `${reportStartDate}T00:00:00`)
        .lte('completed_at', `${reportEndDate}T23:59:59`)
        .order('completed_at', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const rows = (data || []) as Task[];
      if (rows.length === 0) {
        alert('Nenhuma tarefa concluida encontrada no periodo selecionado.');
        return;
      }

      const pdfDoc = await PDFDocument.create();
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const logoImg = await loadKaizenLogo(pdfDoc);
      const headerOpts = { title: 'Relatório de Tarefas', subtitle: `Tarefas concluídas · Período: ${reportStartDate} a ${reportEndDate}` };

      const PAGE_W = 842;
      const PAGE_H = 595;
      const MARGIN = 28;
      const TABLE_W = PAGE_W - (MARGIN * 2);
      const ROW_H = 18;
      const HEADER_H = 20;
      const colorDark = rgb(0.11, 0.12, 0.15);
      const colorGold = rgb(0.145, 0.388, 0.922);
      const colorGray = rgb(0.43, 0.45, 0.5);
      const colorLight = rgb(0.96, 0.96, 0.97);
      const colorWhite = rgb(1, 1, 1);

      const columns = [
        { header: 'TITULO', width: 210 },
        { header: 'RESPONSAVEL', width: 150 },
        { header: 'ATRIBUIDA POR', width: 150 },
        { header: 'PRAZO', width: 105 },
        { header: 'CONCLUIDA EM', width: 105 },
      ];

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      const drawSummary = () => {
        page.drawText('RESUMO', { x: MARGIN, y, size: 10, font: fontBold, color: colorGold });
        y -= 16;
        const total = rows.length;
        const uniqueResponsibles = new Set(rows.map((r) => r.assigned_to).filter(Boolean)).size;
        const doneInDeadline = rows.filter((r) => r.deadline && r.completed_at && new Date(r.completed_at) <= new Date(`${r.deadline}T23:59:59`)).length;
        const onTimeRate = total > 0 ? Math.round((doneInDeadline / total) * 100) : 0;
        [
          `Total de tarefas concluidas: ${total}`,
          `Corretores com entregas: ${uniqueResponsibles}`,
          `Concluidas no prazo: ${doneInDeadline} (${onTimeRate}%)`,
        ].forEach((line) => {
          page.drawText(line, { x: MARGIN, y, size: 8.5, font: fontRegular, color: colorDark });
          y -= 13;
        });
        y -= 4;
      };

      const drawTableHeader = () => {
        page.drawRectangle({ x: MARGIN, y: y - HEADER_H, width: TABLE_W, height: HEADER_H, color: colorGold });
        let cx = MARGIN + 4;
        columns.forEach((col) => {
          page.drawText(col.header, { x: cx, y: y - HEADER_H + 6, size: 7, font: fontBold, color: colorWhite });
          cx += col.width;
        });
        y -= HEADER_H;
      };

      const truncate = (text: string, max = 32) => text.length > max ? `${text.slice(0, max - 1)}...` : text;
      y = drawReportHeader(page, { regular: fontRegular, bold: fontBold }, logoImg, headerOpts);
      drawSummary();
      drawTableHeader();

      rows.forEach((task) => {
        if (y < MARGIN + ROW_H) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = drawReportHeader(page, { regular: fontRegular, bold: fontBold }, logoImg, headerOpts);
          drawTableHeader();
        }
        const responsibleName = allProfiles.find((p) => p.id === task.assigned_to)?.name || task.responsible || '-';
        const creatorName = allProfiles.find((p) => p.id === task.created_by)?.name || '-';
        const deadline = task.deadline || '-';
        const completedAt = task.completed_at ? new Date(task.completed_at).toLocaleDateString('pt-BR') : '-';

        const isEven = Math.floor((PAGE_H - y) / ROW_H) % 2 === 0;
        page.drawRectangle({
          x: MARGIN,
          y: y - ROW_H + 2,
          width: TABLE_W,
          height: ROW_H,
          color: isEven ? colorLight : colorWhite,
        });

        let cx = MARGIN + 4;
        const values = [
          truncate(task.title || '-', 38),
          truncate(responsibleName, 24),
          truncate(creatorName, 24),
          deadline,
          completedAt,
        ];
        values.forEach((value, index) => {
          page.drawText(value, { x: cx, y: y - 11, size: 7.5, font: fontRegular, color: colorDark });
          cx += columns[index].width;
        });

        y -= ROW_H;
      });

      addStandardFooters(pdfDoc, { regular: fontRegular, bold: fontBold });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `relatorio-tarefas-concluidas-${reportStartDate}-a-${reportEndDate}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || 'Nao foi possivel gerar o relatorio de tarefas concluidas.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <PageHeader
        title="Tarefas"
        subtitle="Acompanhe prioridades, prazos e cada próximo passo."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isManager && (
              <>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => setReportStartDate(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-surface-50 rounded-lg border border-surface-200 text-text-primary"
                  aria-label="Data inicial do relatório"
                />
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => setReportEndDate(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-surface-50 rounded-lg border border-surface-200 text-text-primary"
                  aria-label="Data final do relatório"
                />
                <RoundedButton size="sm" variant="outline" onClick={downloadCompletedTasksReport} disabled={isExporting || !reportStartDate || !reportEndDate || reportStartDate > reportEndDate} className="flex items-center gap-1">
                  {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />}
                  {isExporting ? 'Gerando...' : 'Baixar Relatório'}
                </RoundedButton>
              </>
            )}
            <div className="relative flex items-center gap-2" ref={filterRef}>
              <RoundedButton
                size="sm"
                variant="outline"
                onClick={() => setShowFilters((p) => !p)}
                className={`flex items-center gap-1.5 ${showFilters || activeFiltersCount > 0 ? 'border-primary-500 text-primary-400' : ''}`}
              >
                <Filter size={14} />
                Filtrar
                {activeFiltersCount > 0 && (
                  <span className="ml-0.5 min-w-4 h-4 px-1 bg-primary-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {activeFiltersCount}
                  </span>
                )}
              </RoundedButton>
              <RoundedButton size="sm" onClick={() => handleOpenModal()} className="flex items-center gap-1 rounded-full">
                <Plus size={16} /> Nova tarefa
              </RoundedButton>
              {showFilters && (
                <div className="absolute right-0 top-full mt-2 z-30 w-[min(18rem,calc(100vw-2rem))] max-w-full bg-card-bg border border-surface-200 rounded-2xl shadow-xl p-3 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-text-primary">Filtros</span>
                    {activeFiltersCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterStatus('Todas');
                          setFilterResponsible('');
                          setFilterPeriod('Todos');
                          setCardFilter('Todos');
                        }}
                        className="text-[11px] text-red-500 hover:underline flex items-center gap-1"
                      >
                        <X size={12} /> Limpar
                      </button>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">Status</p>
                    <select
                      value={cardFilter === 'Arquivadas' ? filterStatus : (cardFilter === 'Todos' ? filterStatus : cardFilter)}
                      onChange={(e) => {
                        const value = e.target.value;
                        setFilterStatus(value);
                        setCardFilter(value === 'Todas' ? 'Todos' : value as CardFilter);
                      }}
                      className="w-full py-2 px-3 bg-surface-50 rounded-xl border border-surface-200 text-sm text-text-primary appearance-none"
                    >
                      <option value="Todas">Todas</option>
                      <option value="Pendente">Pendente</option>
                      <option value="Em Andamento">Em Andamento</option>
                      <option value="Concluída">Concluída</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">Responsável</p>
                    <SearchableSelect
                      value={filterResponsible}
                      onChange={setFilterResponsible}
                      options={responsibleOptions}
                      placeholder="Todos os responsáveis"
                      searchPlaceholder="Buscar responsável..."
                    />
                  </div>
                  <div>
                    <p className="text-xs text-text-secondary mb-1.5">Período do prazo</p>
                    <select
                      value={filterPeriod}
                      onChange={(e) => setFilterPeriod(e.target.value as DeadlinePeriod)}
                      className="w-full py-2 px-3 bg-surface-50 rounded-xl border border-surface-200 text-sm text-text-primary appearance-none"
                    >
                      <option value="Todos">Todos</option>
                      <option value="Vencidas">Vencidas</option>
                      <option value="Hoje">Hoje</option>
                      <option value="Esta semana">Esta semana</option>
                      <option value="Este mês">Este mês</option>
                      <option value="Sem prazo">Sem prazo</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        }
      />

      <ScrollTabBar
        className="mb-6 md:hidden"
        trackClassName="gap-2"
        prevLabel="Cards anteriores"
        nextLabel="Próximos cards"
        scrollStep={120}
      >
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const selected = cardFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => selectCard(card.id)}
              className={`w-[calc((100%-0.5rem)/2)] min-w-0 shrink-0 text-left bg-card-bg rounded-2xl border p-3 transition-all ${
                selected
                  ? 'border-primary-500 ring-2 ring-primary-500/40'
                  : 'border-surface-200 hover:border-primary-500/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{card.label}</p>
                <span className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${card.iconClass}`}>
                  <Icon size={13} />
                </span>
              </div>
              <p className="font-ui text-xl font-semibold text-text-primary mt-2">{card.value}</p>
            </button>
          );
        })}
      </ScrollTabBar>
      <div className="hidden md:flex gap-3 mb-6">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const selected = cardFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => selectCard(card.id)}
              className={`min-w-[148px] flex-1 text-left bg-card-bg rounded-2xl border p-4 transition-all ${
                selected
                  ? 'border-primary-500 ring-2 ring-primary-500/40'
                  : 'border-surface-200 hover:border-primary-500/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{card.label}</p>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${card.iconClass}`}>
                  <Icon size={15} />
                </span>
              </div>
              <p className="font-ui text-2xl font-semibold text-text-primary mt-3">{card.value}</p>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={32} className="animate-spin text-gold-400" /></div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center py-10 text-text-secondary">
            <p>Nenhuma tarefa encontrada.</p>
            <RoundedButton variant="outline" size="sm" className="mt-4 mx-auto" onClick={() => handleOpenModal()}>Criar Tarefa</RoundedButton>
          </div>
        ) : (
          filteredTasks.map((task) => (
            <PremiumCard key={task.id} className={`flex flex-col gap-3 p-4 transition-all ${task.status === 'Concluída' || isArchived(task) ? 'opacity-70 bg-surface-50' : ''}`}>
              <div className="flex items-start gap-3">
                <button onClick={() => toggleComplete(task)}
                  className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${task.status === 'Concluída' ? 'bg-green-500 border-green-500 text-white' : 'border-surface-300 text-transparent hover:border-gold-400'}`}>
                  <CheckCircle2 size={12} strokeWidth={3} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <h4 className={`font-medium text-text-primary truncate ${task.status === 'Concluída' ? 'line-through text-text-secondary' : ''}`}>{task.title}</h4>
                    <StatusBadge status={task.status} className="text-[10px] px-2 py-0.5 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    {task.responsible && (
                      <div className="flex items-center gap-1 text-xs text-text-secondary"><User size={12} /> {task.responsible}</div>
                    )}
                    {task.assigned_to && (
                      <div className="flex items-center gap-1 text-xs text-text-secondary"><User size={12} /> {allProfiles.find((p) => p.id === task.assigned_to)?.name || 'Responsável'}</div>
                    )}
                    {task.deadline && (
                      <div className="flex items-center gap-1 text-xs font-medium text-text-secondary"><Calendar size={12} /> {formatDeadline(task.deadline)}</div>
                    )}
                  </div>
                  {task.subtasks && task.subtasks.length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gold-500 rounded-full transition-all duration-500"
                            style={{ width: `${(task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-text-secondary font-medium whitespace-nowrap">
                          {task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
                        </span>
                      </div>
                      <div className="space-y-1 pl-1">
                        {task.subtasks.map(subtask => (
                          <button key={subtask.id} onClick={() => toggleSubtaskCompletion(task, subtask.id)}
                            className="flex items-center gap-2 w-full text-left group">
                            <div className={`w-2 h-2 rounded-full border flex-shrink-0 transition-colors ${subtask.completed ? 'bg-gold-500 border-gold-500' : 'border-surface-300 group-hover:border-gold-400'}`} />
                            <span className={`text-xs truncate transition-colors ${subtask.completed ? 'text-text-secondary line-through' : 'text-text-primary group-hover:text-gold-600'}`}>{subtask.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-surface-100">
                {isArchived(task) ? (
                  <button onClick={() => handleUnarchive(task)} className="text-xs font-medium text-text-secondary hover:text-gold-600 flex items-center gap-1"><ArchiveRestore size={12} /> Desarquivar</button>
                ) : (
                  <button onClick={() => handleArchive(task)} className="text-xs font-medium text-text-secondary hover:text-gold-600 flex items-center gap-1"><Archive size={12} /> Arquivar</button>
                )}
                <button onClick={() => handleOpenModal(task)} className="text-xs font-medium text-text-secondary hover:text-gold-600 flex items-center gap-1"><Edit2 size={12} /> Editar</button>
                <button onClick={() => handleDelete(task.id)} className="text-xs font-medium text-text-secondary hover:text-red-500 flex items-center gap-1"><Trash2 size={12} /> Excluir</button>
              </div>
            </PremiumCard>
          ))
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
            <input value={formData.title || ''} onChange={(e) => setFormData(p => ({ ...p, title: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" placeholder="Ex: Enviar contrato" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Responsável</label>
            {canDelegate ? (
              <SearchableSelect
                value={assignableBrokers.find((p) => p.id === formData.assigned_to)?.name || allProfiles.find((p) => p.id === formData.assigned_to)?.name || ''}
                onChange={(name) => {
                  const selected = assignableBrokers.find((p) => p.name === name);
                  setFormData((p) => ({ ...p, assigned_to: selected?.id, responsible: selected?.name || name }));
                }}
                options={assignableBrokers.map((p) => p.name).filter((n): n is string => Boolean(n))}
                placeholder="Selecione o responsável"
                searchPlaceholder="Buscar responsável…"
                allowClear={false}
              />
            ) : (
              <input value={formData.responsible || profile?.name || ''} onChange={(e) => setFormData(p => ({ ...p, responsible: e.target.value }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" placeholder="Nome do responsável" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Prazo</label>
            <input type="date" value={formData.deadline || ''} onChange={(e) => setFormData(p => ({ ...p, deadline: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            <div className="flex gap-2">
              {(['Pendente', 'Em Andamento', 'Concluída'] as const).map(status => (
                <button key={status} type="button" onClick={() => setFormData(p => ({ ...p, status }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${formData.status === status ? 'bg-gold-50 border-gold-400 text-gold-700 dark:bg-gold-900/20 dark:text-gold-400' : 'bg-surface-50 border-surface-200 text-text-secondary'}`}>
                  {status}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Subtarefas</label>
            <div className="space-y-2 mb-2">
              {formData.subtasks?.map(subtask => (
                <div key={subtask.id} className="flex items-center gap-2 bg-surface-50 p-2 rounded-lg">
                  <span className={`flex-1 text-sm ${subtask.completed ? 'line-through text-text-secondary' : 'text-text-primary'}`}>{subtask.title}</span>
                  <button type="button" onClick={() => removeSubtask(subtask.id)} className="text-text-secondary hover:text-red-500"><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newSubtaskTitle} onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } }}
                className="flex-1 p-2 bg-surface-50 rounded-lg border-none text-sm text-text-primary focus:ring-2 focus:ring-gold-200"
                placeholder="Nova subtarefa..." />
              <button type="button" onClick={addSubtask} className="p-2 bg-gold-500 text-white rounded-lg hover:bg-gold-600"><Plus size={18} /></button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição (Opcional)</label>
            <textarea value={formData.description || ''} onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary min-h-[80px]" placeholder="Detalhes da tarefa..." />
          </div>
          <RoundedButton fullWidth onClick={handleSave} disabled={isSaving} className="mt-4">
            {isSaving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : editingTask ? 'Salvar Alterações' : 'Criar Tarefa'}
          </RoundedButton>
        </div>
      </Modal>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
