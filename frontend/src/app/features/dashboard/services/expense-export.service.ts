import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  DecryptableExpense,
  ExpenseDecryptionService,
} from '../../../core/services/expense-decryption.service';
import {
  ExportFilter,
  ExportFormat,
  ExportRow,
  buildExportFilename,
} from './export/expense-export.types';
import { createWorkbookBuilder } from './export/xlsx-workbook.builder';

/**
 * Frontend half of the export feature (zero-knowledge preserving).
 *
 * Responsibilities: fetch the filtered/authorized rows from the backend (which
 * is the single source of truth for permissions and filtering), decrypt the
 * encrypted fields via the shared decryption pipeline, then generate and
 * download the workbook. It owns decryption + file generation only — never
 * filtering or authorization.
 */
@Injectable({ providedIn: 'root' })
export class ExpenseExportService {
  private http = inject(HttpClient);
  private decryptor = inject(ExpenseDecryptionService);
  private baseUrl = environment.apiBaseUrl;

  /**
   * Fetch matching rows and decrypt their title/description in place using the
   * existing expense decryption pipeline. Rows already carry everything the
   * pipeline needs (encryptionScope, groupId, groupKeyVersionId,
   * wrappedContentKeys), so this reuses it directly with no special-casing.
   */
  async fetchRows(filter: ExportFilter): Promise<ExportRow[]> {
    let params = new HttpParams();
    // Only send bounds that are actually set — an empty date string would fail
    // the backend's date validation (the group ledger export leaves them blank
    // to mean "no bound").
    if (filter.from) params = params.set('from', filter.from);
    if (filter.to) params = params.set('to', filter.to);
    if (filter.type && filter.type !== 'all') {
      params = params.set('type', filter.type);
    }
    if (filter.category) params = params.set('category', filter.category);
    if (filter.status) params = params.set('status', filter.status);
    if (filter.currency) params = params.set('currency', filter.currency);
    if (filter.groupId) params = params.set('groupId', filter.groupId);
    if (filter.categories?.length) {
      params = params.set('categories', filter.categories.join(','));
    }
    if (filter.memberIds?.length) {
      params = params.set('memberIds', filter.memberIds.join(','));
    }
    if (filter.paidByIds?.length) {
      params = params.set('paidByIds', filter.paidByIds.join(','));
    }
    if (filter.tagIds?.length) {
      params = params.set('tagIds', filter.tagIds.join(','));
    }
    if (filter.transactionType && filter.transactionType !== 'both') {
      params = params.set('transactionType', filter.transactionType);
    }
    if (filter.minAmount != null) {
      params = params.set('minAmount', String(filter.minAmount));
    }
    if (filter.maxAmount != null) {
      params = params.set('maxAmount', String(filter.maxAmount));
    }

    const res = await firstValueFrom(
      this.http.get<{ rows?: ExportRow[]; data?: { rows?: ExportRow[] } }>(
        `${this.baseUrl}/expenses/export`,
        { params },
      ),
    );

    // Tolerate both the unwrapped `{ rows }` shape and a nested `{ data: { rows } }`.
    const rows: ExportRow[] =
      (Array.isArray(res?.rows) && res.rows) ||
      (Array.isArray(res?.data?.rows) && res.data!.rows) ||
      [];

    if (rows.length === 0) return [];

    // Decrypt title/description in place. The rows already carry the fields the
    // pipeline needs (encryptionScope/groupId/groupKeyVersionId/
    // wrappedContentKeys); the cast bridges only a null-vs-undefined difference
    // between ExportRow and DecryptableExpense — the runtime objects are, and
    // remain, ExportRows with their encrypted fields decrypted.
    const decrypted = await this.decryptor.decryptExpenses(
      rows as unknown as DecryptableExpense[],
    );
    return decrypted as unknown as ExportRow[];
  }

  /**
   * Full export flow: fetch → decrypt → build workbook → trigger download.
   * Returns the generated filename. Throws on network/validation errors so the
   * caller can surface them.
   */
  async exportExpenses(
    filter: ExportFilter,
    format: ExportFormat = 'xlsx',
    filename?: string,
  ): Promise<string> {
    const rows = await this.fetchRows(filter);
    const builder = createWorkbookBuilder(format);
    const blob = builder.build(rows, {
      filter,
      total: rows.length,
      exportedOn: new Date(),
    });
    const resolvedName = filename
      ? `${filename}.${builder.extension}`
      : buildExportFilename(filter, builder.extension);
    this.triggerDownload(blob, resolvedName);
    return resolvedName;
  }

  /** Download a blob by simulating an anchor click. */
  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoke on the next tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
