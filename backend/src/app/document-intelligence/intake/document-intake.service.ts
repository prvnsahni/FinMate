import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from '@finmate/data-models';
import {
  DOCUMENT_EXTRACTION_ENGINE,
  DocumentExtractionEngine,
  DocumentExtractionInput,
  DocumentExtractionResult,
  DocumentSourceType,
} from '../engine/document-extraction-engine.types';
import { DocumentProcessingMode } from './document-processing-mode';

/** Result of a DOC-1 intake decision. */
export interface DocumentIntakeResult {
  mode: DocumentProcessingMode;
  attachmentId: string;
  sourceType: DocumentSourceType;
  /** True only for ITEMIZED (the extraction engine was invoked). */
  extractionAttempted: boolean;
  /** Present only when the extraction engine was invoked (ITEMIZED). */
  extraction?: DocumentExtractionResult;
  message: string;
}

/** Map a stored MIME type to the normalized DOC-0 source type. */
export function resolveSourceType(
  mimeType: string | undefined,
): DocumentSourceType {
  if (typeof mimeType !== 'string') return 'unknown';
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return 'unknown';
}

/**
 * Build the MINIMIZED engine input from an attachment. Carries only an opaque
 * reference (the attachment id) plus coarse routing metadata. It deliberately
 * excludes `encryptedFileKey`, `encryptedOriginalName`, `storageKey`, the uploader,
 * and every other sensitive field — the engine must never receive keys or PII
 * (readiness §18; DOC-1 §9). Accepts a structural subset so it is trivially testable.
 */
export function buildExtractionInput(attachment: {
  id: string;
  mimeType: string;
  sizeBytes?: string | number | null;
}): DocumentExtractionInput {
  const size =
    attachment.sizeBytes != null ? Number(attachment.sizeBytes) : undefined;
  const input: DocumentExtractionInput = {
    documentRef: attachment.id,
    sourceType: resolveSourceType(attachment.mimeType),
    mimeType: attachment.mimeType,
  };
  if (size !== undefined && Number.isFinite(size)) input.sizeBytes = size;
  return input;
}

/**
 * DOC-1 document intake. Establishes the TOTAL_ONLY vs ITEMIZED boundary around the
 * EXISTING attachment infrastructure. It never mutates finance data, never decrypts
 * attachment content, and never fabricates items:
 *   - TOTAL_ONLY  → no extraction; the caller uses the normal expense flow.
 *   - ITEMIZED    → invoke the DOC-0 engine (currently a stub → explicit unavailable).
 * Access is strictly owner-scoped (IDOR-safe): a caller may only process an
 * attachment they uploaded; anything else 404s.
 */
@Injectable()
export class DocumentIntakeService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @Inject(DOCUMENT_EXTRACTION_ENGINE)
    private readonly engine: DocumentExtractionEngine,
  ) {}

  /**
   * Decide/prepare document processing for an owned attachment.
   * @param userId Authenticated user id (the only permitted owner).
   * @param attachmentId The attachment to process.
   * @param mode TOTAL_ONLY or ITEMIZED.
   */
  async process(
    userId: string,
    attachmentId: string,
    mode: DocumentProcessingMode,
  ): Promise<DocumentIntakeResult> {
    const attachment = await this.ownedAttachment(userId, attachmentId);
    const sourceType = resolveSourceType(attachment.mimeType);

    // TOTAL_ONLY: the document is evidence only — no extraction is attempted.
    if (mode === DocumentProcessingMode.TOTAL_ONLY) {
      return {
        mode,
        attachmentId,
        sourceType,
        extractionAttempted: false,
        message:
          'Total-only: no extraction performed. Record or confirm the total through the normal expense flow.',
      };
    }

    // ITEMIZED: invoke the extraction boundary with a minimized input. The stub
    // returns an explicit unavailable result; no items are fabricated.
    const extraction = await this.engine.extract(
      buildExtractionInput(attachment),
    );
    return {
      mode,
      attachmentId,
      sourceType,
      extractionAttempted: true,
      extraction,
      message:
        extraction.status === 'unsupported_document'
          ? 'Item extraction is not available yet. You can attach the document and enter the total.'
          : `Extraction status: ${extraction.status}.`,
    };
  }

  /**
   * Load an attachment the caller uploaded, or 404. Owner-scoped to prevent IDOR —
   * a 404 (not 403) so existence is not revealed. DOC-1 scopes ownership to the
   * uploader; broader participant-scoping is a future refinement.
   */
  private async ownedAttachment(
    userId: string,
    attachmentId: string,
  ): Promise<Attachment> {
    const attachment = await this.attachmentRepo.findOne({
      where: { id: attachmentId },
      relations: { uploaderUser: true },
    });
    if (!attachment || attachment.uploaderUser?.id !== userId) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }
}
