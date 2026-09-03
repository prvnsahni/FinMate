import { parseReceiptText } from './receipt-text-parser';

const GROCERY = [
  'Example Market',
  'Date: 2026-08-15',
  'Milk 2 x 60 120',
  'Bread 1 x 45 45',
  'Rice 1 x 520 520',
  'TOTAL INR 685',
].join('\n');

describe('parseReceiptText (pure heuristic, no fabrication)', () => {
  it('extracts merchant, date, currency, total and line items with EXTRACTED authority', () => {
    const r = parseReceiptText(GROCERY, { adapter: 'pdf_text', page: 1 });
    expect(r.header?.merchant?.value).toBe('Example Market');
    expect(r.header?.documentDate?.value).toBe('2026-08-15');
    expect(r.header?.currency?.value).toBe('INR');
    expect(r.header?.total?.value).toBe(685);
    expect(r.header?.total?.authority).toBe('EXTRACTED');
    expect(r.header?.total?.confidence?.score).toBeGreaterThan(0);
    expect(r.header?.total?.provenance?.page).toBe(1);
    expect(r.lineItems?.length).toBe(3);
    const milk = r.lineItems?.[0];
    expect(milk?.quantity?.value).toBe(2);
    expect(milk?.unitPrice?.value).toBe(60);
    expect(milk?.lineTotal?.value).toBe(120);
  });

  it('omits fields it cannot read — never fabricates', () => {
    const r = parseReceiptText('Some Shop\nThanks for visiting');
    expect(r.header?.total).toBeUndefined();
    expect(r.unresolvedFields).toContain('total');
    expect(r.lineItems).toBeUndefined();
  });

  it('handles empty text without inventing anything', () => {
    const r = parseReceiptText('   \n  ');
    expect(r.header).toBeUndefined();
    expect(r.lineItems).toBeUndefined();
    expect(r.unresolvedFields).toEqual(
      expect.arrayContaining(['header', 'lineItems']),
    );
  });
});
