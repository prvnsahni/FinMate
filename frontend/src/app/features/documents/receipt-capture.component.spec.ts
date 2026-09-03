import { TestBed } from '@angular/core/testing';
import { ReceiptCaptureComponent } from './receipt-capture.component';
import { DocumentExtractionClientService } from './services/document-extraction-client.service';
import {
  ConfirmedDocumentDraft,
  DocumentExtractionResult,
} from './document-review.model';

describe('ReceiptCaptureComponent (DOC-3F orchestration)', () => {
  let extractor: { extractFromFile: jest.Mock };
  let comp: ReceiptCaptureComponent;

  beforeEach(() => {
    extractor = { extractFromFile: jest.fn() };
    TestBed.configureTestingModule({
      imports: [ReceiptCaptureComponent],
      providers: [
        { provide: DocumentExtractionClientService, useValue: extractor },
      ],
    });
    comp = TestBed.createComponent(ReceiptCaptureComponent).componentInstance;
  });

  const fileEvent = (type: string) =>
    ({ target: { files: [{ type, name: 'r' } as File] } }) as unknown as Event;

  it('TOTAL_ONLY emits totalOnly and NEVER invokes extraction', () => {
    const totalOnly = jest.fn();
    comp.totalOnly.subscribe(totalOnly);
    comp.onMode('TOTAL_ONLY');
    expect(totalOnly).toHaveBeenCalledTimes(1);
    expect(extractor.extractFromFile).not.toHaveBeenCalled();
  });

  it('EXTRACT_ITEMS + file invokes local extraction and stores candidates', async () => {
    const result: DocumentExtractionResult = {
      status: 'ok',
      sourceType: 'image',
      candidatesOnly: true,
      warnings: [],
    };
    extractor.extractFromFile.mockResolvedValue(result);
    comp.onMode('ITEMIZED');
    await comp.onFile(fileEvent('image/jpeg'));
    expect(extractor.extractFromFile).toHaveBeenCalledTimes(1);
    expect(comp.result()).toBe(result);
    expect(comp.loading()).toBe(false);
  });

  it('does NOT extract when a file arrives outside ITEMIZED (defensive)', async () => {
    // mode is null (no ITEMIZED selected)
    await comp.onFile(fileEvent('image/jpeg'));
    expect(extractor.extractFromFile).not.toHaveBeenCalled();
  });

  it('handles provider_unavailable (scanned PDF / OCR unavailable) without crashing or fabricating', async () => {
    const result: DocumentExtractionResult = {
      status: 'provider_unavailable',
      sourceType: 'image',
      candidatesOnly: true,
      warnings: ['Local image OCR is unavailable on this device.'],
    };
    extractor.extractFromFile.mockResolvedValue(result);
    comp.onMode('ITEMIZED');
    await comp.onFile(fileEvent('image/jpeg'));
    expect(comp.result()?.status).toBe('provider_unavailable');
    expect(comp.error()).toBeNull();
  });

  it('surfaces an error (no fabrication) if extraction throws', async () => {
    extractor.extractFromFile.mockRejectedValue(new Error('boom'));
    comp.onMode('ITEMIZED');
    await comp.onFile(fileEvent('application/pdf'));
    expect(comp.error()).toBeTruthy();
    expect(comp.result()).toBeNull();
  });

  it('emits confirmed only on an explicit review confirmation (candidates only)', () => {
    const confirmed = jest.fn();
    comp.confirmed.subscribe(confirmed);
    const draft: ConfirmedDocumentDraft = {
      title: 'Shop',
      amount: 100,
      currency: 'INR',
      date: null,
      itemCount: 1,
      items: [],
      reconciliation: {
        documentTotal: 100,
        allocatedTotal: 100,
        unallocatedDifference: 0,
        reconciliationStatus: 'BALANCED',
      },
    };
    comp.onConfirmed(draft);
    expect(confirmed).toHaveBeenCalledWith(draft);
  });
});
