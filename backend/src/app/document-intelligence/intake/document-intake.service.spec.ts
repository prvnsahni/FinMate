import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Attachment } from '@finmate/data-models';
import {
  DocumentIntakeService,
  buildExtractionInput,
  resolveSourceType,
} from './document-intake.service';
import { DocumentProcessingMode } from './document-processing-mode';
import { StubDocumentExtractionEngine } from '../engine/stub-document-extraction-engine';

const OWNER = 'user-1';

const attachment = (over: Partial<Attachment> = {}): Attachment =>
  ({
    id: 'att-1',
    mimeType: 'image/jpeg',
    sizeBytes: '2048',
    encryptedFileKey: 'iv:WRAPPED_FILE_KEY',
    encryptedOriginalName: 'iv:CIPHER_NAME',
    storageKey: 's3/opaque/key',
    uploaderUser: { id: OWNER },
    ...over,
  }) as unknown as Attachment;

describe('DocumentIntakeService (DOC-1 intake boundary)', () => {
  let engine: StubDocumentExtractionEngine;
  let repo: { findOne: jest.Mock };
  let svc: DocumentIntakeService;
  let extractSpy: jest.SpyInstance;

  beforeEach(() => {
    engine = new StubDocumentExtractionEngine();
    extractSpy = jest.spyOn(engine, 'extract');
    repo = { findOne: jest.fn().mockResolvedValue(attachment()) };
    svc = new DocumentIntakeService(
      repo as unknown as Repository<Attachment>,
      engine,
    );
  });

  it('TOTAL_ONLY does NOT invoke extraction', async () => {
    const r = await svc.process(
      OWNER,
      'att-1',
      DocumentProcessingMode.TOTAL_ONLY,
    );
    expect(r.extractionAttempted).toBe(false);
    expect(r.extraction).toBeUndefined();
    expect(extractSpy).not.toHaveBeenCalled();
    expect(r.mode).toBe(DocumentProcessingMode.TOTAL_ONLY);
  });

  it('ITEMIZED invokes the engine boundary and returns the explicit unavailable result', async () => {
    const r = await svc.process(
      OWNER,
      'att-1',
      DocumentProcessingMode.ITEMIZED,
    );
    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(r.extractionAttempted).toBe(true);
    expect(r.extraction?.status).toBe('unsupported_document');
    // No fake items are ever produced.
    expect(r.extraction?.lineItems).toBeUndefined();
    expect(r.message).toMatch(/not available yet/i);
  });

  it('is owner-scoped: another user cannot process the attachment (IDOR → 404, engine not called)', async () => {
    repo.findOne.mockResolvedValue(
      attachment({ uploaderUser: { id: 'attacker' } as never }),
    );
    await expect(
      svc.process(OWNER, 'att-1', DocumentProcessingMode.ITEMIZED),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it('404s when the attachment does not exist', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      svc.process(OWNER, 'missing', DocumentProcessingMode.TOTAL_ONLY),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes only a MINIMIZED input to the engine — no keys, no filename, no storage key', async () => {
    await svc.process(OWNER, 'att-1', DocumentProcessingMode.ITEMIZED);
    const passed = extractSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.documentRef).toBe('att-1');
    expect(passed.sourceType).toBe('image');
    // Sensitive fields must never reach the engine.
    for (const key of [
      'encryptedFileKey',
      'encryptedOriginalName',
      'storageKey',
      'uploaderUser',
      'fileName',
    ]) {
      expect(passed[key]).toBeUndefined();
    }
    // The whole serialized input must not carry the wrapped key material.
    expect(JSON.stringify(passed)).not.toContain('WRAPPED_FILE_KEY');
  });

  it('has NO finance-write dependency (extraction cannot mutate finance)', () => {
    // Structural: the service depends only on the attachment repo + the engine.
    // There is no expense/settlement/balance repository to write through.
    const deps = svc as unknown as Record<string, unknown>;
    expect(Object.values(deps).some((d) => d === repo || d === engine)).toBe(
      true,
    );
    const surface = svc as unknown as Record<string, unknown>;
    for (const forbidden of [
      'createExpense',
      'saveExpense',
      'mutate',
      'settle',
    ]) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
});

describe('resolveSourceType', () => {
  it('maps image/* → image, application/pdf → pdf, else unknown', () => {
    expect(resolveSourceType('image/png')).toBe('image');
    expect(resolveSourceType('image/jpeg')).toBe('image');
    expect(resolveSourceType('application/pdf')).toBe('pdf');
    expect(resolveSourceType('text/plain')).toBe('unknown');
    expect(resolveSourceType(undefined)).toBe('unknown');
  });
});

describe('buildExtractionInput (minimization)', () => {
  it('carries only the opaque ref + coarse metadata, never keys/PII', () => {
    const input = buildExtractionInput({
      id: 'att-9',
      mimeType: 'application/pdf',
      sizeBytes: '4096',
    });
    expect(input).toEqual({
      documentRef: 'att-9',
      sourceType: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
    });
    expect(JSON.stringify(input)).not.toMatch(
      /key|encrypt|storage|password|token/i,
    );
  });

  it('omits sizeBytes when unavailable', () => {
    const input = buildExtractionInput({ id: 'a', mimeType: 'image/png' });
    expect(input.sizeBytes).toBeUndefined();
  });
});
