import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useIncomeAnalysisPersistence, type IncomeSessionData } from '@/hooks/useIncomeAnalysisPersistence';
import { PremiumCard, RoundedButton, PageHeader } from '@/components/ui/PremiumComponents';
import {
  UploadCloud, CheckCircle2, AlertTriangle, FileText,
  RefreshCw, Download, ChevronRight, Loader2, XCircle,
  ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { loadLogoDataUrl, drawJsHeader, drawJsSection, addJsFooters, JS_INK } from '@/lib/pdf/jsPdfKit';
import { Modal } from '@/components/ui/Modal';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { logAuditEvent } from '@/services/auditLogger';
import { supabase } from '@/lib/supabase';
import { parseApiResponse } from '@/lib/http/parseApiResponse';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ClassTag = 'aposta' | 'washtrading' | 'customizado' | null;

interface TransacaoDetalhada {
  id: string;
  data: string;
  mes: string;
  descricao: string;
  valor: number;  // centavos
  classificacao: string;
  is_validated: boolean;
  custom_tag: ClassTag;
  motivoExclusao?: string;
}

interface ResultadoApuracao {
  algoritmoVersao: string;
  totalApurado: number;
  mediaMensalReal: number;
  divisao6Meses: number;
  divisao12Meses: number;
  maiorMes: number;
  menorMes: number;
  mesesConsiderados: number;
  totalPorMes: Record<string, number>;
  transacoesConsideradas: number;
  transacoesIgnoradas: number;
  transacoesDetalhadas: TransacaoDetalhada[];
  criteriosAplicados: {
    excluiuAutoTransferencia: boolean;
    excluiuTransferenciaPais: boolean;
    excluiuApostas: boolean;
    excluiuWashTrading: boolean;
    modoConservadorInteligente: boolean;
    customKeywordsUsadas: string[];
  };
  auditoria: { hashPdf: string; timestamp: string };
  avisos: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const brl = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100);

const API_URL = '/api/apuracao';
const MAX_WORKERS = 4;
const CALCULABLE_CLASSIFICATIONS = new Set([
  'credito_valido', 'possivel_vinculo_familiar', 'possivel_renda_familiar', 'ignorar_aposta', 'ignorar_autotransferencia',
]);

const isCalculableTransacao = (t: TransacaoDetalhada) =>
  t.valor > 0 && CALCULABLE_CLASSIFICATIONS.has(t.classificacao);

const isResumoLinha = (descricao: string) => {
  const d = descricao
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  return /^TOTAL\b/.test(d)
    || /^SUBTOTAL\b/.test(d)
    || /\bMOVIMENTACAO(?:ES)?\s+DO\s+MES\b/.test(d)
    || /\bTOTAL\s+MOVIMENTACAO(?:ES)?\b/.test(d);
};

const TAG_CONFIG: Record<NonNullable<ClassTag>, { label: string; color: string; icon: string }> = {
  aposta: { label: '🚫 Aposta', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: '🚫' },
  washtrading: { label: '🔄 Passagem', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: '🔄' },
  customizado: { label: '✅ Keyword Custom', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: '✅' },
};

// ─── OCR Paralelo com Web Workers ─────────────────────────────────────────────

async function ocrParalelo(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  onProgress: (msg: string) => void,
): Promise<string> {
  onProgress(`PDF escaneado — iniciando OCR paralelo (${pdf.numPages} pág.)…`);

  // Renderiza todas as páginas como ImageData (main thread, pdfjs precisa do DOM)
  const pageDataList: { imageData: ImageData; width: number; height: number; pageNum: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Renderizando página ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pageDataList.push({
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width, height: canvas.height, pageNum: i,
    });
  }

  // Processa até MAX_WORKERS páginas em paralelo
  const resultados: Record<number, string> = {};
  onProgress(`OCR em progresso (${Math.min(pdf.numPages, MAX_WORKERS)} workers paralelos)…`);

  // Processa em lotes de MAX_WORKERS
  for (let base = 0; base < pageDataList.length; base += MAX_WORKERS) {
    const lote = pageDataList.slice(base, base + MAX_WORKERS);
    await Promise.all(lote.map(({ imageData, width, height, pageNum }) =>
      new Promise<void>((resolve) => {
        // Importa o worker via URL estática — compatível com Vite bundler
        const worker = new Worker(
          new URL('../workers/tesseractWorker.ts', import.meta.url),
          { type: 'module' }
        );
        worker.onmessage = (e: MessageEvent<{ pageNum: number; text: string }>) => {
          resultados[e.data.pageNum] = e.data.text;
          worker.terminate();
          resolve();
        };
        worker.onerror = () => { resultados[pageNum] = ''; worker.terminate(); resolve(); };
        worker.postMessage({ imageData, width, height, pageNum }, [imageData.data.buffer]);
      })
    ));
    onProgress(`OCR: ${Math.min(base + MAX_WORKERS, pdf.numPages)}/${pdf.numPages} páginas concluídas…`);
  }

  return Object.keys(resultados)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => resultados[Number(k)])
    .join('\n');
}

// ─── Extração de Texto com Detecção de Colunas ───────────────────────────────

