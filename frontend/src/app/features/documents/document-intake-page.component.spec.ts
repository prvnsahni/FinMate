import { TestBed } from '@angular/core/testing';
import { DocumentIntakePageComponent } from './document-intake-page.component';
import { DocumentExtractionClientService } from './services/document-extraction-client.service';
import { DocumentExtractionResult } from './document-review.model';

describe('DocumentIntakePageComponent (DOC-4 orchestration)', () => {
  let extractor: { extractFromFile: jest.Mock };
  let comp: DocumentIntakePageComponent;

  beforeEach(() => {
    extractor = { extractFromFile: jest.fn() };
    TestBed.configureTestingModule({
      imports: [DocumentIntakePageComponent],
      providers: [
        { provide: DocumentExtractionClientService, useValue: extractor },
      ],
    });
    comp = TestBed.createComponent(
      DocumentIntakePageComponent,
    ).componentInstance;
  });

  it('TOTAL_ONLY selection does NOT invoke extraction', () => {
    comp.onMode('TOTAL_ONLY');
    expect(comp.mode()).toBe('TOTAL_ONLY');
    expect(extractor.extractFromFile).not.toHaveBeenCalled();
  });

  it('ITEMIZED + file runs client extraction and stores the result', async () => {
    const result: DocumentExtractionResult = {
      status: 'ok',
      sourceType: 'pdf',
      candidatesOnly: true,
      warnings: [],
    };
    extractor.extractFromFile.mockResolvedValue(result);
    comp.onMode('ITEMIZED');
    const file = { name: 'r.pdf', type: 'application/pdf' } as File;
    await comp.onFile({ target: { files: [file] } } as unknown as Event);
    expect(extractor.extractFromFile).toHaveBeenCalledWith(file);
    expect(comp.result()).toBe(result);
    expect(comp.loading()).toBe(false);
  });

  it('surfaces an error if extraction throws (no crash, no finance mutation)', async () => {
    extractor.extractFromFile.mockRejectedValue(new Error('boom'));
    await comp.onFile({
      target: { files: [{ type: 'application/pdf' } as File] },
    } as unknown as Event);
    expect(comp.error()).toBeTruthy();
    expect(comp.result()).toBeNull();
  });

  it('holds the confirmed draft for handoff — does not create an expense itself', () => {
    comp.onConfirmed({
      title: 'X',
      amount: 685,
      currency: 'INR',
      date: null,
      itemCount: 2,
      reconciliation: {
        documentTotal: 685,
        allocatedTotal: 685,
        unallocatedDifference: 0,
        reconciliationStatus: 'BALANCED',
      },
    });
    expect(comp.confirmedDraft()?.amount).toBe(685);
  });
});
