import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PublicSharePanelComponent } from './public-share-panel.component';
import { PublicShareService } from '../../../../core/services/public-share.service';

const G = 'group-1';
const RAW = 'RAWTOKEN-abc123';
const secret = (token = RAW) => ({
  token,
  status: 'active' as const,
  expiresAt: null,
  createdAt: '2026-09-02',
  revokedAt: null,
});

describe('PublicSharePanelComponent (PUBLIC-1E)', () => {
  let service: {
    getStatus: jest.Mock;
    create: jest.Mock;
    regenerate: jest.Mock;
    revoke: jest.Mock;
    buildShareUrl: jest.Mock;
  };
  let fixture: ComponentFixture<PublicSharePanelComponent>;

  const build = () => {
    fixture = TestBed.createComponent(PublicSharePanelComponent);
    fixture.componentRef.setInput('groupId', G);
    fixture.detectChanges(); // ngOnInit → loadStatus
    return fixture.componentInstance;
  };

  beforeEach(() => {
    service = {
      getStatus: jest.fn().mockReturnValue(
        of({
          active: false,
          status: null,
          expiresAt: null,
          createdAt: null,
          revokedAt: null,
        }),
      ),
      create: jest.fn().mockReturnValue(of(secret())),
      regenerate: jest.fn().mockReturnValue(of(secret('RAWTOKEN-new'))),
      revoke: jest.fn().mockReturnValue(of({ revoked: true })),
      buildShareUrl: jest
        .fn()
        .mockImplementation((t: string) => `https://app/share/${t}`),
    };
    TestBed.configureTestingModule({
      imports: [PublicSharePanelComponent],
      providers: [{ provide: PublicShareService, useValue: service }],
    });
  });

  it('loads status for the group on init (status never carries a token)', () => {
    const comp = build();
    expect(service.getStatus).toHaveBeenCalledWith(G);
    expect(comp.status()?.active).toBe(false);
    expect(comp.shareUrl()).toBeNull(); // never fetch a token via status
  });

  it('create returns a one-time token → builds the share URL + copy is offered', () => {
    const comp = build();
    comp.create();
    expect(service.create).toHaveBeenCalledWith(G);
    expect(comp.shareUrl()).toBe(`https://app/share/${RAW}`);
    expect(comp.status()?.active).toBe(true);
    expect(comp.notice()).toMatch(/only once/i);
  });

  it('regenerate replaces the displayed link and explains the old one is invalid', () => {
    const comp = build();
    comp.regenerate();
    expect(service.regenerate).toHaveBeenCalledWith(G);
    expect(comp.shareUrl()).toBe('https://app/share/RAWTOKEN-new');
    expect(comp.notice()).toMatch(/previous link no longer works/i);
  });

  it('revoke turns sharing off and clears the displayed link', () => {
    const comp = build();
    comp.revoke();
    expect(service.revoke).toHaveBeenCalledWith(G);
    expect(comp.shareUrl()).toBeNull();
    expect(comp.status()?.active).toBe(false);
    expect(comp.notice()).toMatch(/turned off/i);
  });

  it('surfaces a name-free error on 403 (server remains the authority)', () => {
    service.create.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 403 })),
    );
    const comp = build();
    comp.create();
    expect(comp.error()).toMatch(/owners and admins/i);
    expect(comp.shareUrl()).toBeNull();
  });

  it('never persists the raw token/URL to browser storage', () => {
    const setSpy = jest.spyOn(Storage.prototype, 'setItem');
    const comp = build();
    comp.create();
    for (const call of setSpy.mock.calls) {
      const s = JSON.stringify(call);
      expect(s).not.toContain(RAW);
      expect(s).not.toContain('/share/');
    }
    setSpy.mockRestore();
  });

  it('does not auto-persist; the token URL lives only in the in-memory signal', () => {
    const comp = build();
    comp.create();
    // A fresh panel (e.g. after reload) has no URL — the one-time secret is gone.
    const comp2 = build();
    expect(comp2.shareUrl()).toBeNull();
    expect(comp.shareUrl()).toBe(`https://app/share/${RAW}`);
  });
});
