import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** PUBLIC-1B status (owner/admin). NEVER carries the raw token or its hash. */
export interface PublicShareStatus {
  active: boolean;
  status: 'active' | 'revoked' | null;
  expiresAt: string | null;
  createdAt: string | null;
  revokedAt: string | null;
}

/**
 * PUBLIC-1B create/regenerate result. `token` is one-time secret material —
 * shown once, never re-fetchable, never persisted.
 */
export interface PublicShareSecret {
  token: string;
  status: 'active';
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** PUBLIC-1C anonymous projection (allowlist-only; no ids/PII/E2EE). */
export interface PublicLedgerEntry {
  date: string;
  amount: number;
  currency: string;
  category: string;
  transactionType: 'expense' | 'refund';
  payerLabel: string;
}
export interface PublicLedgerBalance {
  fromLabel: string;
  toLabel: string;
  amount: number;
  currency: string;
}
export interface PublicLedger {
  groupName: string;
  currency: string;
  entries: PublicLedgerEntry[];
  balanceSummary: PublicLedgerBalance[];
  generatedAt: string;
}

/**
 * PUBLIC-1E — client for the public-share endpoints. Owner/admin management
 * (PUBLIC-1B, authenticated) and the ANONYMOUS read-only projection (PUBLIC-1C).
 *
 * Capability-secret discipline: the raw token is ONLY ever present in the
 * create/regenerate response and in the share URL built from it here, in memory.
 * This service never persists it (no localStorage/sessionStorage/IndexedDB), puts
 * it in no query param, and logs nothing. The viewer reads the token from the
 * route path and sends it only in the intended GET request.
 */
@Injectable({ providedIn: 'root' })
export class PublicShareService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  // ── Owner/admin management (authenticated) ──────────────────────────────────

  getStatus(groupId: string): Observable<PublicShareStatus> {
    return this.http.get<PublicShareStatus>(
      `${this.baseUrl}/groups/${groupId}/public-share`,
    );
  }

  create(
    groupId: string,
    expiresAt?: string | null,
  ): Observable<PublicShareSecret> {
    return this.http.post<PublicShareSecret>(
      `${this.baseUrl}/groups/${groupId}/public-share`,
      expiresAt ? { expiresAt } : {},
    );
  }

  regenerate(
    groupId: string,
    expiresAt?: string | null,
  ): Observable<PublicShareSecret> {
    return this.http.post<PublicShareSecret>(
      `${this.baseUrl}/groups/${groupId}/public-share/regenerate`,
      expiresAt ? { expiresAt } : {},
    );
  }

  revoke(groupId: string): Observable<{ revoked: boolean }> {
    return this.http.delete<{ revoked: boolean }>(
      `${this.baseUrl}/groups/${groupId}/public-share`,
    );
  }

  // ── Anonymous public viewer (no auth required) ──────────────────────────────

  /** Fetch the public read-only ledger for a capability token (from the route path). */
  getPublicLedger(token: string): Observable<PublicLedger> {
    return this.http.get<PublicLedger>(
      `${this.baseUrl}/public/shares/${encodeURIComponent(token)}`,
    );
  }

  /**
   * Build the shareable link for a freshly-issued token, in memory only. Uses the
   * app origin + the approved `/share/:token` route. The raw token is never stored.
   */
  buildShareUrl(token: string): string {
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : '';
    return `${origin}/share/${encodeURIComponent(token)}`;
  }
}
