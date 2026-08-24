import { PDFDocument, PDFPage } from 'pdf-lib';
import { brl } from '@/lib/reports/computeHybridMetrics';
import type { PipelineStageCount } from '@/lib/reports/computeHybridMetrics';
import {
  PAGE,
  PDF_THEME,
  ReportFonts,
  addStandardFooters,
  drawContinuationHeader,
  drawDivider,
  drawHBars,
  drawKeyValues,
  drawReportHeader,
  drawSectionTitle,
  embedFonts,
  loadKaizenLogo,
  safeText,
} from '@/lib/pdf/reportKit';

export interface ReportPdfKpis {
  totalClientes: number;
  createdInPeriod: number;
  vendas: number;
  aprovados: number;
  taxaConversao: number;
  vgv: number;
}

export interface ReportPdfInput {
  title: string;
  subtitle: string;
  periodLabel: string;
  generatedBy: string;
  kpis: ReportPdfKpis;
  pipeline: PipelineStageCount[];
  stageDistribution: Array<{ name: string; value: number }>;
  teams?: Array<{ name: string; clientes: number; vendas: number; aprovados: number; vgv: number; membros: number }>;
  brokers?: Array<{ name: string; clientes: number; vendas: number; aprovados: number; vgv: number }>;
  clients?: Array<{ name: string; stage: string; value: number; updatedAt: string }>;
  insights: string[];
}

const ROW_H = 18;
const HDR_H = 20;

