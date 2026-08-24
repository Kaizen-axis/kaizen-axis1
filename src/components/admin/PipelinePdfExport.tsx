import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';
import { supabase } from '@/lib/supabase';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Profile } from '@/context/AppContext';
import { logAuditEvent } from '@/services/auditLogger';

interface Props {
  corretores: Profile[];
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '—';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const normalized = value
      .replace(/\s/g, '')
      .replace(/R\$/g, '')
      .replace(/\./g, '')
      .replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export default function PipelinePdfExport({ corretores }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);

  const exportar = async () => {
    if (!selectedId) return;
    setLoading(true);

    try {
      // 1. Busca clientes ativos do corretor
      const { data: clients, error } = await supabase
        .from('clients')
        .select('name, phone, email, region_of_interest, profession, gross_income, stage, intended_value, created_at, updated_at')
        .eq('owner_id', selectedId)
        .not('stage', 'in', '("Concluido","Concluído","Cancelado")')
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (error) throw new Error('Erro ao buscar clientes: ' + error.message);
      if (!clients || clients.length === 0) {
        alert('Este corretor não possui clientes ativos no pipeline.');
        return;
      }

      const corretorName = corretores.find(p => p.id === selectedId)?.name || 'Corretor';

      // 2. Resumo executivo
      const totalLeads = clients.length;
      const valorTotal = clients.reduce((acc, c: any) => acc + parseMoney(c.intended_value), 0);
      const distribuicao: Record<string, number> = {};
      for (const c of clients) {
        distribuicao[c.stage] = (distribuicao[c.stage] || 0) + 1;
      }

      // 3. Gera PDF
      const pdfDoc = await PDFDocument.create();
      const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const logoImg = await loadKaizenLogo(pdfDoc);

      const PAGE_W = 595, PAGE_H = 842, MARGIN = 36;
      const COL_W  = PAGE_W - MARGIN * 2;
      const gold   = rgb(0.145, 0.388, 0.922);
      const dark   = rgb(0.10, 0.10, 0.10);
      const gray   = rgb(0.45, 0.45, 0.45);
      const light  = rgb(0.96, 0.96, 0.96);
      const white  = rgb(1, 1, 1);

      let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      let y = PAGE_H - MARGIN;

      // Cabeçalho padrão (logo + azul)
      y = drawReportHeader(page, { regular, bold }, logoImg, { title: 'Relatório de Pipeline de Clientes', subtitle: `Corretor: ${corretorName}` });

      // Resumo executivo
      page.drawText('RESUMO EXECUTIVO', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 18;
      for (const [label, value] of [
        ['Total de Leads Ativos', String(totalLeads)],
        ['Valor Total do Pipeline', formatCurrency(valorTotal)],
      ] as [string, string][]) {
        page.drawText(`${label}:`, { x: MARGIN, y, size: 9, font: bold, color: dark });
        page.drawText(value, { x: MARGIN + 145, y, size: 9, font: regular, color: dark });
        y -= 14;
      }
      y -= 4;
      page.drawText('Distribuição por Status:', { x: MARGIN, y, size: 9, font: bold, color: dark });
      y -= 13;
      for (const [stage, count] of Object.entries(distribuicao)) {
        page.drawText(`  • ${stage}: ${count}`, { x: MARGIN, y, size: 9, font: regular, color: gray });
        y -= 13;
      }
      y -= 8;
      page.drawRectangle({ x: MARGIN, y, width: COL_W, height: 0.5, color: rgb(0.85, 0.85, 0.85) });
      y -= 16;
      page.drawText('CLIENTES NO PIPELINE', { x: MARGIN, y, size: 10, font: bold, color: gold });
      y -= 16;

      // Colunas
      const cols = [
        { label: 'Nome',        w: 95 },
        { label: 'Telefone',    w: 72 },
        { label: 'Região',      w: 65 },
        { label: 'Profissão',   w: 70 },
        { label: 'Renda',       w: 65 },
        { label: 'Status',      w: 60 },
        { label: 'Valor',       w: 65 },
        { label: 'Atualização', w: 55 },
      ];
      const SAFE_ROW_H = 18, SAFE_HDR_H = 20;

      const drawHeader = (pg: typeof page, startY: number) => {
        pg.drawRectangle({ x: MARGIN, y: startY - SAFE_HDR_H, width: COL_W, height: SAFE_HDR_H, color: gold });
        let cx = MARGIN + 4;
        for (const col of cols) {
          pg.drawText(col.label, { x: cx, y: startY - SAFE_HDR_H + 6, size: 7, font: bold, color: white });
          cx += col.w;
        }
        return startY - SAFE_HDR_H;
      };

      y = drawHeader(page, y);

      let rowIdx = 0;
      for (const c of clients) {
        if (y < MARGIN + SAFE_ROW_H + 20) {
          page = pdfDoc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
          page.drawText(`Pipeline — ${corretorName} (continuação)`, { x: MARGIN, y, size: 8, font: regular, color: gray });
          y -= 14;
          y = drawHeader(page, y);
          rowIdx = 0;
        }

        const rowColor = rowIdx % 2 === 0 ? white : light;
        page.drawRectangle({ x: MARGIN, y: y - SAFE_ROW_H, width: COL_W, height: SAFE_ROW_H, color: rowColor });

        const cells = [
          truncate(c.name, 16),
          truncate(c.phone, 13),
          truncate(c.region_of_interest, 11),
          truncate(c.profession, 12),
          c.gross_income ? formatCurrency(parseFloat(c.gross_income)) : '—',
          truncate(c.stage, 10),
          c.intended_value != null ? formatCurrency(parseMoney(c.intended_value)) : '—',
          formatDate(c.updated_at),
        ];

        let cx = MARGIN + 4;
        for (let i = 0; i < cols.length; i++) {
          page.drawText(cells[i], { x: cx, y: y - SAFE_ROW_H + 6, size: 7, font: regular, color: dark });
          cx += cols[i].w;
        }
        page.drawRectangle({ x: MARGIN, y: y - SAFE_ROW_H, width: COL_W, height: 0.3, color: rgb(0.88, 0.88, 0.88) });

        y -= SAFE_ROW_H;
        rowIdx++;
      }

      // Rodapé padrão em todas as páginas
      addStandardFooters(pdfDoc, { regular, bold });

      // 4. Download
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pipeline-${corretorName.replace(/\s+/g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      logAuditEvent({ action: 'document_downloaded', entity: 'report', entityId: `pipeline-${corretorName}`, metadata: { type: 'pipeline_corretor', corretor: corretorName } });

    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="print:hidden bg-card-bg rounded-xl border border-surface-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <FileText size={16} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-text-primary">Pipeline por Corretor (PDF)</p>
          <p className="text-xs text-text-secondary">Todos os leads ativos, excluindo concluídos e cancelados</p>
        </div>
      </div>

      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm bg-surface-50 focus:border-gold-400 focus:ring-1 focus:ring-gold-400 outline-none transition-all"
      >
        <option value="">Selecione um corretor...</option>
        {corretores
          .filter(p => p.role?.toUpperCase() === 'CORRETOR')
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
          .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
        }
      </select>

      <button
        onClick={exportar}
        disabled={!selectedId || loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading
          ? <><Loader2 size={15} className="animate-spin" /> Gerando PDF...</>
          : <><Download size={15} /> Exportar Pipeline (PDF)</>
        }
      </button>
    </div>
  );
}
