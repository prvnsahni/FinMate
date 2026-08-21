import { TestBed } from '@angular/core/testing';
import { DocumentReviewComponent } from './document-review.component';
import { DocumentExtractionResult } from './document-review.model';
import { CustomTagSuggestionService } from './services/custom-tag-suggestion.service';

const ef = <T>(value: T) => ({ value, authority: 'EXTRACTED' as const });

// TAG-BATCH-C4 — a mock suggestion service. `currentScope: null` (default) keeps
// the DOC-4 flow canonical-only; individual tests override it to exercise C4.
const makeSuggestionsMock = () => ({
  currentScope: jest.fn().mockReturnValue(null),
  loadAuthorizedTags: jest.fn().mockResolvedValue([]),
  suggest: jest.fn().mockReturnValue([]),
  recordCorrection: jest.fn(),
});
let suggestionsMock: ReturnType<typeof makeSuggestionsMock>;

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

/** Await the fire-and-forget async custom-suggestion load kicked off in the effect. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('DocumentReviewComponent (DOC-4)', () => {
  beforeEach(() => {
    suggestionsMock = makeSuggestionsMock();
    TestBed.configureTestingModule({
      imports: [DocumentReviewComponent],
      providers: [
        { provide: CustomTagSuggestionService, useValue: suggestionsMock },
      ],
    });
  });

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

  // ── TAG-BATCH-C4 — custom-tag suggestion integration ────────────────────────
  it('merges client-side custom suggestions onto items once authorized tags load', async () => {
    suggestionsMock.currentScope.mockReturnValue({ userId: 'user-A' });
    suggestionsMock.loadAuthorizedTags.mockResolvedValue([
      { id: 'ct-1', name: 'My Grocery', scope: 'personal' },
    ]);
    suggestionsMock.suggest.mockImplementation((label: string | null) =>
      label === 'Milk'
        ? [{ tagId: 'ct-1', name: 'My Grocery', reason: 'Matched tag name', confidence: 0.8 }]
        : [],
    );

    const fixture = build(okResult());
    await flush();
    fixture.detectChanges();

    const milk = fixture.componentInstance.model()!.items.find((i) => i.description.value === 'Milk')!;
    const custom = milk.tags.find((t) => t.tagId === 'ct-1');
    expect(custom).toMatchObject({ custom: true, authority: 'INFERRED', reason: 'Matched tag name' });
    // Canonical tags remain present alongside the custom suggestion.
    expect(milk.tags.some((t) => t.tagId === 'milk' && !t.custom)).toBe(true);
  });

  it('records a device-local correction for a kept custom tag ONLY on explicit confirm', async () => {
    suggestionsMock.currentScope.mockReturnValue({ userId: 'user-A' });
    suggestionsMock.loadAuthorizedTags.mockResolvedValue([
      { id: 'ct-1', name: 'My Grocery', scope: 'personal' },
    ]);
    suggestionsMock.suggest.mockImplementation((label: string | null) =>
      label === 'Milk'
        ? [{ tagId: 'ct-1', name: 'My Grocery', reason: 'Matched tag name', confidence: 0.8 }]
        : [],
    );

    const fixture = build(okResult());
    await flush();
    // Nothing recorded until the user confirms.
    expect(suggestionsMock.recordCorrection).not.toHaveBeenCalled();

    fixture.componentInstance.confirm();
    expect(suggestionsMock.recordCorrection).toHaveBeenCalledWith(
      { userId: 'user-A' },
      'Milk',
      'ct-1',
    );
  });

  it('stays canonical-only when there is no scope (signed out) — no custom load', async () => {
    suggestionsMock.currentScope.mockReturnValue(null);
    const fixture = build(okResult());
    await flush();
    expect(suggestionsMock.loadAuthorizedTags).not.toHaveBeenCalled();
    const milk = fixture.componentInstance.model()!.items.find((i) => i.description.value === 'Milk')!;
    expect(milk.tags.every((t) => !t.custom)).toBe(true);
  });
});
