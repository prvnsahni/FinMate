import {
  ExtractedField,
  ExtractedHeader,
  ExtractedLineItem,
} from './document-review.model';

/**
 * Frontend heuristic parser: extracted TEXT → candidate receipt fields. Mirrors the
 * backend DOC-3 parser (the frontend cannot import backend code). Conservative — omits
 * fields it cannot read, never fabricates. All values are authority EXTRACTED;
 * confidence is extraction certainty only, NOT financial correctness.
 */

const CURRENCY: Array<[RegExp, string]> = [
  [/₹|\bINR\b|\bRs\.?\b/i, 'INR'],
  [/\$|\bUSD\b/i, 'USD'],
  [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'],
];
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b|\b(\d{2}[/-]\d{2}[/-]\d{4})\b/;
const NUM_RE = /(\d+(?:\.\d{1,2})?)/g;
const QTY_RE = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d{1,2})?)/i;

const field = <T>(value: T, score: number): ExtractedField<T> => ({
  value,
  authority: 'EXTRACTED',
  confidence: {
    score,
    band: score >= 0.66 ? 'high' : score >= 0.4 ? 'medium' : 'low',
  },
});

const lastNumber = (s: string): number | undefined => {
  const m = s.match(NUM_RE);
  return m && m.length ? Number(m[m.length - 1]) : undefined;
};

export interface ParsedReceipt {
  header?: ExtractedHeader;
  lineItems?: ExtractedLineItem[];
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return {};

  const currencyLine = lines.find((l) => CURRENCY.some(([re]) => re.test(l)));
  const currency = currencyLine
    ? (CURRENCY.find(([re]) => re.test(currencyLine)) as [RegExp, string])[1]
    : undefined;

  const dateLine = lines.find((l) => DATE_RE.test(l));
  const dateMatch = dateLine?.match(DATE_RE);
  const date = dateMatch ? (dateMatch[1] ?? dateMatch[2]) : undefined;

  const totalLine = lines.find((l) => /total/i.test(l));
  const total = totalLine ? lastNumber(totalLine) : undefined;

  const merchant = lines.find(
    (l) =>
      l !== totalLine &&
      !DATE_RE.test(l) &&
      !/total/i.test(l) &&
      lastNumber(l) === undefined,
  );

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
      description: field(description, 0.5),
      ...(qty ? { quantity: field(Number(qty[1]), 0.5) } : {}),
      ...(qty ? { unitPrice: field(Number(qty[2]), 0.5) } : {}),
      lineTotal: field(lineTotal, 0.5),
    });
  }

  const header: ExtractedHeader = {
    ...(merchant ? { merchant: field(merchant, 0.5) } : {}),
    ...(date ? { documentDate: field(date, 0.7) } : {}),
    ...(currency ? { currency: field(currency, 0.7) } : {}),
    ...(total !== undefined ? { total: field(total, 0.6) } : {}),
  };

  return {
    ...(Object.keys(header).length ? { header } : {}),
    ...(items.length ? { lineItems: items } : {}),
  };
}
