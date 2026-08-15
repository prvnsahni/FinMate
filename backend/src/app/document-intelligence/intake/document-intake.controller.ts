import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';
import { SuccessResponse } from '../../common/response.util';
import { ThrottleAs } from '../../throttler/throttle-policy.decorator';
import { THROTTLE_PROFILES } from '../../throttler/throttle.constants';
import { DocumentIntelligenceEnabledGuard } from './document-intelligence-enabled.guard';
import { DocumentIntakeService } from './document-intake.service';
import { ProcessDocumentDto } from './dto/process-document.dto';

/**
 * DOC-1 document intake. Additive, authenticated, throttled, owner-scoped, and gated
 * behind `document.intelligence` (404 when OFF). Establishes the TOTAL_ONLY vs
 * ITEMIZED boundary over the existing attachment infrastructure. No finance write,
 * no server-side decryption, no OCR — ITEMIZED returns the stub's explicit
 * unavailable result until a real engine is wired (DOC-2/DOC-3).
 */
@UseGuards(JwtAuthGuard, DocumentIntelligenceEnabledGuard)
@Controller('document-intelligence')
export class DocumentIntakeController {
  constructor(private readonly intake: DocumentIntakeService) {}

  @Post('attachments/:attachmentId/process')
  @ThrottleAs(THROTTLE_PROFILES.DEFAULT)
  async process(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Body() dto: ProcessDocumentDto,
    @Req() req: RequestWithUser,
  ) {
    const result = await this.intake.process(req.user.id, attachmentId, dto.mode);
    return new SuccessResponse('Document intake processed', result);
  }
}
