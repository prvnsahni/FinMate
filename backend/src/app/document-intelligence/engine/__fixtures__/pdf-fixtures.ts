/**
 * DOC-3 synthetic PDF fixture generator. Builds tiny, valid, text-layer PDFs from
 * plain lines — no images, no PII, no external tool. Each line is placed with an
 * absolute text matrix so pdfjs extracts every line. Used to MEASURE the real
 * pdfjs text-extraction adapter. (Producing a genuine *scanned* image-only PDF or a
 * receipt photo requires a rasterizer — not in the approved package set — see the
 * spike doc; those paths are not fixture-generated here.)
 */

/** Build a single-page text PDF (latin1 bytes) containing the given lines. */
export function makeTextPdf(lines: string[]): Uint8Array {
  const escape = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  let content = '';
  let y = 210;
  for (const line of lines) {
    content += `BT /F1 12 Tf 1 0 0 1 20 ${y} Tm (${escape(line)}) Tj ET\n`;
    y -= 20;
  }

  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 240]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets[i] = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  return Uint8Array.from(Buffer.from(pdf, 'latin1'));
}

/** A balanced grocery text-PDF (items sum to the printed total: 120+45+520 = 685). */
export const GROCERY_TEXT_PDF_LINES = [
  'Example Market',
  'Date: 2026-08-15',
  'Milk 2 x 60 120',
  'Bread 1 x 45 45',
  'Rice 1 x 520 520',
  'TOTAL INR 685',
];
