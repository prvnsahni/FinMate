import { DocumentIntakeController } from './document-intake.controller';
import { DocumentIntakeService, DocumentIntakeResult } from './document-intake.service';
import { DocumentProcessingMode } from './document-processing-mode';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

describe('DocumentIntakeController', () => {
  it('delegates to the service with the authenticated user and wraps the result', async () => {
    const result: DocumentIntakeResult = {
      mode: DocumentProcessingMode.ITEMIZED,
      attachmentId: 'att-1',
      sourceType: 'image',
      extractionAttempted: true,
      message: 'Item extraction is not available yet.',
    };
    const service = { process: jest.fn().mockResolvedValue(result) };
    const controller = new DocumentIntakeController(
      service as unknown as DocumentIntakeService,
    );

    const req = { user: { id: 'user-1' } } as RequestWithUser;
    const res = await controller.process(
      'att-1',
      { mode: DocumentProcessingMode.ITEMIZED },
      req,
    );

    expect(service.process).toHaveBeenCalledWith(
      'user-1',
      'att-1',
      DocumentProcessingMode.ITEMIZED,
    );
    expect(res.success).toBe(true);
    expect(res.data).toBe(result);
  });
});
