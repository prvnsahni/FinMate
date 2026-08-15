import { TestBed } from '@angular/core/testing';
import { DocumentModeSelectorComponent } from './document-mode-selector.component';
import { DocumentProcessingMode } from './document-processing.model';

describe('DocumentModeSelectorComponent', () => {
  let comp: DocumentModeSelectorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DocumentModeSelectorComponent] });
    comp = TestBed.createComponent(DocumentModeSelectorComponent).componentInstance;
  });

  it('emits TOTAL_ONLY and does not show the unavailable notice', () => {
    const emitted: DocumentProcessingMode[] = [];
    comp.modeSelected.subscribe((m) => emitted.push(m));
    comp.select('TOTAL_ONLY');
    expect(emitted).toEqual(['TOTAL_ONLY']);
    expect(comp.selected()).toBe('TOTAL_ONLY');
    expect(comp.itemizedChosen()).toBe(false);
  });

  it('surfaces the "not available yet" state for ITEMIZED (no fake success)', () => {
    const emitted: DocumentProcessingMode[] = [];
    comp.modeSelected.subscribe((m) => emitted.push(m));
    comp.select('ITEMIZED');
    expect(emitted).toEqual(['ITEMIZED']);
    expect(comp.itemizedChosen()).toBe(true);
  });

  it('renders the explicit unavailable notice in the template when ITEMIZED is chosen', () => {
    const fixture = TestBed.createComponent(DocumentModeSelectorComponent);
    fixture.detectChanges();
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toMatch(/isn't available yet/i);

    fixture.componentInstance.select('ITEMIZED');
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toMatch(/isn't available yet/i);
  });
});
