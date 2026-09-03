import {
  ExtractedDocumentHeader,
  ExtractedField,
  ExtractedLineItem,
  FieldConfidence,
} from '../document-extraction-engine.types';

/**
 * Pure heuristic parser: extracted TEXT → candidate receipt fields. Shared by the
 * PDF-text and image-OCR adapters so both produce the same normalized shape. It is
 * conservative — a field it cannot confidently read is OMITTED, never fabricated —
 * and it never touches finance data. All values are authority `EXTRACTED`; confidence
 * is extraction certainty only, NOT financial correctness.
 */

const CURRENCY_MAP: Array<[RegExp, string]> = [
  [/₹|\bINR\b|\bRs\.?\b/i, 'INR'],
  [/\$|\bUSD\b/i, 'USD'],
  [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'],
];

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{2}[/-]\d{2}[/-]\d{4})\b/;
const NUM_RE = /(\d+(?:\.\d{1,2})?)/g;
const QTY_RE = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d{1,2})?)/i;

const conf = (score: number): FieldConfidence => ({
  score,
  band: score >= 0.66 ? 'high' : score >= 0.4 ? 'medium' : 'low',
});

const field = <T>(
  value: T,
  score: number,
  adapter?: string,
  page?: number,
): ExtractedField<T> => ({
  value,
  authority: 'EXTRACTED',
  confidence: conf(score),
  ...(adapter || page
    ? {
        provenance: {
          ...(adapter ? { adapter } : {}),
          ...(page ? { page } : {}),
        },
      }
    : {}),
});

const lastNumber = (s: string): number | undefined => {
  const m = s.match(NUM_RE);
  return m && m.length ? Number(m[m.length - 1]) : undefined;
};

export interface ParsedReceipt {
  header?: ExtractedDocumentHeader;
  lineItems?: ExtractedLineItem[];
  warnings: string[];
  unresolvedFields: string[];
}

export function parseReceiptText(
  text: string,
  opts: { adapter?: string; page?: number } = {},
): ParsedReceipt {
  const { adapter, page } = opts;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const warnings: string[] = [];
  const unresolved: string[] = [];

  if (lines.length === 0) {
    return {
      warnings: ['No text lines detected.'],
      unresolvedFields: ['header', 'lineItems'],
    };
  }

  const currencyLine = lines.find((l) =>
    CURRENCY_MAP.some(([re]) => re.test(l)),
  );
  const currency = currencyLine
    ? (
        CURRENCY_MAP.find(([re]) => re.test(currencyLine)) as [RegExp, string]
      )[1]
    : undefined;

  const dateLine = lines.find((l) => DATE_RE.test(l));
  const dateMatch = dateLine?.match(DATE_RE);
  const date = dateMatch ? (dateMatch[1] ?? dateMatch[2]) : undefined;

  const totalLine = lines.find((l) => /total/i.test(l));
  const total = totalLine ? lastNumber(totalLine) : undefined;
  if (!total) unresolved.push('total');

  // Merchant: first line that is not the date/total and has no trailing amount.
  const merchant = lines.find(
    (l) =>
      l !== totalLine &&
      !DATE_RE.test(l) &&
      !/total/i.test(l) &&
      lastNumber(l) === undefined,
  );

  // Line items: lines with a trailing amount that are not the total/date line.
  const items: ExtractedLineItem[] = [];
  for (const l of lines) {
    if (l === totalLine || l === dateLine || l === merchant) continue;
    const lineTotal = lastNumber(l);
    if (lineTotal === undefined) continue;
    const qty = l.match(QTY_RE);
    const description =
      l.replace(NUM_RE, '').replace(/[x×]/gi, '').trim() || 'item';
    items.push({
      authority: 'EXTRACTED',
      confidence: conf(0.5),
      description: field(description, 0.5, adapter, page),
      ...(qty ? { quantity: field(Number(qty[1]), 0.5, adapter, page) } : {}),
      ...(qty ? { unitPrice: field(Number(qty[2]), 0.5, adapter, page) } : {}),
      lineTotal: field(lineTotal, 0.5, adapter, page),
    });
  }

  const header: ExtractedDocumentHeader = {
    ...(merchant ? { merchant: field(merchant, 0.5, adapter, page) } : {}),
    ...(date ? { documentDate: field(date, 0.7, adapter, page) } : {}),
    ...(currency ? { currency: field(currency, 0.7, adapter, page) } : {}),
    ...(total !== undefined ? { total: field(total, 0.6, adapter, page) } : {}),
  };

  return {
    ...(Object.keys(header).length ? { header } : {}),
    ...(items.length ? { lineItems: items } : {}),
    warnings,
    unresolvedFields: unresolved,
  };
}