export async function generateDetailedReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const logo = await loadKaizenLogo(doc);

  let page = doc.addPage([PAGE.W, PAGE.H]);
  let y = drawReportHeader(page, fonts, logo, {
    title: input.title,
    subtitle: `${input.subtitle} · Período: ${input.periodLabel} · Gerado por: ${input.generatedBy}`,
  });

  const ensureSpace = (needed: number) => {
    if (y - needed < PAGE.MARGIN) {
      page = doc.addPage([PAGE.W, PAGE.H]);
      y = drawContinuationHeader(page, fonts, input.title);
    }
  };

  const drawTable = (headers: string[], rows: string[][], colWidths: number[], highlightColumn = 1) => {
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const drawHeader = () => {
      page.drawRectangle({
        x: PAGE.MARGIN, y: y - HDR_H, width: totalWidth, height: HDR_H, color: PDF_THEME.blue,
      });
      let x = PAGE.MARGIN;
      headers.forEach((h, i) => {
        page.drawText(safeText(h.toUpperCase()), {
          x: x + 4, y: y - HDR_H + 6, size: 7, font: fonts.bold, color: PDF_THEME.white,
        });
        x += colWidths[i];
      });
      y -= HDR_H;
    };

    drawHeader();
    rows.forEach((row, rowIndex) => {
      ensureSpace(ROW_H);
      if (y < PAGE.MARGIN + ROW_H) {
        page = doc.addPage([PAGE.W, PAGE.H]);
        y = drawContinuationHeader(page, fonts, input.title);
        drawHeader();
      }
      page.drawRectangle({
        x: PAGE.MARGIN,
        y: y - ROW_H,
        width: totalWidth,
        height: ROW_H,
        color: rowIndex % 2 === 0 ? PDF_THEME.white : PDF_THEME.rowAlt,
      });
      let x = PAGE.MARGIN;
      row.forEach((cell, i) => {
        const maxChars = Math.max(8, Math.floor(colWidths[i] / 4.5));
        const raw = safeText(cell);
        const text = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}.` : raw;
        page.drawText(text, {
          x: x + 4,
          y: y - ROW_H + 6,
          size: 7.5,
          font: i === highlightColumn ? fonts.bold : fonts.regular,
          color: PDF_THEME.ink,
        });
        x += colWidths[i];
      });
      page.drawLine({
        start: { x: PAGE.MARGIN, y: y - ROW_H },
        end: { x: PAGE.MARGIN + totalWidth, y: y - ROW_H },
        thickness: 0.3,
        color: PDF_THEME.line,
      });
      y -= ROW_H;
    });
    y -= 6;
  };

  // ── Indicadores ──────────────────────────────────────────────────────────
  y = drawSectionTitle(page, fonts, y, 'Indicadores do período');
  y = drawKeyValues(page, fonts, y, [
    { label: 'Total de clientes no período', value: String(input.kpis.totalClientes) },
    { label: 'Criados no período', value: String(input.kpis.createdInPeriod) },
    { label: 'Vendas concluídas', value: String(input.kpis.vendas) },
    { label: 'Aprovados', value: String(input.kpis.aprovados) },
    { label: 'Taxa de conversão', value: `${input.kpis.taxaConversao.toFixed(1)}%` },
    { label: 'VGV concluído', value: brl(input.kpis.vgv) },
  ]);
  y = drawDivider(page, y);

  // ── Pipeline por etapa ───────────────────────────────────────────────────
  ensureSpace(80);
  y = drawSectionTitle(page, fonts, y, 'Pipeline por etapa (criados no período)');
  y = drawHBars(
    page,
    fonts,
    y,
    input.pipeline.map((p) => ({ label: p.stage, value: p.count })),
    { labelW: 130 },
  );
  y = drawDivider(page, y);

  // ── Insights ─────────────────────────────────────────────────────────────
  ensureSpace(60);
  y = drawSectionTitle(page, fonts, y, 'Insights do período');
  for (const insight of input.insights) {
    ensureSpace(14);
    page.drawText(safeText(`- ${insight}`), {
      x: PAGE.MARGIN, y, size: 8.5, font: fonts.regular, color: PDF_THEME.ink,
    });
    y -= 14;
  }
  y = drawDivider(page, y);

  // ── Análise por equipe ───────────────────────────────────────────────────
  if (input.teams && input.teams.length > 0) {
    ensureSpace(80);
    y = drawSectionTitle(page, fonts, y, 'Análise por equipe');
    drawTable(
      ['Equipe', 'Clientes', 'Vendas', 'Aprov.', 'Membros', 'VGV'],
      input.teams.map((t) => [
        t.name, String(t.clientes), String(t.vendas), String(t.aprovados), String(t.membros), brl(t.vgv),
      ]),
      [150, 62, 58, 58, 62, 133],
      2,
    );
  }

  // ── Ranking de corretores ────────────────────────────────────────────────
  if (input.brokers && input.brokers.length > 0) {
    ensureSpace(80);
    y = drawSectionTitle(page, fonts, y, 'Ranking de corretores');
    drawTable(
      ['Corretor', 'Clientes', 'Vendas', 'Aprov.', 'VGV'],
      input.brokers.map((b) => [b.name, String(b.clientes), String(b.vendas), String(b.aprovados), brl(b.vgv)]),
      [190, 72, 68, 62, 131],
      2,
    );
  }

  // ── Clientes criados no período ──────────────────────────────────────────
  if (input.clients && input.clients.length > 0) {
    page = doc.addPage([PAGE.W, PAGE.H]);
    y = drawContinuationHeader(page, fonts, input.title);
    y = drawSectionTitle(page, fonts, y, `Clientes criados no período (${input.clients.length})`);
    drawTable(
      ['Cliente', 'Etapa', 'Valor', 'Criado em'],
      input.clients.map((c) => [c.name, c.stage, brl(c.value), c.updatedAt]),
      [200, 130, 105, 88],
      0,
    );
  }

  addStandardFooters(doc, fonts);
  return doc.save();
}

export function buildInsights(kpis: ReportPdfKpis, pipeline: PipelineStageCount[]): string[] {
  const topStage = pipeline.length > 0 ? [...pipeline].sort((a, b) => b.count - a.count)[0] : null;
  const insights = [
    `${kpis.createdInPeriod} clientes entraram no período; ${kpis.vendas} viraram vendas.`,
    `Taxa de conversão do período: ${kpis.taxaConversao.toFixed(1)}%.`,
    `VGV confirmado no período: ${brl(kpis.vgv)}.`,
  ];
  if (topStage && topStage.count > 0) {
    insights.push(`Etapa com mais clientes criados no período: ${topStage.stage} (${topStage.count}).`);
  }
  return insights;
}
