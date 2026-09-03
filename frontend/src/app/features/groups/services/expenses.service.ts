import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { from, Observable } from 'rxjs';
import { mergeMap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { ClientEncryptionService } from '../../../core/services/encryption.service';
import {
  CategoryAnalyticsPoint,
  CreateExpenseDto,
  Expense,
  GetExpensesResponse,
  MonthlyAnalyticsPoint,
  UpdateExpenseDto,
} from '@finmate/data-models';
import { mapDecryptExpense } from '../../../core/utils/crypto-operators';
import { GroupKeyService } from '../../../core/services/group-key.service';
import { ExpenseDecryptionService } from '../../../core/services/expense-decryption.service';
import { CryptoSessionManager } from '../../../core/services/crypto-session-manager.service';

/** Shared query for the group analytics endpoints, mirroring the unified filter. */
export interface GroupAnalyticsQuery {
  startDate?: string;
  endDate?: string;
  categories?: string[];
  memberIds?: string[];
  paidByIds?: string[];
  /** Omit or 'both' to apply no transaction-type filter. */
  transactionType?: 'expense' | 'refund';
  minAmount?: number;
  maxAmount?: number;
  /** Canonical tag ids — matches ANY (TAG-BATCH-B). */
  tagIds?: string[];
}

/** TAG-BATCH-B — one canonical tag's spending total (parallel to CategoryAnalyticsPoint). */
export interface TagAnalyticsPoint {
  tagId: string;
  total: number;
  currency: string;
}

/** TAG-BATCH-B2 — one (month, tag) spending point for the monthly tag trend. */
export interface TagTrendPoint {
  month: string;
  tagId: string;
  total: number;
  currency: string;
}

/** TAG-BATCH-B — safe read-only canonical taxonomy row from GET /taxonomy. */
export interface CanonicalTaxonomyTag {
  id: string;
  canonicalName: string;
  normalizedKey: string;
  parentId?: string;
  status: 'active' | 'deprecated' | 'candidate' | 'reviewed';
  version: number;
}

/** Minimal shape of a duplicate-check match — only what the warning dialog
 *  needs to display, decrypted client-side like any other expense list item. */
export interface DuplicateExpenseMatch {
  id: string;
  title: string;
  amountTotal: number;
  currency: string;
  category: string;
  expenseDate: string;
  transactionType?: 'expense' | 'refund';
  paidByUserId?: string | null;
  paidByGroupMemberId?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class ExpensesService {
  private http = inject(HttpClient);
  private encryptionService = inject(ClientEncryptionService);
  private groupKeyService = inject(GroupKeyService);
  private decryptor = inject(ExpenseDecryptionService);
  private cryptoSession = inject(CryptoSessionManager);
  private baseUrl = environment.apiBaseUrl;

  /**
   * Encrypts CreateExpenseDto or UpdateExpenseDto outgoing payloads.
   */
  private async encryptPayload(
    payload: CreateExpenseDto | UpdateExpenseDto,
  ): Promise<any> {
    const context =
      await this.cryptoSession.ensureCryptoContext('expense_encrypt');
    const user = context.user;
    const masterKey = context.masterKey;

    const encrypted = { ...payload } as any;

    // 1. Determine encryption scope and pick corresponding key
    let scope: 'personal' | 'group' = 'personal';
    let key: CryptoKey = masterKey;

    if ((payload as any).groupId) {
      scope = 'group';
      const groupId = (payload as any).groupId as string;
      const resolved = await this.cryptoSession.ensureGroupKey(
        groupId,
        'write',
      );
      if (resolved.status === 'ready') {
        key = resolved.key;
        encrypted.groupKeyVersionId = resolved.versionId;
      } else if (resolved.status === 'pending') {
        // Genuinely un-minted key (e.g. brand-new group). Self-provisioning
        // is always backend-permitted (provisionGroupKeys treats self as an
        // implicit exception to the owner/admin-only rule) — and
        // createGroupKey() itself refuses via requiresKeyProvisioning() if a
        // key already exists for other members but isn't shared with this
        // caller yet, so this can't mint a second, divergent key.
        key = await this.groupKeyService.createGroupKey(groupId);
        const mintedVersionId =
          this.groupKeyService.getKnownActiveVersionId(groupId);
        if (mintedVersionId) {
          encrypted.groupKeyVersionId = mintedVersionId;
        }
      } else {
        // no_access / rate_limited / error: minting would be pointless or
        // wrong here — surface the real, classified reason instead.
        throw new Error(
          resolved.status === 'no_access'
            ? 'You no longer have access to this group.'
            : resolved.status === 'rate_limited'
              ? 'Too many requests. Please wait a moment and try again.'
              : "Couldn't resolve this group's encryption key. Please try again.",
        );
      }
    } else {
      const currentUserId = user?.userId;
      const splits = payload.splits || [];
      const otherParticipants = splits.filter(
        (s) => s.participantUserId && s.participantUserId !== currentUserId,
      );

      if (otherParticipants.length > 0) {
        throw new Error(
          'Shared expenses must belong to a group and use group encryption scope.',
        );
      }
    }

    encrypted.encryptionScope = scope;

    if (payload.title) {
      encrypted.title = await this.encryptionService.encrypt(
        payload.title,
        key,
      );
    }

    if (payload.description) {
      encrypted.description = await this.encryptionService.encrypt(
        payload.description,
        key,
      );
    }

    this.cryptoSession.assertCurrentEpoch(context.epoch);
    return encrypted;
  }

  /**
   * Fetch expenses for a group or personal dashboard.
   */
  getExpenses(
    groupId: string,
    options: {
      page?: number;
      limit?: number;
      categories?: string[];
      startDate?: string;
      endDate?: string;
      memberIds?: string[];
      paidByIds?: string[];
      /** Omit or 'both' to apply no transaction-type filter. */
      transactionType?: 'expense' | 'refund';
      minAmount?: number;
      maxAmount?: number;
      /** Canonical tag ids — matches ANY (TAG-BATCH-B). */
      tagIds?: string[];
      sortBy?: 'date' | 'amount';
      sortOrder?: 'asc' | 'desc';
    } = {},
  ): Observable<GetExpensesResponse> {
    let params = new HttpParams().set('groupId', groupId);

    if (options.page !== undefined) {
      params = params.set('page', options.page.toString());
    }
    if (options.limit !== undefined) {
      params = params.set('limit', options.limit.toString());
    }
    if (options.categories?.length) {
      params = params.set('categories', options.categories.join(','));
    }
    if (options.startDate) {
      params = params.set('startDate', options.startDate);
    }
    if (options.endDate) {
      params = params.set('endDate', options.endDate);
    }
    if (options.memberIds?.length) {
      params = params.set('memberIds', options.memberIds.join(','));
    }
    if (options.paidByIds?.length) {
      params = params.set('paidByIds', options.paidByIds.join(','));
    }
    if (options.tagIds?.length) {
      params = params.set('tagIds', options.tagIds.join(','));
    }
    if (options.transactionType) {
      params = params.set('transactionType', options.transactionType);
    }
    if (options.minAmount != null) {
      params = params.set('minAmount', String(options.minAmount));
    }
    if (options.maxAmount != null) {
      params = params.set('maxAmount', String(options.maxAmount));
    }
    if (options.sortBy) {
      params = params.set('sortBy', options.sortBy);
      params = params.set('sortOrder', options.sortOrder ?? 'desc');
    }

    return this.http
      .get<GetExpensesResponse>(`${this.baseUrl}/expenses`, { params })
      .pipe(
        mergeMap(async (res) => {
          const payload = res.data as
            | Expense[]
            | { data?: Expense[] }
            | undefined;
          const expenses = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.data)
              ? payload.data
              : undefined;
          if (!expenses || expenses.length === 0) {
            return res;
          }

          // Single decryption pipeline: resolves keys per scope, classifies any
          // failure, and preserves ciphertext so items can be retried later.
          const decryptedExpenses = await this.decryptor.decryptExpenses(
            expenses as any[],
          );

          if (Array.isArray(payload)) {
            res.data = decryptedExpenses as any;
          } else if (payload && Array.isArray(payload.data)) {
            payload.data = decryptedExpenses as any;
          }
          return res;
        }),
      );
  }

  /**
   * Create a new expense.
   */
  createExpense(payload: CreateExpenseDto): Observable<Expense> {
    return from(this.encryptPayload(payload)).pipe(
      mergeMap((encryptedPayload) =>
        this.http.post<Expense>(`${this.baseUrl}/expenses`, encryptedPayload),
      ),
      mapDecryptExpense(this.decryptor),
    );
  }

  /**
   * Update an existing expense.
   */
  updateExpense(id: string, payload: UpdateExpenseDto): Observable<Expense> {
    return from(this.encryptPayload(payload)).pipe(
      mergeMap((encryptedPayload) =>
        this.http.patch<Expense>(
          `${this.baseUrl}/expenses/${id}`,
          encryptedPayload,
        ),
      ),
      mapDecryptExpense(this.decryptor),
    );
  }

  /**
   * Delete an expense.
   */
  deleteExpense(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/expenses/${id}`);
  }

  /**
   * Restore a deleted expense.
   */
  restoreExpense(id: string): Observable<Expense> {
    return this.http
      .post<Expense>(`${this.baseUrl}/expenses/${id}/restore`, {})
      .pipe(mapDecryptExpense(this.decryptor));
  }

  /** Builds the shared query params for the group analytics endpoints. */
  private buildAnalyticsParams(
    groupId?: string,
    query?: GroupAnalyticsQuery,
  ): HttpParams {
    let params = new HttpParams();
    if (groupId && groupId !== 'personal') {
      params = params.set('groupId', groupId);
    }
    if (query?.startDate) params = params.set('startDate', query.startDate);
    if (query?.endDate) params = params.set('endDate', query.endDate);
    if (query?.categories?.length) {
      params = params.set('categories', query.categories.join(','));
    }
    if (query?.memberIds?.length) {
      params = params.set('memberIds', query.memberIds.join(','));
    }
    if (query?.paidByIds?.length) {
      params = params.set('paidByIds', query.paidByIds.join(','));
    }
    if (query?.tagIds?.length) {
      params = params.set('tagIds', query.tagIds.join(','));
    }
    if (query?.transactionType) {
      params = params.set('transactionType', query.transactionType);
    }
    if (query?.minAmount != null) {
      params = params.set('minAmount', String(query.minAmount));
    }
    if (query?.maxAmount != null) {
      params = params.set('maxAmount', String(query.maxAmount));
    }
    return params;
  }

  /**
   * Fetch monthly summaries for analytics, honoring the unified group filter.
   */
  getMonthlyAnalytics(
    groupId?: string,
    query?: GroupAnalyticsQuery,
  ): Observable<MonthlyAnalyticsPoint[]> {
    return this.http
      .get<
        MonthlyAnalyticsPoint[]
      >(`${this.baseUrl}/expenses/analytics/monthly`, { params: this.buildAnalyticsParams(groupId, query) })
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  /**
   * Fetch category analytics, honoring the unified group filter.
   */
  getCategoryAnalytics(
    groupId?: string,
    query?: GroupAnalyticsQuery,
  ): Observable<CategoryAnalyticsPoint[]> {
    return this.http
      .get<
        CategoryAnalyticsPoint[]
      >(`${this.baseUrl}/expenses/analytics/categories`, { params: this.buildAnalyticsParams(groupId, query) })
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  /**
   * TAG-BATCH-B — fetch canonical tag spending distribution, honoring the unified
   * group filter. Read-only reporting; never mutates finance.
   */
  getTagAnalytics(
    groupId?: string,
    query?: GroupAnalyticsQuery,
  ): Observable<TagAnalyticsPoint[]> {
    return this.http
      .get<
        TagAnalyticsPoint[]
      >(`${this.baseUrl}/expenses/analytics/tags`, { params: this.buildAnalyticsParams(groupId, query) })
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  /**
   * TAG-BATCH-B2 — monthly canonical tag spending trend, honoring the unified
   * group filter. Read-only reporting; never mutates finance.
   */
  getTagTrend(
    groupId?: string,
    query?: GroupAnalyticsQuery,
  ): Observable<TagTrendPoint[]> {
    return this.http
      .get<
        TagTrendPoint[]
      >(`${this.baseUrl}/expenses/analytics/tags-trend`, { params: this.buildAnalyticsParams(groupId, query) })
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  /**
   * TAG-BATCH-B — fetch the read-only shared canonical taxonomy (active tags only)
   * for the tag filter facet. Safe reference metadata; contains no user/E2EE data.
   */
  getTaxonomy(): Observable<CanonicalTaxonomyTag[]> {
    return this.http
      .get<CanonicalTaxonomyTag[]>(`${this.baseUrl}/taxonomy`)
      .pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  /**
   * Returns the calling user's personal expenses + group shares.
   * Each item has `myShare` (user's portion) and `expenseType` (PERSONAL | GROUP_SHARE).
   * Dashboard totals must use `myShare`, never `amountTotal`.
   */
  getMyExpenses(
    options: { page?: number; limit?: number } = {},
  ): Observable<any> {
    let params = new HttpParams();
    if (options.page) params = params.set('page', options.page.toString());
    if (options.limit) params = params.set('limit', options.limit.toString());
    return this.http.get<any>(`${this.baseUrl}/expenses/me`, { params }).pipe(
      mergeMap(async (res) => {
        const items: any[] = Array.isArray(res.data)
          ? res.data
          : Array.isArray(res.data?.data)
            ? res.data.data
            : [];
        if (items.length === 0) return res;
        const decrypted = await this.decryptor.decryptExpenses(items);
        if (Array.isArray(res.data)) {
          res.data = decrypted;
        } else if (res.data && Array.isArray(res.data.data)) {
          res.data.data = decrypted;
        }
        return res;
      }),
    );
  }

  /**
   * Combined monthly total (personal expenses + myShare of group expenses).
   * Returns total across all categories for the given month.
   */
  getCombinedMonthlyTotal(month?: string): Observable<number> {
    const m = month ?? new Date().toISOString().slice(0, 7);
    return this.http
      .get<any>(`${this.baseUrl}/expenses/analytics/all-monthly?month=${m}`)
      .pipe(
        mergeMap(async (res) => {
          // The response interceptor unwraps `{ success, data }` → `data`, so
          // `res` is already the array here. Tolerate both shapes.
          const items: { category: string; amount: number }[] = Array.isArray(
            res,
          )
            ? res
            : Array.isArray(res?.data)
              ? res.data
              : [];
          return items.reduce((sum, i) => sum + Number(i.amount), 0);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
  }

  /**
   * Returns the append-only version history for an expense.
   * Read-only — versions carry the encrypted snapshot from the time of each action.
   */
  getExpenseVersionHistory(expenseId: string): Observable<any[]> {
    return this.http
      .get<any>(`${this.baseUrl}/expenses/${expenseId}/versions`)
      .pipe(
        mergeMap(async (res) => {
          const versions: any[] = Array.isArray(res.data) ? res.data : [];
          return versions;
        }),
      );
  }

  /**
   * Import expenses.
   */
  importExpenses(formData: FormData): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/import/expenses`, formData);
  }

  /**
   * Soft duplicate check — used before Save to warn (never block) the user.
   * Matches on amount + date + scope (personal/group) + transaction type
   * only; title is deliberately excluded (users write wildly different
   * titles for the same real-world transaction). `excludeId` omits the
   * expense currently being edited from its own duplicate results.
   */
  checkDuplicates(params: {
    amountTotal: number;
    expenseDate: string;
    currency: string;
    transactionType: 'expense' | 'refund';
    groupId?: string;
    excludeId?: string;
  }): Observable<DuplicateExpenseMatch[]> {
    let httpParams = new HttpParams()
      .set('amountTotal', params.amountTotal.toString())
      .set('expenseDate', params.expenseDate)
      .set('currency', params.currency)
      .set('transactionType', params.transactionType);
    if (params.groupId) {
      httpParams = httpParams.set('groupId', params.groupId);
    }
    if (params.excludeId) {
      httpParams = httpParams.set('excludeId', params.excludeId);
    }

    return this.http
      .get<any>(`${this.baseUrl}/expenses/duplicates`, { params: httpParams })
      .pipe(
        mergeMap(async (res) => {
          const items: any[] = Array.isArray(res.data) ? res.data : [];
          if (items.length === 0) return [];
          return (await this.decryptor.decryptExpenses(
            items,
          )) as DuplicateExpenseMatch[];
        }),
      );
  }
}
