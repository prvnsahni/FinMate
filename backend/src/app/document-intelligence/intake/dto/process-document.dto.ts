import { IsEnum } from 'class-validator';
import { DocumentProcessingMode } from '../document-processing-mode';

/**
 * DOC-1 intake request body. Carries ONLY the user's chosen processing mode — no
 * document bytes, no keys, no PII. The document itself is referenced by the
 * already-owned attachment id in the route param.
 */
export class ProcessDocumentDto {
  @IsEnum(DocumentProcessingMode, {
    message: 'mode must be TOTAL_ONLY or ITEMIZED',
  })
  mode!: DocumentProcessingMode;
}
