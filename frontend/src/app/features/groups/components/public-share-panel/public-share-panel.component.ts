import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  PublicShareService,
  PublicShareStatus,
} from '../../../../core/services/public-share.service';

/**
 * PUBLIC-1E — owner/admin controls for a group's PUBLIC read-only share, embedded
 * in the existing Group Settings tab. Rendered only for owner/admin AND only when
 * the `publicGroupShare` feature flag is ON (both gated by the parent).
 *
 * Capability-secret discipline: the raw token is available ONLY in the immediate
 * create/regenerate response; it is turned into a share URL held in memory
 * (`shareUrl`) for a one-time copy and is NEVER persisted (no localStorage/
 * sessionStorage/IndexedDB/query param), never re-fetched via status, and never
 * logged. After a reload the URL is gone by design — the owner regenerates to get
 * a fresh link (which invalidates the old one).
 */
@Component({
  selector: 'app-public-share-panel',
  imports: [],
  templateUrl: './public-share-panel.component.html',
})
export class PublicSharePanelComponent implements OnInit {
  private readonly service = inject(PublicShareService);
  private readonly destroyRef = inject(DestroyRef);

  readonly groupId = input.required<string>();

  readonly status = signal<PublicShareStatus | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  /** The freshly-issued share URL (raw token embedded) — IN MEMORY ONLY. */
  readonly shareUrl = signal<string | null>(null);
  readonly confirmingRevoke = signal(false);
  readonly confirmingRegenerate = signal(false);
  readonly copied = signal(false);

  ngOnInit(): void {
    this.loadStatus();
  }

  private loadStatus(): void {
    this.loading.set(true);
    this.service
      .getStatus(this.groupId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.status.set(s);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(this.messageFor(e));
          this.loading.set(false);
        },
      });
  }

  create(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.reset();
    this.service
      .create(this.groupId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.shareUrl.set(this.service.buildShareUrl(res.token));
          this.status.set({
            active: true,
            status: 'active',
            expiresAt: res.expiresAt,
            createdAt: res.createdAt,
            revokedAt: null,
          });
          this.notice.set(
            'Link created. Copy it now — for security it is shown only once.',
          );
          this.busy.set(false);
        },
        error: (e) => {
          this.error.set(this.messageFor(e));
          this.busy.set(false);
          if (e instanceof HttpErrorResponse && e.status === 409)
            this.loadStatus();
        },
      });
  }

  askRegenerate(): void {
    this.confirmingRegenerate.set(true);
    this.confirmingRevoke.set(false);
    this.reset();
  }
  cancelRegenerate(): void {
    this.confirmingRegenerate.set(false);
  }

  regenerate(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirmingRegenerate.set(false);
    this.reset();
    this.service
      .regenerate(this.groupId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.shareUrl.set(this.service.buildShareUrl(res.token));
          this.status.set({
            active: true,
            status: 'active',
            expiresAt: res.expiresAt,
            createdAt: res.createdAt,
            revokedAt: null,
          });
          this.notice.set(
            'New link created. The previous link no longer works.',
          );
          this.busy.set(false);
        },
        error: (e) => {
          this.error.set(this.messageFor(e));
          this.busy.set(false);
        },
      });
  }

  askRevoke(): void {
    this.confirmingRevoke.set(true);
    this.confirmingRegenerate.set(false);
    this.reset();
  }
  cancelRevoke(): void {
    this.confirmingRevoke.set(false);
  }

  revoke(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirmingRevoke.set(false);
    this.reset();
    this.service
      .revoke(this.groupId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.shareUrl.set(null);
          this.status.set({
            active: false,
            status: 'revoked',
            expiresAt: null,
            createdAt: null,
            revokedAt: new Date().toISOString(),
          });
          this.notice.set(
            'Public sharing turned off. The link no longer works.',
          );
          this.busy.set(false);
        },
        error: (e) => {
          this.error.set(this.messageFor(e));
          this.busy.set(false);
        },
      });
  }

  async copy(): Promise<void> {
    const url = this.shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard?.writeText(url);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard may be unavailable (permissions/insecure context); the URL is
      // still visible for manual copy. Never log the URL/token.
      this.notice.set('Copy the link shown above.');
    }
  }

  private reset(): void {
    this.error.set(null);
    this.notice.set(null);
    this.copied.set(false);
  }

  /** Name-free, token-free error message. */
  private messageFor(e: unknown): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 403)
        return 'Only group owners and admins can manage public sharing.';
      if (e.status === 409)
        return 'A public link is already active. Refresh, then regenerate or turn it off.';
      if (e.status === 0)
        return 'Network error. Please check your connection and try again.';
    }
    return "Couldn't update public sharing. Please try again.";
  }
}
