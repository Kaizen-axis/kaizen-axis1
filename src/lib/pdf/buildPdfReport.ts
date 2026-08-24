import { PDFDocument } from 'pdf-lib';
import {
  PAGE,
  PDF_THEME,
  embedFonts,
  loadKaizenLogo,
  drawReportHeader,
  drawSectionTitle,
  drawKeyValues,
  drawDivider,
  drawContinuationHeader,
  drawHBars,
  addStandardFooters,
  downloadPdf,
  safeText,
} from '@/lib/pdf/reportKit';

export interface BuildPdfReportOptions {
  filename: string;
  title: string;
  subtitle: string;
  metrics: Array<{ label: string; value: string }>;
  columns: Array<{ header: string; width: number }>;
  rows: string[][];
  insights?: string[];
  charts?: Array<{ title: string; data: Array<{ label: string; value: number; sub?: string }> }>;
}

/**
 * Generic branded PDF report: header, summary metrics, optional insights and
 * native bar charts, then a paginated table. Shared by the /reports hub exports.
 */
export async function buildPdfReport({
  filename,
  title,
  subtitle,
  metrics,
  columns,
  rows,
  insights,
  charts,
}: BuildPdfReportOptions): Promise<void> {
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
}