async function extrairTextoPdf(
  file: File,
  onProgress?: (msg: string) => void,
): Promise<{ texto: string; hashPdf: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashPdf = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const CMAP_URL = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`;
  const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`;

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer, cMapUrl: CMAP_URL, cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL, useSystemFonts: true,
  }).promise;

  const paginas: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i);
    const content = await pagina.getTextContent();
    const viewport = pagina.getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;

    // ── Reconstrução baseada em Y (Linhas Tabulares) ──────────────────────────
    // PDFs de bancos são tabelas. A abordagem correta é mapear todos os itens por
    // sua coordenada Y (com pequena tolerância) e ordená-los da esquerda para a direita (X).
    const Y_TOLERANCE = 5;
    const linesMap = new Map<number, any[]>();

    for (const item of content.items) {
      const textItem = item as { str: string; transform: number[] };
      if (!textItem.str.trim()) continue;

      const y = Math.round(textItem.transform[5]);
      let matchedY = y;

      for (const key of linesMap.keys()) {
        if (Math.abs(key - y) <= Y_TOLERANCE) {
          matchedY = key;
          break;
        }
      }

      if (!linesMap.has(matchedY)) linesMap.set(matchedY, []);
      linesMap.get(matchedY)!.push(textItem);
    }

    const sortedYs = Array.from(linesMap.keys()).sort((a, b) => b - a); // Coordenadas Y no PDF são de baixo pra cima
    const linhas: string[] = [];

    for (const y of sortedYs) {
      const lineItems = linesMap.get(y)!;
      lineItems.sort((a, b) => a.transform[4] - b.transform[4]); // Ordena por X (esq -> dir)
      linhas.push(lineItems.map(it => it.str.trim()).join(' '));
    }

    paginas.push(linhas.join('\n'));
  }

  let texto = paginas.join('\n');

  // OCR paralelo se o PDF for escaneado
  if (!texto.trim() && onProgress) {
    texto = await ocrParalelo(pdf, onProgress);
  }

  return { texto, hashPdf };
}

// ─── Componente AccordionMes ──────────────────────────────────────────────────

