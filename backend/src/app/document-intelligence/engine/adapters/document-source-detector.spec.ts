import { detectSourceType, selectAdapterKind } from './document-source-detector';

describe('detectSourceType', () => {
  it('maps image/* → image, application/pdf → pdf, else unknown', () => {
    expect(detectSourceType('image/jpeg')).toBe('image');
    expect(detectSourceType('image/png')).toBe('image');
    expect(detectSourceType('application/pdf')).toBe('pdf');
    expect(detectSourceType('text/plain')).toBe('unknown');
    expect(detectSourceType(undefined)).toBe('unknown');
  });
});

describe('selectAdapterKind (image vs text-PDF vs scanned-PDF)', () => {
  it('routes images to the image adapter', () => {
    expect(selectAdapterKind({ mimeType: 'image/jpeg', sourceType: 'image' })).toBe('image');
  });

  it('routes a PDF with a text layer to pdf_text', () => {
    expect(
      selectAdapterKind({ mimeType: 'application/pdf', sourceType: 'pdf' }, { pdfHasTextLayer: true }),
    ).toBe('pdf_text');
  });

  it('routes a PDF without a text layer to pdf_scanned', () => {
    expect(
      selectAdapterKind({ mimeType: 'application/pdf', sourceType: 'pdf' }, { pdfHasTextLayer: false }),
    ).toBe('pdf_scanned');
  });

  it('defaults a PDF (no probe signal) to pdf_text (preferred path)', () => {
    expect(selectAdapterKind({ mimeType: 'application/pdf', sourceType: 'pdf' })).toBe('pdf_text');
  });

  it('returns none for unsupported input', () => {
    expect(selectAdapterKind({ mimeType: 'text/plain', sourceType: 'unknown' })).toBe('none');
  });
});
