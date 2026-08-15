import { TestBed } from '@angular/core/testing';
import { DocumentReviewComponent } from './document-review.component';
import { DocumentExtractionResult } from './document-review.model';

const ef = <T>(value: T) => ({ value, authority: 'EXTRACTED' as const });

const okResult = (): DocumentExtractionResult => ({
  status: 'ok',
  sourceType: 'pdf',
  candidatesOnly: true,
  warnings: [],
  header: { merchant: ef('Example Market'), currency: ef('INR'), total: ef(685) },
  lineItems: [
    { authority: 'EXTRACTED', description: ef('Milk'), lineTotal: ef(120) },
    { authority: 'EXTRACTED', description: ef('Rice'), lineTotal: ef(520) },
  ],
});

const build = (result: DocumentExtractionResult) => {
  const fixture = TestBed.createComponent(DocumentReviewComponent);
  fixture.componentRef.setInput('extractionResult', result);
  fixture.detectChanges();
  return fixture;
};

describe('DocumentReviewComponent (DOC-4)', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [DocumentReviewComponent] }));

  it('renders editable candidates and live reconciliation (UNDER 45)', () => {
    const fixture = build(okResult());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('UNDER_ALLOCATED');
    expect(fixture.componentInstance.reconciliation()?.unallocatedDifference).toBe(45);
  });

  it('requires explicit confirm — emits a draft only when confirm() is called', () => {
    const fixture = build(okResult());
    const comp = fixture.componentInstance;
    let emitted: unknown = null;
    comp.confirmed.subscribe((d) => (emitted = d));
    expect(emitted).toBeNull(); // nothing emitted on render
    comp.confirm();
    expect(emitted).not.toBeNull();
    expect(comp.model()?.confirmed).toBe(true);
  });

  it('editing an item never changes the document total', () => {
    const fixture = build(okResult());
    const comp = fixture.componentInstance;
    const id = comp.model()!.items[0].id;
    comp.editItem(id, 'lineTotal', { target: { value: '999' } } as unknown as Event);
    expect(comp.model()?.documentTotal.value).toBe(685);
  });

  it('surfaces provider_unavailable honestly (no pretend OCR, no editable form)', () => {
    const fixture = build({ status: 'provider_unavailable', sourceType: 'image', candidatesOnly: true, warnings: [] });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toMatch(/isn't available/i);
    expect(fixture.componentInstance.hasCandidates()).toBe(false);
  });

  it('handles extraction failure state', () => {
    const fixture = build({ status: 'document_corrupt', sourceType: 'pdf', candidatesOnly: true, warnings: [] });
    expect(fixture.componentInstance.hasCandidates()).toBe(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toMatch(/couldn't read|Total only/i);
  });
});
