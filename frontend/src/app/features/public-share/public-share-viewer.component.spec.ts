import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PublicShareViewerComponent } from './public-share-viewer.component';
import {
  PublicLedger,
  PublicShareService,
} from '../../core/services/public-share.service';

const LEDGER: PublicLedger = {
  groupName: 'Goa Trip',
  currency: 'INR',
  entries: [
    {
      date: '2026-08-01',
      amount: 500,
      currency: 'INR',
      category: 'Food',
      transactionType: 'expense',
      payerLabel: 'Member 1',
    },
    {
      date: '2026-08-02',
      amount: 200,
      currency: 'INR',
      category: 'Fuel',
      transactionType: 'refund',
      payerLabel: 'Member 2',
    },
  ],
  balanceSummary: [
    {
      fromLabel: 'Member 2',
      toLabel: 'Member 1',
      amount: 300,
      currency: 'INR',
    },
  ],
  generatedAt: '2026-08-23T00:00:00.000Z',
};

describe('PublicShareViewerComponent (PUBLIC-1E)', () => {
  let service: { getPublicLedger: jest.Mock };
  let fixture: ComponentFixture<PublicShareViewerComponent>;

  const build = (token: string | null) => {
    TestBed.configureTestingModule({
      imports: [PublicShareViewerComponent],
      providers: [
        { provide: PublicShareService, useValue: service },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (k: string) => (k === 'token' ? token : null) },
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PublicShareViewerComponent);
    fixture.detectChanges(); // ngOnInit
    return fixture.componentInstance;
  };

  beforeEach(() => {
    service = { getPublicLedger: jest.fn().mockReturnValue(of(LEDGER)) };
  });

  it('reads the token from the PATH only and requests the projection with it', () => {
    build('TOK123');
    expect(service.getPublicLedger).toHaveBeenCalledWith('TOK123');
  });

  it('renders the public ledger (group name, balances, entries, pseudonyms, refund)', () => {
    build('TOK123');
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('[data-testid="viewer-ledger"]')).toBeTruthy();
    const text = html.textContent ?? '';
    expect(text).toContain('Goa Trip');
    expect(text).toContain('Member 1');
    expect(text).toContain('Member 2');
    expect(text).toContain('owes');
    expect(text.toLowerCase()).toContain('refund');
    // No real names / ids / titles ever appear (the DTO carries none).
    expect(text).not.toMatch(/@|title|description/i);
  });

  it('has NO edit/add/delete/settle controls (read-only)', () => {
    build('TOK123');
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      'button',
    );
    expect(buttons.length).toBe(0);
  });

  it('shows the SAME generic unavailable state for every error cause (no state disclosure)', () => {
    // Different backend failures (404 / 500 / network) must render identically —
    // the component has one unavailable branch, never a per-cause message.
    const rendered: string[] = [];
    for (const status of [404, 500, 0]) {
      service.getPublicLedger.mockReturnValue(throwError(() => ({ status })));
      const comp = build('TOK123');
      expect(comp.state()).toBe('unavailable');
      const el = fixture.nativeElement as HTMLElement;
      expect(
        el.querySelector('[data-testid="viewer-unavailable"]'),
      ).toBeTruthy();
      const text = (
        el.querySelector('[data-testid="viewer-unavailable"]')?.textContent ??
        ''
      ).trim();
      // The token never leaks into the page.
      expect(text).not.toContain('TOK123');
      rendered.push(text);
      TestBed.resetTestingModule();
    }
    // Byte-identical message across all causes → no observable distinction.
    expect(new Set(rendered).size).toBe(1);
  });

  it('unavailable when the path has no token; never calls the API', () => {
    const comp = build(null);
    expect(comp.state()).toBe('unavailable');
    expect(service.getPublicLedger).not.toHaveBeenCalled();
  });

  it('never persists the token to browser storage', () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    build('TOK123');
    for (const call of setSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('TOK123');
    }
    setSpy.mockRestore();
  });
});
