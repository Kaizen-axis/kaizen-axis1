import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { CLIENT_STAGES } from '@/data/clients';
import type { PipelineStageCount } from '@/lib/reports/computeHybridMetrics';
import { safeText } from '@/lib/pdf/reportKit';

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

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;
const ROW_HEIGHT = 18;
const MAX_ROWS_PER_PAGE = 40;

const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
};

const formatBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

const COLORS = {
  primary: hexToRgb('#14532d'),
  secondary: hexToRgb('#1e293b'),
  accent: hexToRgb('#d4af37'),
  text: hexToRgb('#1e293b'),
  muted: hexToRgb('#64748b'),
  headerBg: hexToRgb('#f1f5f9'),
  border: hexToRgb('#e2e8f0'),
  white: hexToRgb('#ffffff'),
};

export async function generateDetailedReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawSectionTitle = (title: string, description: string) => {
    ensureSpace(44);
    page.drawText(safeText(title), { x: MARGIN, y, size: 12, font: fontBold, color: COLORS.text });
    y -= 15;
    page.drawText(safeText(description), { x: MARGIN, y, size: 9, font, color: COLORS.muted });
    y -= 16;
  };

  const drawTable = (headers: string[], rows: string[][], colWidths: number[], highlightColumn = 1) => {
    const totalWidth = colWidths.reduce((a, b) => a + b, 0);
    const drawHeader = () => {
      ensureSpace(ROW_HEIGHT + 8);
      page.drawRectangle({ x: MARGIN, y: y - 4, width: totalWidth, height: ROW_HEIGHT + 8, color: COLORS.headerBg, borderColor: COLORS.border, borderWidth: 0.5 });
      let x = MARGIN;
      headers.forEach((h, i) => {
        page.drawText(safeText(h.toUpperCase()), { x: x + 4, y: y + 4, size: 7, font: fontBold, color: COLORS.secondary });
        x += colWidths[i];
      });
      y -= ROW_HEIGHT + 8;
    };

    drawHeader();
    for (const row of rows) {
      ensureSpace(ROW_HEIGHT);
      if (y < MARGIN + ROW_HEIGHT) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        drawHeader();
      }
      let x = MARGIN;
      row.forEach((cell, i) => {
        page.drawText(safeText(cell), {
          x: x + 4,
          y: y + 4,
          size: 8,
          font: i === highlightColumn ? fontBold : font,
          color: i === highlightColumn ? COLORS.primary : COLORS.text,
        });
        x += colWidths[i];
      });
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + totalWidth, y }, thickness: 0.3, color: COLORS.border });
      y -= ROW_HEIGHT;
    }
    y -= 8;
  };

  // Capa
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 90, width: PAGE_WIDTH, height: 90, color: COLORS.primary });
  page.drawText(safeText(input.title), { x: MARGIN, y: PAGE_HEIGHT - 52, size: 16, font: fontBold, color: COLORS.white });
  page.drawText(safeText(input.subtitle), { x: MARGIN, y: PAGE_HEIGHT - 72, size: 10, font, color: COLORS.white });
  y = PAGE_HEIGHT - 110;
  page.drawText(safeText(`Periodo: ${input.periodLabel}`), { x: MARGIN, y, size: 9, font, color: COLORS.muted });
  y -= 14;
  page.drawText(safeText(`Gerado por: ${input.generatedBy}`), { x: MARGIN, y, size: 9, font, color: COLORS.muted });
  y -= 24;

  // KPIs
  const cards = [
    { label: 'Total de Clientes', value: String(input.kpis.totalClientes), color: COLORS.secondary },
    { label: 'Criados no Periodo', value: String(input.kpis.createdInPeriod), color: COLORS.primary },
    { label: 'Vendas no Periodo', value: String(input.kpis.vendas), color: COLORS.accent },
    { label: 'Aprovados no Periodo', value: String(input.kpis.aprovados), color: hexToRgb('#2563eb') },
    { label: 'Taxa de Conversao', value: `${input.kpis.taxaConversao.toFixed(1)}%`, color: hexToRgb('#7c3aed') },
    { label: 'VGV no Periodo', value: formatBRL(input.kpis.vgv), color: hexToRgb('#0891b2') },
  ];
  const cardWidth = (PAGE_WIDTH - 2 * MARGIN - 20) / 3;
  for (let i = 0; i < cards.length; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = MARGIN + col * (cardWidth + 10);
    const cardY = y - row * 58;
    page.drawRectangle({ x, y: cardY - 40, width: cardWidth, height: 48, color: COLORS.headerBg, borderColor: COLORS.border, borderWidth: 0.5 });
    page.drawText(safeText(cards[i].label), { x: x + 8, y: cardY - 4, size: 7, font, color: COLORS.muted });
    page.drawText(safeText(cards[i].value), { x: x + 8, y: cardY - 22, size: 14, font: fontBold, color: cards[i].color });
  }
  y -= 116;

  // Pipeline
  drawSectionTitle('Pipeline por Etapa', 'Clientes criados no periodo por estagio atual do pipeline');
  for (const p of input.pipeline) {
    ensureSpace(ROW_HEIGHT);
    page.drawText(safeText(p.stage), { x: MARGIN, y: y + 4, size: 8, font, color: COLORS.text });
    page.drawText(String(p.count), { x: MARGIN + 300, y: y + 4, size: 8, font: fontBold, color: COLORS.text });
    y -= ROW_HEIGHT;
  }
  y -= 16;

  // Insights
  drawSectionTitle('Insights do Periodo', 'Leitura rapida dos indicadores');
  for (const insight of input.insights) {
    ensureSpace(16);
    page.drawText(safeText(`- ${insight}`), { x: MARGIN, y, size: 9, font, color: COLORS.text });
    y -= 16;
  }
  y -= 8;

  // Equipes
  if (input.teams && input.teams.length > 0) {
    drawSectionTitle('Analise por Equipe', 'Desempenho das equipes no periodo selecionado');
    const teamRows = input.teams.map((t) => [
      t.name,
      String(t.clientes),
      String(t.vendas),
      String(t.aprovados),
      String(t.membros),
      formatBRL(t.vgv),
    ]);
    drawTable(['Equipe', 'Clientes', 'Vendas', 'Aprov.', 'Membros', 'VGV'], teamRows, [140, 60, 55, 55, 60, 145], 2);
  }

  // Corretores
  if (input.brokers && input.brokers.length > 0) {
    drawSectionTitle('Ranking de Corretores', 'Ordenado por vendas no periodo');
    const brokerRows = input.brokers.map((b) => [
      b.name,
      String(b.clientes),
      String(b.vendas),
      String(b.aprovados),
      formatBRL(b.vgv),
    ]);
    drawTable(['Corretor', 'Clientes', 'Vendas', 'Aprov.', 'VGV'], brokerRows, [180, 70, 65, 60, 140], 2);
  }

  // Clientes do periodo
  if (input.clients && input.clients.length > 0) {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText(safeText(`Clientes Criados no Periodo (${input.clients.length})`), { x: MARGIN, y, size: 14, font: fontBold, color: COLORS.text });
    y -= 20;
    const clientRows = input.clients.map((c) => [c.name, c.stage, formatBRL(c.value), c.updatedAt]);
    const totalWidth = 515;
    const colWidths = [200, 130, 100, 85];
    const drawClientHeader = () => {
      page.drawRectangle({ x: MARGIN, y: y - 4, width: totalWidth, height: ROW_HEIGHT + 8, color: COLORS.headerBg, borderColor: COLORS.border, borderWidth: 0.5 });
      let x = MARGIN;
      ['Cliente', 'Etapa', 'Valor', 'Ultima Atualizacao'].forEach((h, i) => {
        page.drawText(safeText(h.toUpperCase()), { x: x + 4, y: y + 4, size: 7, font: fontBold, color: COLORS.secondary });
        x += colWidths[i];
      });
      y -= ROW_HEIGHT + 8;
    };
    drawClientHeader();
    let rowsOnPage = 0;
    for (const row of clientRows) {
      if (rowsOnPage >= MAX_ROWS_PER_PAGE || y < MARGIN + ROW_HEIGHT) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        drawClientHeader();
        rowsOnPage = 0;
      }
      let x = MARGIN;
      row.forEach((cell, i) => {
        page.drawText(safeText(cell), {
          x: x + 4,
          y: y + 4,
          size: 8,
          font: i === 0 ? fontBold : font,
          color: COLORS.text,
        });
        x += colWidths[i];
      });
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + totalWidth, y }, thickness: 0.3, color: COLORS.border });
      y -= ROW_HEIGHT;
      rowsOnPage++;
    }
  }

  const totalPages = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((p, idx) => {
    p.drawText(safeText(`Gerado em ${new Date().toLocaleDateString('pt-BR')} - Pagina ${idx + 1}/${totalPages}`), {
      x: MARGIN,
      y: 20,
      size: 8,
      font,
      color: COLORS.muted,
    });
  });

  return pdfDoc.save();
}

export function buildInsights(kpis: ReportPdfKpis, pipeline: PipelineStageCount[]): string[] {
  const topStage = pipeline.length > 0 ? [...pipeline].sort((a, b) => b.count - a.count)[0] : null;
  const insights = [
    `${kpis.createdInPeriod} clientes entraram no periodo; ${kpis.vendas} viraram vendas.`,
    `Taxa de conversao do periodo: ${kpis.taxaConversao.toFixed(1)}%.`,
    `VGV confirmado no periodo: ${formatBRL(kpis.vgv)}.`,
  ];
  if (topStage) insights.push(`Etapa com mais clientes criados no periodo: ${topStage.stage} (${topStage.count}).`);
  return insights;
}

export { CLIENT_STAGES };
