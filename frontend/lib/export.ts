import { jsPDF } from "jspdf";

interface GapItem {
  entity: string;
  entity_type: string;
  priority: string;
  recommendation: string;
}

interface ReportData {
  id: string;
  query: string;
  entities_found: number;
  user_entity_coverage: number;
  top3_entity_coverage: number;
  gaps: GapItem[];
  checklist: string[];
  timestamp?: string;
}

/** Генерирует Markdown-отчёт и скачивает */
export function downloadMarkdown(report: ReportData) {
  const lines: string[] = [];

  lines.push(`# SERP-рентген: ${report.query}`);
  lines.push("");
  lines.push(`**ID:** \`${report.id}\``);
  if (report.timestamp) lines.push(`**Дата:** ${report.timestamp}`);
  lines.push(`**Сущностей найдено:** ${report.entities_found}`);
  lines.push(`**Покрытие топ-3:** ${report.top3_entity_coverage}%`);
  lines.push(`**Покрытие вашей страницы:** ${report.user_entity_coverage}%`);
  lines.push(`**Разрывов:** ${report.gaps?.length || 0}`);
  lines.push("");

  if (report.gaps?.length) {
    lines.push("## 🔴 Разрывы");
    lines.push("");
    lines.push("| Приоритет | Сущность | Тип | Рекомендация |");
    lines.push("|-----------|----------|-----|-------------|");
    for (const g of report.gaps.slice(0, 30)) {
      lines.push(
        `| ${g.priority} | ${g.entity} | ${g.entity_type} | ${g.recommendation} |`
      );
    }
    lines.push("");
  }

  if (report.checklist?.length) {
    lines.push("## ✅ Чек-лист");
    lines.push("");
    for (const item of report.checklist) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*Сгенерировано SERP-рентгеном*");

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  triggerDownload(blob, `serp-xray-${report.id}.md`);
}


/** Генерирует PDF-отчёт и скачивает */
export function downloadPDF(report: ReportData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin;

  // Title
  doc.setFontSize(16);
  doc.text("SERP-рентген", margin, y);
  y += 8;

  doc.setFontSize(12);
  doc.text(report.query, margin, y);
  y += 6;

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`ID: ${report.id}  |  Сущностей: ${report.entities_found}  |  Разрывов: ${report.gaps?.length || 0}`, margin, y);
  y += 10;

  // Gaps table
  if (report.gaps?.length) {
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text("Разрывы", margin, y);
    y += 6;

    // Table header
    doc.setFontSize(7);
    const cols = [
      { title: "Приоритет", w: 18 },
      { title: "Сущность", w: 30 },
      { title: "Тип", w: 18 },
      { title: "Рекомендация", w: pageWidth - margin * 2 - 66 },
    ];

    let x = margin;
    for (const col of cols) {
      doc.setFillColor(240, 240, 240);
      doc.rect(x, y - 4, col.w, 6, "F");
      doc.text(col.title, x + 1, y);
      x += col.w;
    }
    y += 4;

    // Table rows
    for (const g of report.gaps.slice(0, 25)) {
      if (y > 270) { doc.addPage(); y = margin; }
      x = margin;
      doc.text(g.priority, x + 1, y); x += cols[0].w;
      doc.text(g.entity, x + 1, y); x += cols[1].w;
      doc.text(g.entity_type, x + 1, y); x += cols[2].w;
      // Wrap recommendation
      const recLines = doc.splitTextToSize(g.recommendation, cols[3].w - 2);
      doc.text(recLines, x + 1, y);
      y += Math.max(5, recLines.length * 3.5);
    }
    y += 8;
  }

  // Checklist
  if (report.checklist?.length) {
    if (y > 260) { doc.addPage(); y = margin; }
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text("Чек-лист", margin, y);
    y += 6;
    doc.setFontSize(8);
    for (const item of report.checklist) {
      if (y > 275) { doc.addPage(); y = margin; }
      const lines = doc.splitTextToSize(`• ${item}`, pageWidth - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 4;
    }
  }

  doc.save(`serp-xray-${report.id}.pdf`);
}


function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}