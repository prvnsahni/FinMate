import { DocumentSourceType } from '../document-extraction-engine.types';

/**
 * DOC-2 synthetic receipt fixtures — ground truth ONLY (no images, no binaries, no
 * PII, no secrets). They document the extraction TARGET a real engine must hit and
 * feed the reconciliation tests. They are NOT extraction output — DOC-2 wires no OCR.
 *
 * `printedTotal` is the total printed on the document; `sum(lineTotals)` may differ
 * from it on purpose (fixtures H/I) to exercise UNDER/OVER allocation. Reconciliation
 * must surface the difference and never alter a value.
 */
export interface FixtureLineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
}

export interface ReceiptFixture {
  id: string;
  label: string;
  sourceType: DocumentSourceType;
  mimeType: string;
  /** Simulates whether a PDF carries a usable text layer (text-PDF vs scanned). */
  pdfHasTextLayer?: boolean;
  expected: {
    merchant?: string;
    date?: string; // YYYY-MM-DD
    currency?: string;
    lineItems: FixtureLineItem[];
  };
  /** Total printed on the document. */
  printedTotal?: number;
  /** Notes for the spike (quality/ambiguity characteristics). */
  notes?: string;
}

export const RECEIPT_FIXTURES: ReceiptFixture[] = [
  {
    id: 'grocery-balanced',
    label: 'A. Grocery receipt (image) — items sum to printed total',
    sourceType: 'image',
    mimeType: 'image/jpeg',
    expected: {
      merchant: 'Example Market',
      date: '2026-08-15',
      currency: 'INR',
      lineItems: [
        { description: 'Milk', quantity: 2, unitPrice: 60, lineTotal: 120 },
        { description: 'Bread', quantity: 1, unitPrice: 45, lineTotal: 45 },
        { description: 'Rice', quantity: 1, unitPrice: 520, lineTotal: 520 },
      ],
    },
    printedTotal: 685,
  },
  {
    id: 'retail-basic',
    label: 'B. Retail receipt (image)',
    sourceType: 'image',
    mimeType: 'image/png',
    expected: {
      merchant: 'Example Retail',
      date: '2026-08-14',
      currency: 'INR',
      lineItems: [
        { description: 'T-Shirt', quantity: 1, unitPrice: 499, lineTotal: 499 },
        { description: 'Socks', quantity: 2, unitPrice: 99, lineTotal: 198 },
      ],
    },
    printedTotal: 697,
  },
  {
    id: 'restaurant-tax-tip',
    label: 'C. Restaurant bill with tax + tip (image)',
    sourceType: 'image',
    mimeType: 'image/jpeg',
    expected: {
      merchant: 'Example Diner',
      date: '2026-08-13',
      currency: 'INR',
      lineItems: [
        { description: 'Thali', quantity: 2, unitPrice: 220, lineTotal: 440 },
        { description: 'Tax (5%)', lineTotal: 22 },
        { description: 'Tip', lineTotal: 50 },
      ],
    },
    printedTotal: 512,
  },
  {
    id: 'fuel-single-line',
    label: 'D. Fuel receipt (image) — single line',
    sourceType: 'image',
    mimeType: 'image/jpeg',
    expected: {
      merchant: 'Example Fuel',
      date: '2026-08-15',
      currency: 'INR',
      lineItems: [
        {
          description: 'Petrol',
          quantity: 10,
          unitPrice: 102.5,
          lineTotal: 1025,
        },
      ],
    },
    printedTotal: 1025,
  },
  {
    id: 'invoice-textpdf-multipage',
    label: 'E. Multi-page text-PDF invoice',
    sourceType: 'pdf',
    mimeType: 'application/pdf',
    pdfHasTextLayer: true,
    expected: {
      merchant: 'Example Online',
      date: '2026-08-10',
      currency: 'INR',
      lineItems: [
        { description: 'Item 1', quantity: 1, unitPrice: 300, lineTotal: 300 },
        { description: 'Item 2', quantity: 3, unitPrice: 150, lineTotal: 450 },
      ],
    },
    printedTotal: 750,
  },
  {
    id: 'invoice-scannedpdf',
    label: 'F. Scanned PDF (no text layer) — same invoice as E',
    sourceType: 'pdf',
    mimeType: 'application/pdf',
    pdfHasTextLayer: false,
    expected: {
      merchant: 'Example Online',
      date: '2026-08-10',
      currency: 'INR',
      lineItems: [
        { description: 'Item 1', quantity: 1, unitPrice: 300, lineTotal: 300 },
        { description: 'Item 2', quantity: 3, unitPrice: 150, lineTotal: 450 },
      ],
    },
    printedTotal: 750,
    notes:
      'Image-only PDF → render→OCR path; expected output identical to fixture E.',
  },
  {
    id: 'low-quality-rotated',
    label: 'G. Poor-quality / rotated receipt (image)',
    sourceType: 'image',
    mimeType: 'image/jpeg',
    expected: {
      merchant: 'Example Market',
      date: '2026-08-15',
      currency: 'INR',
      // A real engine may only partially detect these; unreadable fields must be
      // returned missing/uncertain, never fabricated.
      lineItems: [{ description: 'Milk', lineTotal: 120 }],
    },
    printedTotal: 685,
    notes:
      'Expect partial_extraction with low confidence; missing fields stay null.',
  },
  {
    id: 'ambiguous-characters',
    label: 'H. Ambiguous characters (image) — items UNDER the printed total',
    sourceType: 'image',
    mimeType: 'image/png',
    expected: {
      merchant: 'Example Market',
      date: '2026-08-15',
      currency: 'INR',
      lineItems: [
        { description: 'Milk', lineTotal: 120 },
        { description: 'Rice', lineTotal: 520 },
      ],
    },
    printedTotal: 685,
    notes:
      'sum(items)=640 vs printed 685 → UNDER_ALLOCATED (Δ 45). Do not invent an item.',
  },
  {
    id: 'sum-exceeds-total',
    label: 'I. Line-item sum exceeds printed total (image)',
    sourceType: 'image',
    mimeType: 'image/jpeg',
    expected: {
      merchant: 'Example Market',
      date: '2026-08-15',
      currency: 'INR',
      lineItems: [
        { description: 'Milk', lineTotal: 120 },
        { description: 'Rice', lineTotal: 520 },
        { description: 'Ghee', lineTotal: 60 },
      ],
    },
    printedTotal: 685,
    notes:
      'sum(items)=700 vs printed 685 → OVER_ALLOCATED (Δ -15). Do not reduce a price.',
  },
];

/** Sum of a fixture's line totals (undefined line totals ignored). */
export function fixtureItemSum(f: ReceiptFixture): number {
  return f.expected.lineItems.reduce(
    (s, li) => (typeof li.lineTotal === 'number' ? s + li.lineTotal : s),
    0,
  );
}