function AccordionMes({
  mes, total, transacoes, validadas, onToggle, mesDesconsiderado, onToggleMes,
}: {
  mes: string;
  total: number;
  transacoes: TransacaoDetalhada[];
  validadas: Set<string>;
  onToggle: (id: string) => void;
  mesDesconsiderado: boolean;
  onToggleMes: (mes: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const alertCount = transacoes.filter(t => t.custom_tag).length;
  const totalAtivo = transacoes
    .filter(t => validadas.has(t.id))
    .reduce((acc, t) => acc + t.valor, 0);

  return (
    <div className={`rounded-2xl overflow-hidden border shadow-sm ${mesDesconsiderado ? 'border-red-200 bg-red-50/40 dark:bg-red-900/10' : 'border-surface-100 bg-card-bg dark:bg-surface-100'}`}>
      {/* Header */}
      <div className={`w-full flex items-center justify-between p-4 transition-colors ${mesDesconsiderado ? 'hover:bg-danger-subtle dark:hover:bg-red-900/20' : 'hover:bg-surface-100'}`}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAberto(!aberto)}
            className="font-semibold text-text-primary text-sm"
          >
            {mes}
          </button>
          {mesDesconsiderado && (
            <span className="text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
              mês desconsiderado
            </span>
          )}
          {alertCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 bg-red-600 text-white rounded-full font-bold">
              {alertCount} alerta{alertCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMes(mes);
            }}
            className="w-6 h-6 flex items-center justify-center text-gold-500 hover:text-gold-700 transition-colors rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
            title={mesDesconsiderado ? 'Reconsiderar mês no cálculo' : 'Desconsiderar mês no cálculo'}
          >
            {mesDesconsiderado
              ? <ToggleLeft size={22} className="text-surface-400" />
              : <ToggleRight size={22} className="text-green-500" />}
          </button>
          <span className="w-[110px] text-right font-mono font-bold text-text-primary text-sm">{brl(totalAtivo)}</span>
          <button type="button" onClick={() => setAberto(!aberto)} className="text-text-secondary">
            {aberto ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />}
          </button>
        </div>
      </div>

      {/* Body */}
      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-surface-100">
              {transacoes.map(t => {
                const ativa = validadas.has(t.id);
                const tagCfg = t.custom_tag ? TAG_CONFIG[t.custom_tag] : null;
                const canToggle = isCalculableTransacao(t);
                const statusBadge = t.classificacao === 'debito'
                  ? { label: 'Debito', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
                  : (t.classificacao === 'ignorar_estorno' || t.classificacao === 'ignorar_sem_keyword')
                    ? { label: 'Ignorado', color: 'bg-surface-200 text-surface-700 dark:bg-surface-300 dark:text-text-secondary' }
                    : null;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between px-4 py-2.5 border-b border-surface-200 last:border-0 transition-all ${ativa ? 'bg-surface-100' : 'opacity-45'
                      }`}
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <button
                        onClick={() => canToggle && onToggle(t.id)}
                        disabled={!canToggle}
                        className="flex-shrink-0 text-gold-500 hover:text-gold-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={canToggle ? (ativa ? 'Excluir do cálculo' : 'Incluir no cálculo') : 'Movimentação informativa (não entra no cálculo)'}
                      >
                        {ativa
                          ? <ToggleRight size={22} className="text-green-500" />
                          : <ToggleLeft size={22} className="text-surface-400" />}
                      </button>
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs text-text-primary leading-relaxed break-words">{t.descricao}</p>
                        <p className="text-[10px] text-text-secondary mt-0.5">{t.data}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {tagCfg && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${tagCfg.color}`}>
                          {tagCfg.label}
                        </span>
                      )}
                      {statusBadge && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge.color}`}>
                          {statusBadge.label}
                        </span>
                      )}
                      <span className={`font-mono text-xs font-medium ${t.classificacao === 'debito' || t.valor < 0 ? 'text-red-400' : (ativa ? 'text-emerald-400' : 'text-surface-400')}`}>
                        {brl(t.valor)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function IncomeAnalysis() {
  const { clients, updateClient, user } = useApp();
  const { isAnalyst } = useAuthorization();

  // Form state
  const [nomeCliente, setNomeCliente] = useState('');
  const [cpf, setCpf] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [clienteVinculado, setClienteVinculado] = useState<string>('');

  // UX state
  const [step, setStep] = useState<1 | 2>(1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoApuracao | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showValidationBanner, setShowValidationBanner] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Filtros Dinâmicos (Bolhas) e Overrides ─────────────────────────────────
  const [exclusionBubbles, setExclusionBubbles] = useState<string[]>([]);
  const [excludedMonths, setExcludedMonths] = useState<string[]>([]);
  const [bubbleInput, setBubbleInput] = useState('');
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean>>({});

  // ── Sessão persistente (IndexedDB) ─────────────────────────────────────────
  const [restoreModal, setRestoreModal] = useState<{ data: IncomeSessionData } | null>(null);

  const applyRestore = useCallback((data: IncomeSessionData) => {
    setNomeCliente(data.nomeCliente);
    setCpf(data.cpf);
    setClienteVinculado(data.clienteVinculado);
    setStep(data.step);
    setResultado(data.resultado as ResultadoApuracao | null);
    setExclusionBubbles(data.exclusionBubbles);
    setExcludedMonths(data.excludedMonths || []);
    setUserOverrides(data.userOverrides);
  }, []);

  const { save: persistSave, clear: persistClear } = useIncomeAnalysisPersistence({
    onRestore: applyRestore,
    onRestoreConfirmNeeded: (data) => setRestoreModal({ data }),
  });

  // Auto-save whenever key state changes
  useEffect(() => {
    persistSave({ nomeCliente, cpf, clienteVinculado, step, resultado, exclusionBubbles, excludedMonths, userOverrides });
  }, [nomeCliente, cpf, clienteVinculado, step, resultado, exclusionBubbles, excludedMonths, userOverrides, persistSave]);

  const validadas = useMemo(() => {
    if (!resultado) return new Set<string>();
    const ativas = new Set<string>();

    // Helper para matching mais inteligente (ignora acentos e ajuda com nomes truncados)
    const normalize = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    for (const t of resultado.transacoesDetalhadas) {
      if (!isCalculableTransacao(t)) continue;

      let isAtiva = t.is_validated;
      const descNorm = normalize(t.descricao);

      if (excludedMonths.includes(t.mes)) {
        isAtiva = false;
      }

      // Verificação das bolhas
      const hasBubble = exclusionBubbles.some(b => {
        const bubbleNorm = normalize(b.trim());
        if (descNorm.includes(bubbleNorm)) return true;

        // Se a bolha for um nome completo, mas o banco truncou o final do nome (ex: Thalita Barros Bel...)
        // Tentamos garantir o match se os 2 primeiros nomes baterem exatamente.
        const words = bubbleNorm.split(/\s+/).filter(w => w.length > 2);
        if (words.length >= 2) {
          const firstTwoNames = `${words[0]} ${words[1]}`;
          if (descNorm.includes(firstTwoNames)) return true;
        }
        return false;
      });

      if (hasBubble) {
        isAtiva = false;
      }

      if (userOverrides[t.id] !== undefined) {
        isAtiva = userOverrides[t.id];
      }

      if (isAtiva) ativas.add(t.id);
    }
    return ativas;
  }, [resultado, exclusionBubbles, excludedMonths, userOverrides]);

  const toggleMesDesconsiderado = useCallback((mes: string) => {
    setExcludedMonths(prev => prev.includes(mes)
      ? prev.filter(m => m !== mes)
      : [...prev, mes]);
  }, []);

  const toggleValidada = useCallback((id: string) => {
    setUserOverrides(prev => {
      const current = validadas.has(id);
      return { ...prev, [id]: !current };
    });
  }, [validadas]);

  // ── Recálculo reativo baseado nos toggles ──────────────────────────────────
  const { totalPorMesAtivo, totalApuradoAtivo, mediaMensalAtiva, maiorMesAtivo, menorMesAtivo, mesesAtivos } = useMemo(() => {
    if (!resultado) return { totalPorMesAtivo: {}, totalApuradoAtivo: 0, mediaMensalAtiva: 0, maiorMesAtivo: 0, menorMesAtivo: 0, mesesAtivos: 0 };

    const mesesBase = (() => {
      const doBackend = Object.keys(resultado.totalPorMes ?? {})
        .filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m))
        .sort((a, b) => a.localeCompare(b));
      if (doBackend.length > 0) return doBackend;

      const detectados = new Set<string>();
      for (const t of resultado.transacoesDetalhadas) {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(t.mes)) detectados.add(t.mes);
      }
      return Array.from(detectados).sort((a, b) => a.localeCompare(b));
    })();

    const porMes: Record<string, number> = {};
    for (const mes of mesesBase) porMes[mes] = 0;
    const mesesExcluidosSet = new Set(excludedMonths);

    for (const t of resultado.transacoesDetalhadas) {
      if (mesesExcluidosSet.has(t.mes)) continue;
      if (t.valor > 0 && validadas.has(t.id)) {
        if (!(t.mes in porMes) && /^\d{4}-(0[1-9]|1[0-2])$/.test(t.mes)) porMes[t.mes] = 0;
        porMes[t.mes] = (porMes[t.mes] ?? 0) + t.valor;
      }
    }

    const vals = Object.values(porMes);
    const total = vals.reduce((a, b) => a + b, 0);
    const meses = Object.keys(porMes).filter(m => !mesesExcluidosSet.has(m)).length;
    return {
      totalPorMesAtivo: porMes,
      totalApuradoAtivo: total,
      mediaMensalAtiva: meses > 0 ? Math.round(total / meses) : 0,
      maiorMesAtivo: vals.length ? Math.max(...vals) : 0,
      menorMesAtivo: vals.length ? Math.min(...vals) : 0,
      mesesAtivos: meses,
    };
  }, [resultado, validadas, excludedMonths]);

  // ── Agrupa transações válidas por mês para o Accordion ────────────────────
  const transacoesPorMes = useMemo(() => {
    if (!resultado) return {};
    const grupos: Record<string, TransacaoDetalhada[]> = {};

    for (const mes of Object.keys(totalPorMesAtivo)) {
      grupos[mes] = [];
    }

    for (const t of resultado.transacoesDetalhadas) {
      if (!/^\d{4}-\d{2}$/.test(t.mes)) continue;
      if (isResumoLinha(t.descricao)) continue;
      // Oculta rendimentos, investimentos e ruído — não são transações relevantes para auditoria
      if (t.classificacao === 'ignorar_estorno' || t.classificacao === 'ignorar_sem_keyword') continue;
      if (!grupos[t.mes]) grupos[t.mes] = [];
      grupos[t.mes].push(t);
    }
    return grupos;
  }, [resultado, totalPorMesAtivo]);

  // ── CPF mask ──────────────────────────────────────────────────────────────
  const handleCpf = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    const masked = d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
    setCpf(masked);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type === 'application/pdf');
    if (files.length === 0) { setErro('Apenas arquivos PDF são aceitos.'); }
    else { setArquivos(files); setErro(null); }
  };

  const handleAnalyze = async () => {
    if (!nomeCliente.trim()) { setErro('Informe o nome completo do cliente.'); return; }
    if (arquivos.length === 0) { setErro('Selecione pelo menos um arquivo PDF.'); return; }

    setErro(null);
    setIsAnalyzing(true);
    setStatusMsg('');

    try {
      // Extrai e unifica texto de todos os PDFs
      let textoUnificado = '';
      let hashPdfPrimeiro = '';
      for (let i = 0; i < arquivos.length; i++) {
        const arq = arquivos[i];
        setStatusMsg(`Lendo PDF ${i + 1}/${arquivos.length}: ${arq.name}…`);
        const { texto, hashPdf } = await extrairTextoPdf(arq, setStatusMsg);
        if (!texto.trim()) throw new Error(`Não foi possível extrair texto de "${arq.name}". Pode estar corrompido ou protegido.`);
        textoUnificado += '\n' + texto;
        if (i === 0) hashPdfPrimeiro = hashPdf;
      }

      setStatusMsg('Analisando transações…');

      const { data: { session: incomeSession } } = await supabase.auth.getSession();
      if (!incomeSession?.access_token) {
        setErro('Sessão expirada. Faça login novamente.');
        return;
      }

      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${incomeSession.access_token}`,
        },
        body: JSON.stringify({
          textoExtrato: textoUnificado.trim(),
          hashPdf: hashPdfPrimeiro,
          nomeCliente, cpf: cpf || undefined,
        }),
      });

      const json = await parseApiResponse<{ erro?: string } & Partial<ResultadoApuracao>>(resp);
      if (!resp.ok) {
        // DEBUG — mostra debug do servidor no console
        console.error('[apuracao] erro 422 — resposta completa:', json);
        setErro(json.erro ?? `Erro ${resp.status}`);
        return;
      }

      const res = json as ResultadoApuracao;
      setResultado(res);

      // Limpa os overrides antigos e bolhas ao reanalisar (opcional)
      setUserOverrides({});
      setStep(2);
    } catch (e) {
      setErro(`Falha ao processar: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
    } finally {
      setIsAnalyzing(false);
      setStatusMsg('');
    }
  };

  const handleNovaAnalise = () => {
    setStep(1); setResultado(null); setErro(null);
    setArquivos([]); setUserOverrides({}); setExclusionBubbles([]); setExcludedMonths([]);
    if (fileRef.current) fileRef.current.value = '';
    persistClear();
  };

  const gerarPdfApuracao = useCallback(async () => {
    if (!resultado) throw new Error('Nenhum resultado disponível para gerar PDF.');

    const doc = new jsPDF();
    const logo = await loadLogoDataUrl();
    const rendaMensalRegra = Math.round(totalApuradoAtivo / 6);
    const fmt = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const nomeTitular = nomeCliente || (clienteVinculado ? clients.find(c => c.id === clienteVinculado)?.name : 'Não informado');

    let y = drawJsHeader(doc, { title: 'Apuração de Renda', subtitle: `Titular: ${nomeTitular}` , logo });

    const checkPage = (add = 6) => {
      if (y + add > 278) {
        doc.addPage();
        y = 20;
      }
    };

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...JS_INK);
    doc.text(`Documento (CPF): ${cpf || (clienteVinculado ? clients.find(c => c.id === clienteVinculado)?.cpf : 'N/A')}`, 14, y); y += 6;
    doc.text(`Versão do algoritmo: ${resultado.algoritmoVersao}`, 14, y);
    y += 10;

    y = drawJsSection(doc, y, 'Resumo (após revisão manual)');
    doc.text(`Renda Media Mensal (Total ÷ 6): R$ ${fmt(rendaMensalRegra)}`, 14, y); y += 8;
    doc.text(`Total Apurado: R$ ${fmt(totalApuradoAtivo)}`, 14, y); y += 8;
    doc.text(`Creditos Ativos: ${validadas.size}`, 14, y); y += 8;
    doc.text(`Maior Mes: R$ ${fmt(maiorMesAtivo)}`, 14, y); y += 8;
    doc.text(`Menor Mes: R$ ${fmt(menorMesAtivo)}`, 14, y); y += 8;
    doc.text(`Meses Considerados: ${mesesAtivos}`, 14, y);
    y += 12;

    if (excludedMonths.length > 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`Meses desconsiderados: ${[...excludedMonths].sort().join(', ')}`, 14, y);
      y += 10;
      doc.setFont('helvetica', 'normal');
    }

    if (exclusionBubbles.length > 0) {
      y = drawJsSection(doc, y, 'Bolhas de exclusão (filtro dinâmico)');
      doc.setFontSize(9);
      const bolhasTexto = exclusionBubbles.join(', ');
      const linhasBolhas = doc.splitTextToSize(bolhasTexto, 180);
      linhasBolhas.forEach((linha: string) => {
        checkPage(6);
        doc.text(linha, 14, y);
        y += 5;
      });
      y += 4;
    }

    y = drawJsSection(doc, y, 'Detalhamento mensal');
    Object.entries(totalPorMesAtivo)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([mes, valor]) => {
        checkPage();
        const marcado = excludedMonths.includes(mes) ? ' (DESCONSIDERADO)' : '';
        doc.text(`${mes}${marcado} .................... R$ ${fmt(valor)}`, 14, y);
        y += 8;
      });

    y += 4;
    checkPage();
    doc.text(`Timestamp: ${new Date(resultado.auditoria.timestamp).toLocaleString('pt-BR')}`, 14, y);
    y += 12;

    checkPage(15);
    y = drawJsSection(doc, y, 'Entradas consideradas nos respectivos meses');

    const transacoesPorMesPdf: Record<string, typeof resultado.transacoesDetalhadas> = {};
    resultado.transacoesDetalhadas.forEach(t => {
      if (excludedMonths.includes(t.mes)) return;
      if (t.valor > 0 && validadas.has(t.id)) {
        if (!transacoesPorMesPdf[t.mes]) transacoesPorMesPdf[t.mes] = [];
        transacoesPorMesPdf[t.mes].push(t);
      }
    });

    Object.keys(transacoesPorMesPdf).sort().forEach(mes => {
      checkPage(15);
      doc.setFont('helvetica', 'bold');
      doc.text(mes, 14, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      transacoesPorMesPdf[mes].forEach(t => {
        checkPage(8);
        let desc = t.descricao;
        if (desc.length > 80) desc = desc.substring(0, 77) + '...';
        doc.text(`- ${t.data} | R$ ${fmt(t.valor)} | ${desc}`, 14, y);
        y += 5;
      });

      doc.setFontSize(10);
      y += 4;
    });

    addJsFooters(doc);
    const fileName = `apuracao_renda_${Date.now()}.pdf`;
    const pdfBlob = doc.output('blob');
    return { pdfBlob, fileName };
  }, [resultado, totalApuradoAtivo, nomeCliente, clienteVinculado, clients, cpf, validadas, maiorMesAtivo, menorMesAtivo, mesesAtivos, exclusionBubbles, excludedMonths, totalPorMesAtivo]);

  const handleBaixarRelatorio = async () => {
    if (!resultado) return;
    setIsDownloading(true);
    try {
      const { pdfBlob, fileName } = await gerarPdfApuracao();
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logAuditEvent({
        action: 'document_downloaded',
        entity: 'income_report',
        entityId: clienteVinculado || undefined,
        userId: user?.id || null,
        metadata: { origin: 'income_analysis', fileName }
      });
    } catch (e) {
      alert(`Erro ao baixar relatório: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFinalizar = async () => {
    if (!resultado) return;
    if (isAnalyst) return;
    setIsSaving(true);
    try {
      // Persistência no Supabase via link direto (sem edge function)
      const { supabase } = await import('@/lib/supabase');
      const auditPayload = {
        client_id: clienteVinculado || null,
        created_by: user?.id,
        algoritmo_versao: resultado.algoritmoVersao,
        hash_pdf: resultado.auditoria.hashPdf,
        media_mensal_real: mediaMensalAtiva,
        total_apurado: totalApuradoAtivo,
        meses_considerados: mesesAtivos,
        renda_multiplo: null as number | null,
          resultado_json: {
            ...resultado,
            totalPorMesAtivo,
            mediaMensalAtiva,
            validadas: [...validadas],
            exclusionBubbles,
            excludedMonths,
          },
        validado_em: new Date().toISOString(),
      };

      // Calcular múltiplo se cliente vinculado
      if (clienteVinculado) {
        const cliente = clients.find(c => c.id === clienteVinculado);
        if (cliente?.intendedValue) {
          const valorPretendido = parseFloat(
            cliente.intendedValue.replace(/[^\d,]/g, '').replace(',', '.')
          ) * 100;
          const parcelaEstimada = valorPretendido / 240; // 20 anos
          if (parcelaEstimada > 0) {
            auditPayload.renda_multiplo = Math.round((mediaMensalAtiva / parcelaEstimada) * 10) / 10;
          }
        }
      }

      // ==========================================
      // Geração do PDF
      // ==========================================
      try {
        const { pdfBlob, fileName } = await gerarPdfApuracao();
        const storagePath = clienteVinculado ? `${clienteVinculado}/${fileName}` : `general_audits/${fileName}`;

        const fileObj = new File([pdfBlob], fileName, { type: 'application/pdf' });
        const { error: uploadError } = await supabase.storage
          .from('client-documents')
          .upload(storagePath, fileObj, { contentType: 'application/pdf', upsert: false });

        if (!uploadError) {
          await supabase.from('client_documents').insert({
            client_id: clienteVinculado || null,
            name: `Apuracao de Renda - ${new Date().toLocaleString('pt-BR').split(' ')[0].replace(/\//g, '-')}.pdf`,
            type: 'Comprovante de Renda',
            url: storagePath,
            created_by: user?.id ?? null,
          });
          logAuditEvent({
            action: 'document_uploaded',
            entity: 'client_document',
            entityId: clienteVinculado || undefined,
            userId: user?.id || null,
            metadata: { storagePath, origin: 'income_analysis' }
          });
        } else {
          console.error('Erro ao fazer upload do PDF da apuração:', uploadError);
        }
      } catch (pdfErr) {
        console.error('Erro ao gerar/salvar PDF:', pdfErr);
      }

      await supabase.from('income_audits').insert([auditPayload]);

      // Automação de funil
      if (clienteVinculado) {
        const cliente = clients.find(c => c.id === clienteVinculado);
        if (cliente?.intendedValue) {
          const valorPretendido = parseFloat(
            cliente.intendedValue.replace(/[^\d,]/g, '').replace(',', '.')
          ) * 100;
          const parcelaEstimada = valorPretendido / 240;
          const multiplo = parcelaEstimada > 0 ? mediaMensalAtiva / parcelaEstimada : 0;
          if (multiplo >= 3) {
            await updateClient(clienteVinculado, { stage: 'Aprovado' });
          } else if (multiplo >= 1.5) {
            await updateClient(clienteVinculado, { stage: 'Em Tratativa' });
          }
        }
      }

      setShowFinalModal(false);
      alert('✅ Apuração finalizada e salva com sucesso!');
    } catch (e) {
      alert(`Erro ao salvar: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
    } finally {
      setIsSaving(false);
    }
  };



  return (
    <div className="p-6 pb-28 min-h-screen bg-surface-50">

      {/* ─── Modal de restauração de sessão (>2h) ─── */}
      <Modal
        isOpen={!!restoreModal}
        onClose={() => setRestoreModal(null)}
        title="Sessão anterior encontrada"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Encontramos uma apuração em andamento de{' '}
            <span className="font-medium text-text-primary">{restoreModal?.data.nomeCliente || 'cliente não identificado'}</span>,
            salva {restoreModal ? Math.round((Date.now() - new Date(restoreModal.data.savedAt).getTime()) / 60000) : 0} minutos atrás.
            Deseja continuar de onde parou?
          </p>
          <div className="flex gap-3">
            <RoundedButton
              fullWidth
              onClick={() => { if (restoreModal) applyRestore(restoreModal.data); setRestoreModal(null); }}
            >
              Continuar sessão
            </RoundedButton>
            <button
              className="flex-1 py-2 px-4 rounded-xl text-sm font-medium text-text-secondary bg-surface-100 hover:bg-surface-200 transition-colors"
              onClick={() => { persistClear(); setRestoreModal(null); }}
            >
              Descartar
            </button>
          </div>
        </div>
      </Modal>
      <PageHeader title="Apuração de Renda" subtitle="Análise determinística de renda com revisão interativa." />

      {showValidationBanner && (
        <div className="relative mt-4 mb-4 rounded-2xl border border-red-700 bg-red-600 px-4 py-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowValidationBanner(false)}
            className="absolute right-3 top-3 rounded-lg p-1 text-white hover:bg-red-700"
            aria-label="Fechar aviso"
          >
            <XCircle size={18} />
          </button>

          <div className="flex items-start gap-3 pr-8">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-white" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Atenção — Módulo de Apuração em Validação Contínua</p>
              <p className="text-xs leading-relaxed text-red-100">
                Este módulo está em evolução técnica contínua. Em movimentações com inconsistência, baixa confiança ou dúvida operacional,
                mantenha revisão manual obrigatória antes de qualquer decisão.
              </p>
              <p className="text-xs leading-relaxed text-red-100">
                Para aceleração das melhorias, é crucial que a liderança encaminhe extratos já apurados para validação dos parsers e regras.
                Todos os arquivos enviados para teste são destruídos após as validações, com proteção dos dados dos clientes durante todo o processo.
              </p>
              <p className="text-xs leading-relaxed text-red-100">
                Para envio dos extratos, procurar <span className="font-semibold text-white">Maciel</span>. A colaboração de todos é essencial para a robustez e o sucesso da operação.
              </p>
              <p className="text-xs font-medium text-white">
                Bancos com cobertura operacional atual: Inter, Nubank, PagBank, Caixa Econômica, Itaú, Neon, Bradesco e PicPay.
              </p>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {/* ─── STEP 1: Formulário ─── */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-4">

            {/* Dados do cliente */}
            <PremiumCard className="space-y-4">
              <h3 className="text-sm font-semibold text-text-primary">Dados do Cliente</h3>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Nome Completo <span className="text-red-500">*</span></label>
                <input type="text" value={nomeCliente} onChange={e => setNomeCliente(e.target.value)}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary text-sm"
                  placeholder="Ex: João Carlos da Silva" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">CPF <span className="text-text-secondary font-normal ml-1">(opcional — melhora detecção)</span></label>
                <input type="text" value={cpf} onChange={e => handleCpf(e.target.value)}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary text-sm"
                  placeholder="000.000.000-00" />
              </div>

              {/* Vincular cliente */}
              {clients.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">Vincular ao Cliente</label>
                  <select value={clienteVinculado} onChange={e => setClienteVinculado(e.target.value)}
                    className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary text-sm">
                    <option value="">Selecionar cliente…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name} — {c.stage}</option>)}
                  </select>
                </div>
              )}
            </PremiumCard>

            {/* Upload Multi-PDF */}
            <PremiumCard
              className="border-dashed border-2 border-surface-300 flex flex-col items-center py-8 text-center cursor-pointer hover:border-gold-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple className="hidden" onChange={handleFileChange} />
              <div className="w-14 h-14 bg-card-bg rounded-full flex items-center justify-center shadow-sm mb-3">
                {arquivos.length > 0 ? <FileText className="text-green-500" size={28} /> : <UploadCloud className="text-gold-500" size={28} />}
              </div>
              {arquivos.length > 0 ? (
                <div>
                  <p className="font-medium text-green-600 text-sm">{arquivos.length} PDF{arquivos.length > 1 ? 's' : ''} selecionado{arquivos.length > 1 ? 's' : ''}</p>
                  <p className="text-xs text-text-secondary mt-1">{arquivos.map(f => f.name).join(', ').slice(0, 60)}… • clique para trocar</p>
                </div>
              ) : (
                <div>
                  <h3 className="font-medium text-text-primary text-sm">Upload de Extrato(s) (PDF)</h3>
                  <p className="text-xs text-text-secondary mt-1 max-w-[220px]">Múltiplos PDFs suportados • Itaú, Bradesco, Nubank, Inter, Mercado Pago, Caixa, BB</p>
                </div>
              )}
            </PremiumCard>

            {erro && (
              <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                <XCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-600">{erro}</p>
              </div>
            )}

            <RoundedButton fullWidth onClick={handleAnalyze} disabled={isAnalyzing} className="mt-2">
              {isAnalyzing
                ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />Processando…</span>
                : <span className="flex items-center justify-center gap-2">Iniciar Apuração <ChevronRight size={16} /></span>}
            </RoundedButton>

            {isAnalyzing && statusMsg && (
              <p className="text-center text-[11px] text-text-secondary animate-pulse">{statusMsg}</p>
            )}

            <p className="text-center text-[10px] text-text-secondary">
              Algoritmo v3 · Zero IA · OCR multi-thread · Detecção de apostas e wash trading
            </p>
          </motion.div>
        )}

        {/* ─── STEP 2: Resultado com revisão interativa ─── */}
        {step === 2 && resultado && (
          <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-5">

            {/* Avisos */}
            {resultado.avisos.length > 0 && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl flex items-start gap-2">
                <AlertTriangle size={15} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-700 dark:text-yellow-300">{resultado.avisos.join(' ')}</p>
              </div>
            )}

            {/* Card de destaque — renda mensal fixa por regra de negócio (total ÷ 6) */}
            <PremiumCard highlight className="text-center py-6">
              <p className="text-xs text-gold-700 dark:text-gold-400 font-medium uppercase tracking-wider">Renda Média Mensal (Revisada)</p>
              <h2 className="text-4xl font-bold text-text-primary mt-2">{brl(Math.round(totalApuradoAtivo / 6))}</h2>
            </PremiumCard>

            {/* Bolhas de Exclusão Interativas */}
            <PremiumCard>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Bolhas de Exclusão (Filtro Dinâmico)</h3>
              <p className="text-[11px] text-text-secondary mb-3 leading-relaxed">
                Digite nomes ou termos para desconsiderar (ex: nome de parente ou empresa) e tecle <strong>Enter</strong>. Entradas com a bolha ficarão cinzas, mas podem ser reincluídas manualmente. Algumas já são filtradas automaticamente (Apostas, Titular).
              </p>

              <div className="flex flex-wrap gap-2 mb-3">
                {exclusionBubbles.map(b => (
                  <span key={b} className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-3 py-1 rounded-lg text-xs font-medium transition-all">
                    {b}
                    <button onClick={() => setExclusionBubbles(prev => prev.filter(x => x !== b))} className="hover:text-red-900 focus:outline-none">
                      <XCircle size={14} />
                    </button>
                  </span>
                ))}
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={bubbleInput}
                  onChange={e => setBubbleInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && bubbleInput.trim()) {
                      e.preventDefault();
                      const newBubble = bubbleInput.trim().toUpperCase();
                      if (!exclusionBubbles.includes(newBubble)) {
                        setExclusionBubbles([...exclusionBubbles, newBubble]);
                      }
                      setBubbleInput('');
                    }
                  }}
                  className="w-full p-3 bg-surface-50 rounded-xl border border-surface-200 focus:ring-2 focus:ring-gold-200 text-text-primary text-sm shadow-inner"
                  placeholder="Tecle Enter para adicionar uma Tag/Bolha…"
                />
              </div>
            </PremiumCard>

            {/* Grid de métricas reativas */}
            <div className="grid grid-cols-2 gap-3">
              <PremiumCard className="text-center">
                <p className="text-xs text-text-secondary">Total Apurado</p>
                <p className="text-base font-bold text-text-primary mt-1">{brl(totalApuradoAtivo)}</p>
              </PremiumCard>
              <PremiumCard className="text-center">
                <p className="text-xs text-text-secondary">Créditos Ativos</p>
                <p className="text-base font-bold text-green-600 mt-1">{[...validadas].length}</p>
              </PremiumCard>
              <PremiumCard className="text-center">
                <p className="text-xs text-text-secondary">Maior Mês</p>
                <p className="text-base font-bold text-green-600 mt-1">{brl(maiorMesAtivo)}</p>
              </PremiumCard>
              <PremiumCard className="text-center">
                <p className="text-xs text-text-secondary">Menor Mês</p>
                <p className="text-base font-bold text-red-500 mt-1">{brl(menorMesAtivo)}</p>
              </PremiumCard>
            </div>

            {/* Accordion por mês */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary px-1 mb-3">
                Revisão por Mês
                <span className="text-xs text-text-secondary font-normal ml-2">— ative/desative cada crédito</span>
              </h3>
              <div className="space-y-2">
                {Object.entries(transacoesPorMes)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([mes, transacoes]) => (
                    <AccordionMes
                      key={mes}
                      mes={mes}
                      total={totalPorMesAtivo[mes] ?? 0}
                      transacoes={transacoes}
                      validadas={validadas}
                      onToggle={toggleValidada}
                      mesDesconsiderado={excludedMonths.includes(mes)}
                      onToggleMes={toggleMesDesconsiderado}
                    />
                  ))}
              </div>
            </div>

            {/* Critérios */}
            <PremiumCard className="space-y-2">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Critérios Aplicados v3</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  ['Autotransferências excluídas', resultado.criteriosAplicados.excluiuAutoTransferencia],
                  ['Transferências de pais excluídas', resultado.criteriosAplicados.excluiuTransferenciaPais],
                  ['Apostas/jogos excluídos', resultado.criteriosAplicados.excluiuApostas],
                  ['Wash trading detectado', resultado.criteriosAplicados.excluiuWashTrading],
                  ['Modo conservador inteligente', resultado.criteriosAplicados.modoConservadorInteligente],
                  ['Keywords customizadas', (resultado.criteriosAplicados.customKeywordsUsadas?.length ?? 0) > 0],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className={val ? 'text-green-500' : 'text-surface-300'} />
                    <span className="text-[10px] text-text-secondary">{label as string}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-secondary pt-1 border-t border-surface-100">
                Hash: <span className="font-mono">{resultado.auditoria.hashPdf.slice(0, 16)}…</span>
                &nbsp;·&nbsp;{new Date(resultado.auditoria.timestamp).toLocaleString('pt-BR')}
                &nbsp;·&nbsp;v{resultado.algoritmoVersao}
              </p>
            </PremiumCard>

            {/* Ações */}
            <div className="grid grid-cols-2 gap-2">
              <RoundedButton variant="outline" onClick={handleNovaAnalise}>
                <RefreshCw size={13} className="mr-1" /> Nova
              </RoundedButton>
              <RoundedButton onClick={() => setShowFinalModal(true)}>
                <Save size={13} className="mr-1" /> Finalizar
              </RoundedButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Finalização */}
      <Modal isOpen={showFinalModal} onClose={() => setShowFinalModal(false)} title="Finalizar Apuração">
        <div className="space-y-4">
          <div className="p-4 bg-surface-50 rounded-xl text-center">
            <p className="text-xs text-text-secondary mb-1">Renda Média Mensal Validada</p>
            <p className="text-2xl font-bold text-text-primary">{brl(mediaMensalAtiva)}</p>
            <p className="text-xs text-text-secondary mt-1">{mesesAtivos} meses · {[...validadas].length} créditos</p>
          </div>

          {clienteVinculado && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                ⚡ O stage do cliente será atualizado automaticamente com base no múltiplo de renda.
              </p>
            </div>
          )}

          {!clienteVinculado && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Vincular ao cliente</label>
              <select value={clienteVinculado} onChange={e => setClienteVinculado(e.target.value)}
                className="w-full p-3 bg-surface-50 rounded-xl border-none text-text-primary text-sm">
                <option value="">Nenhum</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          {isAnalyst ? (
            <RoundedButton fullWidth variant="outline" onClick={handleBaixarRelatorio} disabled={isDownloading}>
              {isDownloading
                ? <span className="flex items-center gap-2 justify-center"><Loader2 size={14} className="animate-spin" />Baixando…</span>
                : <span className="flex items-center gap-2 justify-center"><Download size={14} />Baixar Relatório</span>}
            </RoundedButton>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <RoundedButton variant="outline" onClick={handleBaixarRelatorio} disabled={isDownloading || isSaving}>
                {isDownloading
                  ? <span className="flex items-center gap-2 justify-center"><Loader2 size={14} className="animate-spin" />Baixando…</span>
                  : <span className="flex items-center gap-2 justify-center"><Download size={14} />Baixar Relatório</span>}
              </RoundedButton>
              <RoundedButton onClick={handleFinalizar} disabled={isSaving || isDownloading}>
                {isSaving ? <span className="flex items-center gap-2 justify-center"><Loader2 size={14} className="animate-spin" />Salvando…</span> : '✓ Confirmar e Salvar'}
              </RoundedButton>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
