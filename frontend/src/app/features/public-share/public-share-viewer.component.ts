import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import {
  PublicLedger,
  PublicShareService,
} from '../../core/services/public-share.service';

type ViewState = 'loading' | 'ready' | 'unavailable';

/**
 * PUBLIC-1E — the ANONYMOUS, read-only public group-ledger viewer at
 * `/share/:token`. No login, no guards, no edit/add/delete/settle actions.
 *
 * The capability token is read ONLY from the route path and sent ONLY in the
 * single GET request; it is never persisted (localStorage/sessionStorage/
 * IndexedDB), never placed in a query param, never logged, and never kept in
 * component state beyond the in-memory request. Every failure (invalid/revoked/
 * expired token, feature OFF, deleted group, inactive creator) collapses to ONE
 * generic "unavailable" state — the viewer never reveals which condition
 * occurred. It renders only the allowlisted public DTO (pseudonyms exactly as
 * supplied by the backend); no ids/PII/E2EE/titles/tags are ever present.
 */
@Component({
  selector: 'app-public-share-viewer',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './public-share-viewer.component.html',
})
export class PublicShareViewerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(PublicShareService);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = signal<ViewState>('loading');
  readonly ledger = signal<PublicLedger | null>(null);

  ngOnInit(): void {
    // Token comes from the PATH only; used solely for this request, not stored.
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.state.set('unavailable');
      return;
    }
    this.service
      .getPublicLedger(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ledger) => {
          this.ledger.set(ledger);
          this.state.set('ready');
        },
        // Generic unavailable for EVERY failure — never surface the raw error
        // (which could echo the token) or distinguish the cause.
        error: () => this.state.set('unavailable'),
      });
  }
}
