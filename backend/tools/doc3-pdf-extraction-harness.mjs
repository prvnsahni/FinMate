/**
 * DOC-3 measurement harness (manual spike, NOT a test).
 *
 * Measures REAL pdfjs-dist text extraction on synthetic text PDFs — fully local, no
 * network, no canvas. pdfjs-dist v6 is ESM-only and does not load inside Jest's VM,
 * so this standalone harness produces the measured numbers recorded in
 * docs/architecture/FINMATE_DOCUMENT_EXTRACTION_SPIKE.md (§DOC-3 results).
 *
 * Run from the repo root (so 'pdfjs-dist' resolves):
 *   node backend/tools/doc3-pdf-extraction-harness.mjs
 *
 * It never uses production data, calls no external service, and mutates nothing.
 */

function makeTextPdf(lines) {
  const esc = (s) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let content = '';
  let y = 210;
  for (const l of lines) {
    content += `BT /F1 12 Tf 1 0 0 1 20 ${y} Tm (${esc(l)}) Tj ET\n`;
    y -= 20;
  }
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 240]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const off = [];
  objs.forEach((b, i) => {
    off[i] = pdf.length;
    pdf += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xs = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of off) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xs}\n%%EOF`;
  return Uint8Array.from(Buffer.from(pdf, 'latin1'));
}

const NUM = /(\d+(?:\.\d{1,2})?)/g;
const last = (s) => {
  const m = s.match(NUM);
  return m ? Number(m[m.length - 1]) : undefined;
};
function parse(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const totalLine = lines.find((l) => /total/i.test(l));
  const total = totalLine ? last(totalLine) : undefined;
  const merchant = lines.find(
    (l) =>
      l !== totalLine &&
      !/\d{4}-\d{2}-\d{2}/.test(l) &&
      !/total/i.test(l) &&
      last(l) === undefined,
  );
  const date = (lines.join(' ').match(/\d{4}-\d{2}-\d{2}/) || [])[0];
  const currency = /INR|₹/.test(text)
    ? 'INR'
    : /USD|\$/.test(text)
      ? 'USD'
      : undefined;
  const items = lines
    .filter(
      (l) =>
        l !== totalLine &&
        l !== merchant &&
        !/\d{4}-\d{2}-\d{2}/.test(l) &&
        last(l) !== undefined,
    )
    .map((l) => last(l));
  return { merchant, date, currency, total, items };
}
const recon = (total, items) => {
  const alloc = Math.round(items.reduce((a, b) => a + b, 0) * 100) / 100;
  if (total == null) return 'UNRECONCILED';
  const d = Math.round((total - alloc) * 100) / 100;
  return d === 0
    ? 'BALANCED'
    : d > 0
      ? `UNDER_ALLOCATED(${d})`
      : `OVER_ALLOCATED(${d})`;
};

const fixtures = {
  'grocery-balanced': [
    'Example Market',
    'Date: 2026-08-15',
    'Milk 2 x 60 120',
    'Bread 1 x 45 45',
    'Rice 1 x 520 520',
    'TOTAL INR 685',
  ],
  'grocery-under': [
    'Example Market',
    'Date: 2026-08-15',
    'Milk 120',
    'Rice 520',
    'TOTAL INR 685',
  ],
  'grocery-over': [
    'Example Market',
    'Date: 2026-08-15',
    'Milk 120',
    'Rice 520',
    'Ghee 60',
    'TOTAL INR 685',
  ],
  'blank-scanned-equivalent': ['', ''],
};

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
for (const [id, lines] of Object.entries(fixtures)) {
  const bytes = makeTextPdf(lines);
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    text +=
      (await pg.getTextContent()).items.map((i) => i.str).join('\n') + '\n';
  }
  const ms = (performance.now() - t0).toFixed(1);
  const detected = text.trim().length > 0;
  const f = parse(text);
  console.log(
    `\n[${id}] size=${bytes.byteLength}B pages=${doc.numPages} textDetected=${detected} ms=${ms}`,
  );
  if (detected) {
    console.log(
      `  merchant=${JSON.stringify(f.merchant)} date=${f.date} currency=${f.currency} total=${f.total} items=${JSON.stringify(f.items)} reconciliation=${recon(f.total, f.items)}`,
    );
  } else {
    console.log(
      '  no text layer -> route to scanned/OCR path (blocked: rasterizer + language data)',
    );
  }
}
