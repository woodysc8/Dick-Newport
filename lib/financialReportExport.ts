import type { FinancialReport } from "./financialReport";

// Render only the frozen display sections. Downloads never reread financial data.
export function reportDocumentLines(report: FinancialReport, saved: boolean) {
  return ["DICK-NEWPORT", "Personal Financial Report", "Private and confidential", `Generated ${report.generatedAt}`, saved ? "Saved historical snapshot" : "Unsaved preview — not added to report history", ...report.sections.flatMap((section) => [section.title, ...section.lines])];
}
export async function exportReportDocx(report: FinancialReport, saved: boolean) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const headings = new Set(report.sections.map((s) => s.title));
  const lines = reportDocumentLines(report, saved);
  const document = new Document({ creator: "Dick-Newport", title: "Personal Financial Report", description: "Private financial snapshot", styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 140 } } } } }, sections: [{ children: lines.map((line, index) => new Paragraph({ heading: index === 1 ? HeadingLevel.TITLE : headings.has(line) ? HeadingLevel.HEADING_1 : undefined, children: [new TextRun({ text: line, bold: index === 0, color: headings.has(line) ? "194C63" : "202B33" })] })) }] });
  return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
}
export async function exportReportPdf(report: FinancialReport, saved: boolean) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  document.setTitle("Personal Financial Report"); document.setAuthor("Dick-Newport");
  document.setCreationDate(new Date(report.generatedAt));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([612, 792]), y = 736;
  let escaped = false;
  const encode = (text: string) => [...text].map((character) => {
    try { font.encodeText(character); return character; }
    catch { escaped = true; return `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`; }
  }).join("");
  const headings = new Set(report.sections.map((s) => s.title));
  function draw(text: string, heading = false) {
    const face = heading ? bold : font, size = heading ? 13 : 10;
    let line = "";
    const write = () => {
      if (y < 60) { page = document.addPage([612, 792]); y = 736; }
      page.drawText(line, { x: 48, y, size, font: face, color: heading ? rgb(.10, .30, .39) : rgb(.12, .16, .20) });
      y -= heading ? 20 : 15; line = "";
    };
    // Character-aware wrapping also bounds long merchant/security labels.
    for (const character of encode(text)) {
      if (face.widthOfTextAtSize(line + character, size) > 516 && line) write();
      line += character;
    }
    if (line) write();
    y -= heading ? 7 : 6;
  }
  for (const line of reportDocumentLines(report, saved)) draw(line, line === "Personal Financial Report" || headings.has(line));
  if (escaped) draw("Typography note: characters outside the PDF font are preserved as Unicode code points [U+...]. The Word export retains their original text.");
  const pages = document.getPages();
  pages.forEach((p, i) => p.drawText(`Private | Dick-Newport | ${i + 1} / ${pages.length}`, { x: 48, y: 30, size: 8, font, color: rgb(.4, .4, .4) }));
  return new Uint8Array(await document.save());
}
